import axios from 'axios';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BotConfig, BotPosition, PoolData } from './types';
import { calculateFeeTvlRatio, calculateVolumeTvlRatio, calculatePoolAgeHours } from './poolMetrics';
import { isOutOfRange, canRebalance, computeNewRange, performRebalance } from './rebalancer';

const API_URL = 'https://dlmm.datapi.meteora.ag/pools';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');
const DLMM_PROGRAM_ID = '11111111111111111111111111111111';

const REBALANCE_POLL_MS = 30_000;

export class AutonomousBot {
  private config: BotConfig;
  private keypair: Keypair;
  private openPositions: BotPosition[] = [];

  constructor(config: BotConfig, keypair: Keypair) {
    this.config = config;
    this.keypair = keypair;

    console.log(`[Bot] Initialized with config:`);
    console.log(`  - Min score: ${config.minScore}`);
    console.log(`  - Max capital per position: ${config.maxCapitalPerPosition} SOL`);
    console.log(`  - Max simultaneous positions: ${config.maxSimultaneousPositions}`);
    console.log(`  - Dry run: ${config.dryRun ? 'YES (simulation mode)' : 'NO (real transactions)'}`);
    console.log(`  - Rebalance: ${config.rebalanceEnabled !== false ? 'ON' : 'OFF'} | cooldown ${(config.rebalanceCooldownMs ?? 300000) / 1000}s | ±${config.rangeWidthBins ?? 20} bins`);
    if (config.targetPoolAddress) console.log(`  - Target pool address: ${config.targetPoolAddress} (DIRECT)`);
    else if (config.targetPair) console.log(`  - Target pair: ${config.targetPair} (FILTERED)`);
    console.log(`  - Wallet: ${keypair.publicKey.toString()}`);
  }

  async start(): Promise<void> {
    console.log(`[Bot] Starting autonomous trading bot...`);

    // Initial fetch
    await this.tick();

    // Periodic pool scan
    setInterval(() => this.tick(), this.config.updateIntervalMs);

    // Separate faster rebalance polling
    if (this.config.rebalanceEnabled !== false) {
      setInterval(() => this.rebalanceTick(), REBALANCE_POLL_MS);
    }
  }

