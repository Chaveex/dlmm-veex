import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { PoolData } from './types';
import { PoolAnalysisResult } from './poolAnalysis';

const BATCH_SIZE = 10;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export interface BatchOptions {
  batchSize?: number;
  maxRetries?: number;
  concurrency?: number;
}

export interface BatchPoolResult {
  pool: PoolData;
  result: PoolAnalysisResult | null;
  error?: string;
  attempts: number;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  successRate: number;
  durationMs: number;
  results: BatchPoolResult[];
}

const SYSTEM_PROMPT = `You are an expert DLMM (Dynamic Liquidity Market Maker) analyst on Solana.
Analyze multiple pools and return a JSON array of recommendations.

Scoring rules:
- score 0-3: high risk or low opportunity
- score 4-6: moderate opportunity
- score 7-10: strong opportunity

Consider: fee/TVL ratio (yield), volume/TVL (activity), bin step (granularity), pool age (maturity), TVL (depth).`;

const BATCH_TOOL: Anthropic.Tool = {
  name: 'analyze_pools_batch',
  description: 'Return structured analysis for multiple DLMM pools',
  input_schema: {
    type: 'object' as const,
    properties: {
      analyses: {
        type: 'array',
        description: 'Analysis for each pool in the same order as input',
        items: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            score: { type: 'number', description: '0-10' },
            conviction: { type: 'string', enum: ['low', 'mid', 'high'] },
            recommandation: { type: 'string', enum: ['open', 'skip', 'watch'] },
            bin_step_optimal: { type: 'number' },
            range_suggeree: {
              type: 'object',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' },
              },
              required: ['min', 'max'],
              additionalProperties: false,
            },
            raisonnement: { type: 'string' },
          },
          required: ['address', 'score', 'conviction', 'recommandation', 'bin_step_optimal', 'range_suggeree', 'raisonnement'],
          additionalProperties: false,
        },
      },
    },
    required: ['analyses'],
    additionalProperties: false,
  },
};

function buildBatchMessage(pools: PoolData[]): string {
  const poolLines = pools.map((p, i) =>
    `${i + 1}. ${p.pair} (${p.address.slice(0, 8)}...)
   TVL: $${p.tvl.toLocaleString('en-US', { maximumFractionDigits: 0 })} | Fees 24h: $${p.fees24h.toLocaleString('en-US', { maximumFractionDigits: 0 })} | Vol 24h: $${p.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}
   Bin: ${p.binStep}bps | Age: ${p.poolAgeHours.toFixed(1)}h | Fee/TVL: ${p.feeTvlRatioPercent.toFixed(4)}% | Vol/TVL: ${p.volumeTvlRatio.toFixed(4)}x`
  );

  return `Analyze these ${pools.length} DLMM pools:\n\n${poolLines.join('\n\n')}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.InternalServerError) return true;
  if (error instanceof Anthropic.APIError && error.status === 529) return true;
  return false;
}

function getRetryDelay(attempt: number, error: unknown): number {
  if (error instanceof Anthropic.RateLimitError) {
    return BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
  }
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

export async function analyzeBatch(
  pools: PoolData[],
  client: Anthropic,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<BatchPoolResult[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [BATCH_TOOL],
        tool_choice: { type: 'tool', name: 'analyze_pools_batch' },
        messages: [{ role: 'user', content: buildBatchMessage(pools) }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) throw new Error('No tool_use block in response');

      const { analyses } = toolBlock.input as { analyses: Array<PoolAnalysisResult & { address: string }> };

      const resultsMap = new Map(analyses.map((a) => [a.address, a]));

      return pools.map((pool) => {
        const analysis = resultsMap.get(pool.address);
        if (!analysis) {
          console.warn(`[batchAnalyzer] No analysis for pool ${pool.address}`);
          return { pool, result: null, error: 'Missing from response', attempts: attempt + 1 };
        }
        const { address: _, ...result } = analysis;
        return { pool, result: result as PoolAnalysisResult, attempts: attempt + 1 };
      });

    } catch (err) {
      lastError = err;
      const isLast = attempt === maxRetries;

      if (!isRetryable(err) || isLast) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[batchAnalyzer] Batch failed (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}`);
        return pools.map((pool) => ({
          pool,
          result: null,
          error: msg,
          attempts: attempt + 1,
        }));
      }

      const delay = getRetryDelay(attempt, err);
      console.warn(`[batchAnalyzer] Attempt ${attempt + 1} failed (${(err as Error).message}), retrying in ${delay.toFixed(0)}ms…`);
      await sleep(delay);
    }
  }

  const msg = lastError instanceof Error ? lastError.message : 'Unknown error';
  return pools.map((pool) => ({ pool, result: null, error: msg, attempts: maxRetries + 1 }));
}

export async function batchAnalyzePools(
  pools: PoolData[],
  options: BatchOptions = {},
  client?: Anthropic
): Promise<BatchSummary> {
  const {
    batchSize = BATCH_SIZE,
    maxRetries = DEFAULT_MAX_RETRIES,
    concurrency = 3,
  } = options;

  const anthropic = client ?? new Anthropic();
  const start = performance.now();
  const allResults: BatchPoolResult[] = [];

  const batches: PoolData[][] = [];
  for (let i = 0; i < pools.length; i += batchSize) {
    batches.push(pools.slice(i, i + batchSize));
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const concurrentBatches = batches.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      concurrentBatches.map((batch) => analyzeBatch(batch, anthropic, maxRetries))
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        allResults.push(...outcome.value);
      } else {
        const batchIdx = concurrentBatches[settled.indexOf(outcome)];
        console.error(`[batchAnalyzer] Unhandled batch rejection: ${outcome.reason}`);
        allResults.push(
          ...batchIdx.map((pool) => ({
            pool,
            result: null,
            error: 'Unhandled batch error',
            attempts: maxRetries + 1,
          }))
        );
      }
    }
  }

  const succeeded = allResults.filter((r) => r.result !== null).length;

  return {
    total: allResults.length,
    succeeded,
    failed: allResults.length - succeeded,
    successRate: allResults.length > 0 ? succeeded / allResults.length : 0,
    durationMs: performance.now() - start,
    results: allResults,
  };
}
