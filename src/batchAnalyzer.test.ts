import Anthropic from '@anthropic-ai/sdk';
import { analyzeBatch, batchAnalyzePools, BatchPoolResult } from './batchAnalyzer';
import { PoolData } from './types';

jest.mock('@anthropic-ai/sdk');

const MockedAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

function makePool(i: number): PoolData {
  return {
    address: `Pool${String(i).padStart(40, '1')}`,
    pair: `TOKEN${i}-USDC`,
    tvl: 500000 + i * 10000,
    fees24h: 2500 + i * 100,
    volume24h: 25000000 + i * 1000000,
    binStep: 10,
    poolAge: 86400 * 30,
    feeTvlRatioPercent: 0.5,
    volumeTvlRatio: 5,
    poolAgeHours: 720,
    tokenXMint: `Mint${i}111111111111111111111111111111111111111`,
    tokenYMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  };
}

function makeAnalysis(address: string) {
  return {
    address,
    score: 7,
    conviction: 'high' as const,
    recommandation: 'open' as const,
    bin_step_optimal: 10,
    range_suggeree: { min: 0.9, max: 1.1 },
    raisonnement: 'Good yield and volume.',
  };
}

function makeApiResponse(pools: PoolData[]) {
  return {
    content: [{
      type: 'tool_use' as const,
      id: 'toolu_01',
      name: 'analyze_pools_batch',
      input: { analyses: pools.map((p) => makeAnalysis(p.address)) },
    }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 500, output_tokens: 300 },
  };
}

