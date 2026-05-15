import axios from 'axios';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BotConfig, BotPosition, PoolData } from './types';
import { calculateFeeTvlRatio, calculateVolumeTvlRatio, calculatePoolAgeHours } from './poolMetrics';

const API_URL = 'https://dlmm.datapi.meteora.ag/pools';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');
const DLMM_PROGRAM_ID = '11111111111111111111111111111111';

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
    if (config.targetPoolAddress) console.log(`  - Target pool address: ${config.targetPoolAddress} (DIRECT)`);
    else if (config.targetPair) console.log(`  - Target pair: ${config.targetPair} (FILTERED)`);
    console.log(`  - Wallet: ${keypair.publicKey.toString()}`);
  }

  async start(): Promise<void> {
    console.log(`[Bot] Starting autonomous trading bot...`);

    // Initial fetch
    await this.tick();

    // Periodic updates
    setInterval(() => this.tick(), this.config.updateIntervalMs);
  }

  private async tick(): Promise<void> {
    try {
      let candidates: PoolData[] = [];

      if (this.config.targetPoolAddress) {
        // Direct pool address mode: fetch and filter to this address only
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
        // Normal mode: fetch all and filter by pair/score
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
      };
    } catch {
      return null;
    }
  }

  private filterCandidates(pools: PoolData[]): PoolData[] {
    let filtered = pools;

    // Apply target pair filter if set
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

      // Build transaction (placeholder)
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
        data: Buffer.from([0]), // Placeholder
      });

      let signature: string;

      if (this.config.dryRun) {
        // Dry run: simulate transaction
        tx.sign(this.keypair);
        const serialized = tx.serialize();
        signature = `sim_${Buffer.from(serialized).toString('hex').slice(0, 40)}`;
        console.log(`[Bot] ${modeLabel} Simulated tx would be: ${signature.slice(0, 20)}...`);
      } else {
        // Real mode: sign and send
        tx.sign(this.keypair);
        signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature);
        console.log(`[Bot] Position confirmed: Tx: ${signature}`);
      }

      const position: BotPosition = {
        poolAddress: pool.address,
        pair: pool.pair,
        capitalDeployed: this.config.maxCapitalPerPosition,
        signature,
        timestamp: Date.now(),
        status: this.config.dryRun ? 'pending' : 'open',
      };

      this.openPositions.push(position);
      console.log(`[Bot] ${modeLabel} Position opened: ${pool.pair} | Capital: ${this.config.maxCapitalPerPosition} SOL`);
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
