import Anthropic from '@anthropic-ai/sdk';
import { PoolData } from './types';

const SYSTEM_PROMPT = `You are an expert DLMM (Dynamic Liquidity Market Maker) analyst on Solana.
Analyze pool metrics and return a structured JSON recommendation for liquidity providers.

Your analysis must consider:
- fee/TVL ratio as yield indicator (higher = more attractive)
- volume/TVL ratio as activity multiplier (higher = more active)
- bin step as price range granularity (lower = tighter, more precise)
- pool age as maturity/risk indicator (very new pools are riskier)
- absolute TVL as liquidity depth (affects slippage and sustainability)

Scoring rules:
- score 0-3: high risk or low opportunity
- score 4-6: moderate opportunity
- score 7-10: strong opportunity

Range suggestion must be realistic around current price (±5-30% depending on volatility).`;

export interface PoolAnalysisResult {
  score: number;
  conviction: 'low' | 'mid' | 'high';
  recommandation: 'open' | 'skip' | 'watch';
  bin_step_optimal: number;
  range_suggeree: { min: number; max: number };
  raisonnement: string;
}

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: 'analyze_pool',
  description: 'Return structured analysis and recommendation for a DLMM liquidity pool',
  input_schema: {
    type: 'object' as const,
    properties: {
      score: {
        type: 'number',
        description: 'Opportunity score from 0 (worst) to 10 (best)',
      },
      conviction: {
        type: 'string',
        enum: ['low', 'mid', 'high'],
        description: 'Conviction level based on data quality and signal strength',
      },
      recommandation: {
        type: 'string',
        enum: ['open', 'skip', 'watch'],
        description: 'Action: open position, skip, or watch and wait',
      },
      bin_step_optimal: {
        type: 'number',
        description: 'Optimal bin step in basis points for this pool',
      },
      range_suggeree: {
        type: 'object',
        properties: {
          min: { type: 'number', description: 'Minimum price of suggested LP range' },
          max: { type: 'number', description: 'Maximum price of suggested LP range' },
        },
        required: ['min', 'max'],
        additionalProperties: false,
      },
      raisonnement: {
        type: 'string',
        description: 'Short reasoning (2-3 sentences max) explaining the recommendation',
      },
    },
    required: ['score', 'conviction', 'recommandation', 'bin_step_optimal', 'range_suggeree', 'raisonnement'],
    additionalProperties: false,
  },
};

function buildPoolMetricsMessage(pool: PoolData): string {
  return `Analyze this DLMM pool:

Pair: ${pool.pair}
Address: ${pool.address}
TVL: $${pool.tvl.toLocaleString('en-US', { maximumFractionDigits: 2 })}
24h Fees: $${pool.fees24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}
24h Volume: $${pool.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}
Bin Step: ${pool.binStep} bps
Pool Age: ${pool.poolAgeHours.toFixed(1)} hours
Fee/TVL Ratio: ${pool.feeTvlRatioPercent.toFixed(4)}%
Volume/TVL Ratio: ${pool.volumeTvlRatio.toFixed(4)}x`;
}

export async function analyzePool(
  pool: PoolData,
  client?: Anthropic
): Promise<PoolAnalysisResult> {
  const anthropic = client ?? new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'analyze_pool' },
    messages: [
      { role: 'user', content: buildPoolMetricsMessage(pool) },
    ],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (!toolUseBlock) {
    throw new Error('No tool_use block in response');
  }

  const input = toolUseBlock.input as PoolAnalysisResult;

  validateAnalysisResult(input);

  return input;
}

function validateAnalysisResult(result: unknown): asserts result is PoolAnalysisResult {
  const r = result as Record<string, unknown>;

  if (typeof r.score !== 'number' || r.score < 0 || r.score > 10) {
    throw new Error(`Invalid score: ${r.score}`);
  }
  if (!['low', 'mid', 'high'].includes(r.conviction as string)) {
    throw new Error(`Invalid conviction: ${r.conviction}`);
  }
  if (!['open', 'skip', 'watch'].includes(r.recommandation as string)) {
    throw new Error(`Invalid recommandation: ${r.recommandation}`);
  }
  if (typeof r.bin_step_optimal !== 'number' || r.bin_step_optimal <= 0) {
    throw new Error(`Invalid bin_step_optimal: ${r.bin_step_optimal}`);
  }
  const range = r.range_suggeree as Record<string, unknown>;
  if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') {
    throw new Error('Invalid range_suggeree');
  }
  if (range.min >= range.max) {
    throw new Error(`range_suggeree.min must be < max: ${range.min} >= ${range.max}`);
  }
  if (typeof r.raisonnement !== 'string' || !r.raisonnement.trim()) {
    throw new Error('Invalid raisonnement');
  }
}

export async function analyzePoolsBatch(
  pools: PoolData[],
  client?: Anthropic,
  concurrency: number = 5
): Promise<Array<{ pool: PoolData; result: PoolAnalysisResult | null; error?: string }>> {
  const results: Array<{ pool: PoolData; result: PoolAnalysisResult | null; error?: string }> = [];

  for (let i = 0; i < pools.length; i += concurrency) {
    const batch = pools.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((pool) => analyzePool(pool, client))
    );

    for (let j = 0; j < batch.length; j++) {
      const outcome = settled[j];
      if (outcome.status === 'fulfilled') {
        results.push({ pool: batch[j], result: outcome.value });
      } else {
        results.push({
          pool: batch[j],
          result: null,
          error: outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error',
        });
      }
    }
  }

  return results;
}