  private async tick(): Promise<void> {
    try {
      let candidates: PoolData[] = [];

      if (this.config.targetPoolAddress) {
        const pools = await this.fetchPools();
        const targetPool = pools.find((p) => p.address.toLowerCase() === this.config.targetPoolAddress!.toLowerCase());

        if (targetPool) {
          candidates = [targetPool];
          console.log(`[Bot] Tick: fetched ${pools.length} pools, found target pool: ${targetPool.pair}`);
        } else {
          console.log(`[Bot] Tick: fetched ${pools.length} pools, target address not found`);
          return;
        }
      } else {
        const pools = await this.fetchPools();
        candidates = this.filterCandidates(pools);
        console.log(`[Bot] Tick: fetched ${pools.length} pools, ${candidates.length} candidates`);
      }

      // Open positions if we have room
      const availableSlots = this.config.maxSimultaneousPositions - this.openPositions.length;
      for (let i = 0; i < Math.min(availableSlots, candidates.length); i++) {
        await this.openPosition(candidates[i]);
      }

      // Monitor existing positions
      await this.monitorPositions();
    } catch (err) {
      console.error('[Bot] Tick failed:', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // Runs every 30s — checks if any open position is out of range and rebalances
  async rebalanceTick(): Promise<void> {
    const active = this.openPositions.filter((p) => p.status !== 'closed');
    if (active.length === 0) return;

    const cooldownMs = this.config.rebalanceCooldownMs ?? 300_000;

    // Fetch fresh pool data to get current active bins
    let pools: PoolData[];
    try {
      pools = await this.fetchPools();
    } catch {
      console.warn('[Rebalancer] Could not fetch pools for rebalance check');
      return;
    }

    const poolMap = new Map(pools.map((p) => [p.address.toLowerCase(), p]));

    for (const position of active) {
      const pool = poolMap.get(position.poolAddress.toLowerCase());
      if (!pool || pool.activeBinId === undefined) continue;

      if (!isOutOfRange(position, pool.activeBinId)) continue;

      if (!canRebalance(position, cooldownMs)) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - (position.lastRebalanceAt ?? 0))) / 1000);
        console.log(`[Rebalancer] ${position.pair} out of range but cooldown: ${remaining}s remaining`);
        continue;
      }

      console.log(`[Rebalancer] ${position.pair} out of range (active bin ${pool.activeBinId}, range [${position.rangeLowerBinId}..${position.rangeUpperBinId}]) — rebalancing`);

      const result = await performRebalance(position, pool.activeBinId, this.config, this.keypair, connection);

      if (result.rebalanced) {
        position.rangeLowerBinId = result.newRangeLowerBinId;
        position.rangeUpperBinId = result.newRangeUpperBinId;
        position.activeBinAtOpen = result.newActiveBin;
        position.lastRebalanceAt = Date.now();
        position.rebalanceCount = (position.rebalanceCount ?? 0) + 1;
        console.log(`[Rebalancer] ${position.pair} rebalanced #${position.rebalanceCount} → bins [${result.newRangeLowerBinId}..${result.newRangeUpperBinId}]`);
      } else {
        console.warn(`[Rebalancer] ${position.pair} rebalance skipped: ${result.reason}`);
      }
    }
  }

  private async fetchPools(): Promise<PoolData[]> {
    try {
      const res = await axios.get<any>(API_URL, { params: { page: 1, page_size: 50 } });
      if (!res.data?.data) return [];

      return res.data.data
        .map((raw: any) => this.extractPoolData(raw))
        .filter((p: PoolData | null): p is PoolData => p !== null);
    } catch (err) {
      console.error('[Bot] Fetch pools failed:', err instanceof Error ? err.message : 'Unknown error');
      return [];
    }
  }

  private extractPoolData(raw: any): PoolData | null {
    try {
      const address = typeof raw.address === 'string' ? raw.address : '';
      const pair = typeof raw.name === 'string' ? raw.name : '';
      const tvl = Number(raw.tvl) || 0;
      const fees24h = Number(raw.fees?.['24h']) || 0;
      const volume24h = Number(raw.volume?.['24h']) || 0;
      const binStep = Number(raw.pool_config?.bin_step) || 0;
      const poolAge = Math.max(0, (Date.now() - Number(raw.created_at)) / 1000);

      if (!address || !pair || tvl <= 0) return null;

      const feeTvlRatioPercent = calculateFeeTvlRatio(tvl, fees24h);
      const volumeTvlRatio = calculateVolumeTvlRatio(tvl, volume24h);
      const poolAgeHours = calculatePoolAgeHours(poolAge);

      const tokenXMint = typeof raw.token_x?.address === 'string' ? raw.token_x.address : '';
      const tokenYMint = typeof raw.token_y?.address === 'string' ? raw.token_y.address : '';

      const activeBinId = raw.active_bin_id !== undefined ? Number(raw.active_bin_id) : undefined;

      return {
        address,
        pair,
        tvl,
        fees24h,
        volume24h,
        binStep,
        poolAge,
        feeTvlRatioPercent,
        volumeTvlRatio,
        poolAgeHours,
        tokenXMint,
        tokenYMint,
        activeBinId,
      };
    } catch {
      return null;
    }
  }

  private filterCandidates(pools: PoolData[]): PoolData[] {
    let filtered = pools;

    if (this.config.targetPair) {
      filtered = pools.filter((p) => p.pair.toLowerCase().includes(this.config.targetPair!.toLowerCase()));
      if (filtered.length === 0) {
        console.log(`[Bot] Target pair '${this.config.targetPair}' not found in current pools`);
        return [];
      }
    }

    return filtered
      .map((p) => {
        const vtvScore = Math.min((p.volumeTvlRatio / 2) * 100, 100);
        const aprScore = Math.min((p.feeTvlRatioPercent / 3) * 100, 100);
        const feeRate = p.fees24h / p.tvl;
        const feeScore = Math.min((feeRate / 0.5) * 100, 100);
        const score = vtvScore * 0.5 + aprScore * 0.35 + feeScore * 0.15;

        return { pool: p, score };
      })
      .filter((c) => c.score >= this.config.minScore)
      .sort((a, b) => b.score - a.score)
      .map((c) => c.pool);
  }

  private async openPosition(pool: PoolData): Promise<void> {
    try {
      const modeLabel = this.config.dryRun ? '[DRY RUN]' : '';
      console.log(`[Bot] ${modeLabel} Opening position: ${pool.pair} (score threshold met)`);

      const tx = new Transaction({
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        feePayer: this.keypair.publicKey,
      });

      tx.add({
        programId: new PublicKey(DLMM_PROGRAM_ID),
        keys: [
          { pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: new PublicKey(pool.address), isSigner: false, isWritable: true },
        ],
        data: Buffer.from([0]),
      });

      let signature: string;

      if (this.config.dryRun) {
        tx.sign(this.keypair);
        const serialized = tx.serialize();
        signature = `sim_${Buffer.from(serialized).toString('hex').slice(0, 40)}`;
        console.log(`[Bot] ${modeLabel} Simulated tx would be: ${signature.slice(0, 20)}...`);
      } else {
        tx.sign(this.keypair);
        signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature);
        console.log(`[Bot] Position confirmed: Tx: ${signature}`);
      }

      // Compute initial range around current active bin
      const rangeWidth = this.config.rangeWidthBins ?? 20;
      const activeBin = pool.activeBinId;
      const range = activeBin !== undefined ? computeNewRange(activeBin, rangeWidth) : undefined;

      const position: BotPosition = {
        poolAddress: pool.address,
        pair: pool.pair,
        capitalDeployed: this.config.maxCapitalPerPosition,
        signature,
        timestamp: Date.now(),
        status: this.config.dryRun ? 'pending' : 'open',
        ...(range && {
          rangeLowerBinId: range.lower,
          rangeUpperBinId: range.upper,
          activeBinAtOpen: activeBin,
        }),
      };

      this.openPositions.push(position);
      console.log(`[Bot] ${modeLabel} Position opened: ${pool.pair} | Capital: ${this.config.maxCapitalPerPosition} SOL${range ? ` | Range bins [${range.lower}..${range.upper}]` : ''}`);
    } catch (err) {
      console.error(`[Bot] Failed to open position: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async monitorPositions(): Promise<void> {
    if (this.openPositions.length === 0) return;

    console.log(`[Bot] Monitoring ${this.openPositions.length} position(s)`);

    for (const pos of this.openPositions) {
      if (this.config.dryRun) {
        console.log(`[Bot] [DRY RUN] Position ${pos.pair}: Simulated (${pos.capitalDeployed} SOL, status: ${pos.status})`);
        continue;
      }

      try {
        const tx = await connection.getTransaction(pos.signature);
        if (!tx) {
          console.log(`[Bot] Position ${pos.pair}: Tx not yet confirmed`);
        } else {
          console.log(`[Bot] Position ${pos.pair}: Active (${pos.capitalDeployed} SOL)`);
        }
      } catch (err) {
        console.warn(`[Bot] Could not verify position ${pos.pair}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  getStatus() {
    return {
      openPositions: this.openPositions.length,
      totalCapitalDeployed: this.openPositions.reduce((sum, p) => sum + p.capitalDeployed, 0),
      positions: this.openPositions,
      config: this.config,
    };
  }
}