describe('analyzeBatch', () => {
  let mockCreate: jest.Mock;
  let mockClient: jest.Mocked<Anthropic>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    mockClient = { messages: { create: mockCreate } } as unknown as jest.Mocked<Anthropic>;
  });

  it('should return results for all pools in batch', async () => {
    const pools = [makePool(1), makePool(2), makePool(3)];
    mockCreate.mockResolvedValueOnce(makeApiResponse(pools));

    const results = await analyzeBatch(pools, mockClient);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.result !== null)).toBe(true);
    expect(results[0].result!.score).toBe(7);
    expect(results[0].attempts).toBe(1);
  });

  it('should map results to correct pools by address', async () => {
    const pools = [makePool(10), makePool(20)];
    mockCreate.mockResolvedValueOnce(makeApiResponse(pools));

    const results = await analyzeBatch(pools, mockClient);

    expect(results[0].pool.address).toBe(pools[0].address);
    expect(results[1].pool.address).toBe(pools[1].address);
  });

  it('should retry on 429 RateLimitError', async () => {
    const pools = [makePool(1)];
    const rateLimitError = new Anthropic.RateLimitError(
      429, { status: 429, error: { type: 'rate_limit_error', message: 'Too many requests' } } as any, 'Rate limit', {} as any
    );
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(makeApiResponse(pools));

    const results = await analyzeBatch(pools, mockClient, 3);

    expect(results[0].result).not.toBeNull();
    expect(results[0].attempts).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('should retry on 500 InternalServerError', async () => {
    const pools = [makePool(1)];
    const serverError = new Anthropic.InternalServerError(
      500, { status: 500, error: { type: 'api_error', message: 'Internal error' } } as any, 'Server error', {} as any
    );
    mockCreate
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(makeApiResponse(pools));

    const results = await analyzeBatch(pools, mockClient, 3);

    expect(results[0].result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on non-retryable errors', async () => {
    const pools = [makePool(1)];
    const badRequest = new Anthropic.BadRequestError(
      400, { status: 400, error: { type: 'invalid_request_error', message: 'Bad input' } } as any, 'Bad request', {} as any
    );
    mockCreate.mockRejectedValueOnce(badRequest);

    const results = await analyzeBatch(pools, mockClient, 3);

    expect(results[0].result).toBeNull();
    expect(results[0].error).toBeDefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('should fail after maxRetries exhausted', async () => {
    const pools = [makePool(1)];
    const rateLimitError = new Anthropic.RateLimitError(
      429, { status: 429, error: { type: 'rate_limit_error', message: 'Rate limit' } } as any, 'Rate limit', {} as any
    );
    mockCreate.mockRejectedValue(rateLimitError);

    const results = await analyzeBatch(pools, mockClient, 2);

    expect(results[0].result).toBeNull();
    expect(results[0].attempts).toBe(3);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('should mark pool with null when missing from response', async () => {
    const pools = [makePool(1), makePool(2)];
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'tool_use' as const,
        id: 'toolu_01',
        name: 'analyze_pools_batch',
        input: { analyses: [makeAnalysis(pools[0].address)] },
      }],
    });

    const results = await analyzeBatch(pools, mockClient);

    expect(results[0].result).not.toBeNull();
    expect(results[1].result).toBeNull();
    expect(results[1].error).toBe('Missing from response');
  });

  it('should throw when no tool_use block', async () => {
    const pools = [makePool(1)];
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hello' }] });

    const results = await analyzeBatch(pools, mockClient, 0);

    expect(results[0].result).toBeNull();
    expect(results[0].error).toContain('No tool_use block');
  });
});

describe('batchAnalyzePools', () => {
  let mockCreate: jest.Mock;
  let mockClient: jest.Mocked<Anthropic>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    mockClient = { messages: { create: mockCreate } } as unknown as jest.Mocked<Anthropic>;
  });

  it('should batch 50 pools into 5 batches of 10', async () => {
    const pools = Array.from({ length: 50 }, (_, i) => makePool(i));
    mockCreate.mockImplementation(({ messages }) => {
      const content = messages[0].content as string;
      const batchPools = pools.filter((p) => content.includes(p.address.slice(0, 8)));
      return Promise.resolve(makeApiResponse(batchPools));
    });

    const summary = await batchAnalyzePools(pools, { batchSize: 10, concurrency: 3 }, mockClient);

    expect(summary.total).toBe(50);
    expect(summary.results).toHaveLength(50);
  });

  it('should report correct success/fail counts', async () => {
    const pools = Array.from({ length: 10 }, (_, i) => makePool(i));
    mockCreate.mockResolvedValue(makeApiResponse(pools));

    const summary = await batchAnalyzePools(pools, { batchSize: 10 }, mockClient);

    expect(summary.succeeded).toBe(10);
    expect(summary.failed).toBe(0);
    expect(summary.successRate).toBe(1);
  });

  it('success rate > 98% when one pool missing from one batch of 100', async () => {
    // 100 pools → 10 batches of 10 — only 1 pool missing = 99% success
    const pools = Array.from({ length: 100 }, (_, i) => makePool(i));
    let callCount = 0;
    mockCreate.mockImplementation(({ messages }) => {
      callCount++;
      const content = messages[0].content as string;
      const batchPools = pools.filter((p) => content.includes(p.address.slice(0, 8)));
      if (callCount === 1) {
        // Return all except one pool from this batch
        return Promise.resolve({
          content: [{
            type: 'tool_use' as const,
            id: 'toolu_01',
            name: 'analyze_pools_batch',
            input: { analyses: batchPools.slice(1).map((p) => makeAnalysis(p.address)) },
          }],
        });
      }
      return Promise.resolve(makeApiResponse(batchPools));
    });

    const summary = await batchAnalyzePools(pools, { batchSize: 10, concurrency: 1 }, mockClient);

    expect(summary.successRate).toBeGreaterThan(0.98);
    expect(summary.total).toBe(100);
  });

  it('should return duration in ms', async () => {
    const pools = Array.from({ length: 5 }, (_, i) => makePool(i));
    mockCreate.mockResolvedValue(makeApiResponse(pools));

    const summary = await batchAnalyzePools(pools, { batchSize: 10 }, mockClient);

    expect(summary.durationMs).toBeGreaterThan(0);
  });

  it('should continue processing when one batch throws', async () => {
    const pools = Array.from({ length: 20 }, (_, i) => makePool(i));
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('Network error');
      return Promise.resolve(makeApiResponse(pools.slice(10)));
    });

    const summary = await batchAnalyzePools(
      pools,
      { batchSize: 10, concurrency: 1, maxRetries: 0 },
      mockClient
    );

    expect(summary.total).toBe(20);
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.succeeded).toBeGreaterThan(0);
  });

  it('should include exploitable error info in failed results', async () => {
    const pools = [makePool(1)];
    mockCreate.mockRejectedValue(new Error('Timeout after 8000ms'));

    const summary = await batchAnalyzePools(
      pools,
      { batchSize: 10, maxRetries: 0 },
      mockClient
    );

    const failed = summary.results.filter((r) => r.error);
    expect(failed[0].error).toContain('Timeout');
    expect(failed[0].pool.address).toBe(pools[0].address);
    expect(failed[0].attempts).toBeGreaterThan(0);
  });
});
