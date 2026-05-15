import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BotConfig, BotPosition, PoolData } from './types';
import { calculateFeeTvlRatio, calculateVolumeTvlRatio, calculatePoolAgeHours } from './poolMetrics';
import { analyzePool, PoolAnalysisResult } from './poolAnalysis';

const API_URL = 'https://dlmm.datapi.meteora.ag/pools';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');
const DLMM_PROGRAM_ID = '11111111111111111111111111111111';

export class AutonomousBot {
  private config: BotConfig;
  private keypair: Keypair;
  private openPositions: BotPosition[] = [];
  private anthropic: Anthropic;

  constructor(config: BotConfig, keypair: Keypair) {
    this.config = config;
    this.keypair = keypair;
    this.anthropic = new Anthropic();

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
    await this.tick();
    setInterval(() => this.tick(), this.config.updateIntervalMs);
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

      // Deduplicate: skip pools already having an open position
      const newCandidates = candidates.filter(
        (pool) => !this.openPositions.some((pos) => pos.poolAddress === pool.address && pos.status !== 'closed')
      );

      const skipped = candidates.length - newCandidates.length;
      if (skipped > 0) {
        console.log(`[Bot] Skipping ${skipped} already-open pool(s)`);
      }

      // Capital guard: check available slots before any analysis
      const availableSlots = this.config.maxSimultaneousPositions - this.openPositions.filter((p) => p.status !== 'closed').length;
      if (availableSlots <= 0) {
        console.log(`[Bot] Max positions (${this.config.maxSimultaneousPositions}) reached`);
        await this.monitorPositions();
        return;
      }

      // Analyze top candidates with Claude; slight buffer in case some are skipped
      const toAnalyze = newCandidates.slice(0, availableSlots + 2);

      for (const pool of toAnalyze) {
        const filledSlots = this.openPositions.filter((p) => p.status !== 'closed').length;
        if (filledSlots >= this.config.maxSimultaneousPositions) break;

        const analysis = await this.analyzeWithClaude(pool);
        if (analysis) {
          await this.openPosition(pool, analysis);
        }
      }

      await this.monitorPositions();
    } catch (err) {
      console.error('[Bot] Tick failed:', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // Returns analysis if Claude approves, null to skip
  async analyzeWithClaude(pool: PoolData): Promise<PoolAnalysisResult | null> {
    try {
      console.log(`[Bot] Analyzing ${pool.pair} with Claude...`);
      const result = await analyzePool(pool, this.anthropic);

      const claudeScoreNormalized = result.score * 10; // 0-10 → 0-100
      const meetsThreshold = claudeScoreNormalized >= this.config.minScore;
      const claudeSaysOpen = result.recommandation === 'open';

      console.log(
        `[Bot] Claude: ${pool.pair} | score=${result.score}/10 | rec=${result.recommandation} | threshold=${this.config.minScore}/100`
      );
      console.log(`[Bot] Reasoning: ${result.raisonnement}`);

      if (meetsThreshold && claudeSaysOpen) {
        return result;
      }

      const reason = !claudeSaysOpen ? `rec=${result.recommandation}` : `score ${claudeScoreNormalized} < threshold ${this.config.minScore}`;
      console.log(`[Bot] Skip ${pool.pair}: ${reason}`);
      return null;
    } catch (err) {
      console.error(`[Bot] Claude analysis failed for ${pool.pair}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
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

  private async openPosition(pool: PoolData, analysis: PoolAnalysisResult): Promise<void> {
    try {
      const modeLabel = this.config.dryRun ? '[DRY RUN]' : '';
      console.log(`[Bot] ${modeLabel} Opening position: ${pool.pair} (Claude score=${analysis.score}/10, conviction=${analysis.conviction})`);

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
        console.log(`[Bot] ${modeLabel} Simulated tx: ${signature.slice(0, 20)}...`);
      } else {
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
        claudeScore: analysis.score,
        claudeConviction: analysis.conviction,
        claudeReasoning: analysis.raisonnement,
      };

      this.openPositions.push(position);
      console.log(`[Bot] ${modeLabel} Position opened: ${pool.pair} | Capital: ${this.config.maxCapitalPerPosition} SOL`);
    } catch (err) {
      console.error(`[Bot] Failed to open position: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async monitorPositions(): Promise<void> {
    const active = this.openPositions.filter((p) => p.status !== 'closed');
    if (active.length === 0) return;

    console.log(`[Bot] Monitoring ${active.length} position(s)`);

    for (const pos of active) {
      if (this.config.dryRun) {
        console.log(`[Bot] [DRY RUN] ${pos.pair}: Simulated (${pos.capitalDeployed} SOL, status: ${pos.status})`);
        continue;
      }

      try {
        const tx = await connection.getTransaction(pos.signature);
        if (!tx) {
          console.log(`[Bot] ${pos.pair}: Tx not yet confirmed`);
        } else {
          console.log(`[Bot] ${pos.pair}: Active (${pos.capitalDeployed} SOL)`);
        }
      } catch (err) {
        console.warn(`[Bot] Could not verify ${pos.pair}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  getStatus() {
    const active = this.openPositions.filter((p) => p.status !== 'closed');
    return {
      openPositions: active.length,
      totalCapitalDeployed: active.reduce((sum, p) => sum + p.capitalDeployed, 0),
      positions: this.openPositions,
      config: this.config,
    };
  }
}
