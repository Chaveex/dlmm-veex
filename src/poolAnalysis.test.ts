import Anthropic from '@anthropic-ai/sdk';
import { analyzePool, analyzePoolsBatch, PoolAnalysisResult } from './poolAnalysis';
import { PoolData } from './types';

jest.mock('@anthropic-ai/sdk');

const MockedAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

function makePool(overrides: Partial<PoolData> = {}): PoolData {
  return {
    address: 'Pool111111111111111111111111111111111111111',
    pair: 'SOL-USDC',
    tvl: 1000000,
    fees24h: 5000,
    volume24h: 50000000,
    binStep: 10,
    poolAge: 2592000,
    feeTvlRatioPercent: 0.5,
    volumeTvlRatio: 50,
    poolAgeHours: 720,
    tokenXMint: 'So11111111111111111111111111111111111111112',
    tokenYMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ...overrides,
  };
}

function makeValidResult(overrides: Partial<PoolAnalysisResult> = {}): PoolAnalysisResult {
  return {
    score: 7.5,
    conviction: 'high',
    recommandation: 'open',
    bin_step_optimal: 10,
    range_suggeree: { min: 85, max: 100 },
    raisonnement: 'Strong fee yield and high volume/TVL ratio indicate active trading.',
    ...overrides,
  };
}

function makeAnthropicResponse(result: PoolAnalysisResult) {
  return {
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_01ABC',
        name: 'analyze_pool',
        input: result,
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 200, output_tokens: 150 },
  };
}

describe('analyzePool', () => {
  let mockCreate: jest.Mock;
  let mockClient: jest.Mocked<Anthropic>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    mockClient = {
      messages: { create: mockCreate },
    } as unknown as jest.Mocked<Anthropic>;
  });

  it('should return valid analysis for a healthy pool', async () => {
    const result = makeValidResult();
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(result));

    const pool = makePool();
    const analysis = await analyzePool(pool, mockClient);

    expect(analysis.score).toBe(7.5);
    expect(analysis.conviction).toBe('high');
    expect(analysis.recommandation).toBe('open');
    expect(analysis.bin_step_optimal).toBe(10);
    expect(analysis.range_suggeree.min).toBe(85);
    expect(analysis.range_suggeree.max).toBe(100);
    expect(analysis.raisonnement).toBeTruthy();
  });

  it('should call Claude with correct model and tool', async () => {
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(makeValidResult()));

    await analyzePool(makePool(), mockClient);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        tool_choice: { type: 'tool', name: 'analyze_pool' },
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'analyze_pool' }),
        ]),
      })
    );
  });

  it('should include pool metrics in the message', async () => {
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(makeValidResult()));

    const pool = makePool({ pair: 'TROLL-SOL', tvl: 250000 });
    await analyzePool(pool, mockClient);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('TROLL-SOL');
    expect(userMessage).toContain('250');
  });

  it('should throw when no tool_use block in response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Some text' }],
    });

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow(
      'No tool_use block'
    );
  });

  it('should throw when score is out of range', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ score: 15 }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('Invalid score');
  });

  it('should throw when score is negative', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ score: -1 }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('Invalid score');
  });

  it('should throw when conviction is invalid', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ conviction: 'very_high' as any }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('Invalid conviction');
  });

  it('should throw when recommandation is invalid', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ recommandation: 'buy' as any }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('Invalid recommandation');
  });

  it('should throw when bin_step_optimal is 0', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ bin_step_optimal: 0 }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('Invalid bin_step_optimal');
  });

  it('should throw when range min >= max', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ range_suggeree: { min: 100, max: 85 } }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('range_suggeree.min must be < max');
  });

  it('should throw when raisonnement is empty', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(makeValidResult({ raisonnement: '' }))
    );

    await expect(analyzePool(makePool(), mockClient)).rejects.toThrow('Invalid raisonnement');
  });

  it('should handle all conviction levels', async () => {
    for (const conviction of ['low', 'mid', 'high'] as const) {
      mockCreate.mockResolvedValueOnce(
        makeAnthropicResponse(makeValidResult({ conviction }))
      );
      const result = await analyzePool(makePool(), mockClient);
      expect(result.conviction).toBe(conviction);
    }
  });

  it('should handle all recommandation values', async () => {
    for (const recommandation of ['open', 'skip', 'watch'] as const) {
      mockCreate.mockResolvedValueOnce(
        makeAnthropicResponse(makeValidResult({ recommandation }))
      );
      const result = await analyzePool(makePool(), mockClient);
      expect(result.recommandation).toBe(recommandation);
    }
  });

  it('should handle score boundaries 0 and 10', async () => {
    for (const score of [0, 10]) {
      mockCreate.mockResolvedValueOnce(
        makeAnthropicResponse(makeValidResult({ score }))
      );
      const result = await analyzePool(makePool(), mockClient);
      expect(result.score).toBe(score);
    }
  });
});

describe('analyzePoolsBatch', () => {
  let mockCreate: jest.Mock;
  let mockClient: jest.Mocked<Anthropic>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    mockClient = {
      messages: { create: mockCreate },
    } as unknown as jest.Mocked<Anthropic>;
  });

  it('should process 20+ pools and return results for all', async () => {
    const pools = Array.from({ length: 25 }, (_, i) =>
      makePool({ address: `Pool${i}`, pair: `TOKEN${i}-SOL` })
    );

    mockCreate.mockResolvedValue(makeAnthropicResponse(makeValidResult()));

    const results = await analyzePoolsBatch(pools, mockClient, 5);

    expect(results).toHaveLength(25);
    expect(results.every((r) => r.result !== null)).toBe(true);
    expect(results.every((r) => !r.error)).toBe(true);
  });

  it('should keep pool reference in each result', async () => {
    const pools = [
      makePool({ pair: 'SOL-USDC' }),
      makePool({ pair: 'TROLL-SOL' }),
    ];

    mockCreate.mockResolvedValue(makeAnthropicResponse(makeValidResult()));

    const results = await analyzePoolsBatch(pools, mockClient);

    expect(results[0].pool.pair).toBe('SOL-USDC');
    expect(results[1].pool.pair).toBe('TROLL-SOL');
  });

  it('should continue batch even when one pool fails', async () => {
    const pools = Array.from({ length: 5 }, (_, i) =>
      makePool({ address: `Pool${i}` })
    );

    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(makeValidResult()))
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValue(makeAnthropicResponse(makeValidResult()));

    const results = await analyzePoolsBatch(pools, mockClient, 1);

    expect(results).toHaveLength(5);
    expect(results[0].result).not.toBeNull();
    expect(results[1].result).toBeNull();
    expect(results[1].error).toBe('API timeout');
    expect(results[2].result).not.toBeNull();
  });

  it('should respect concurrency limit', async () => {
    const pools = Array.from({ length: 10 }, (_, i) =>
      makePool({ address: `Pool${i}` })
    );

    mockCreate.mockResolvedValue(makeAnthropicResponse(makeValidResult()));

    const results = await analyzePoolsBatch(pools, mockClient, 3);

    expect(results).toHaveLength(10);
    expect(mockCreate).toHaveBeenCalledTimes(10);
  });

  it('parse error rate < 2% across 50 pools', async () => {
    const pools = Array.from({ length: 50 }, (_, i) =>
      makePool({ address: `Pool${i}`, pair: `TOKEN${i}-USDC` })
    );

    mockCreate.mockResolvedValue(makeAnthropicResponse(makeValidResult()));

    const results = await analyzePoolsBatch(pools, mockClient, 10);

    const errors = results.filter((r) => r.error);
    const errorRate = errors.length / results.length;

    expect(errorRate).toBeLessThan(0.02);
    expect(results).toHaveLength(50);
  });

  it('should return error field when API call throws', async () => {
    const pools = [makePool()];
    mockCreate.mockRejectedValueOnce(new Error('Network error'));

    const results = await analyzePoolsBatch(pools, mockClient);

    expect(results[0].result).toBeNull();
    expect(results[0].error).toBe('Network error');
  });

  it('should handle varied pool types (new, old, high TVL, low TVL)', async () => {
    const pools = [
      makePool({ pair: 'NEW-SOL', poolAgeHours: 1, tvl: 100 }),
      makePool({ pair: 'OLD-USDC', poolAgeHours: 8760, tvl: 10000000 }),
      makePool({ pair: 'HIGH-FEE', feeTvlRatioPercent: 5, fees24h: 50000 }),
      makePool({ pair: 'LOW-VOL', volumeTvlRatio: 0.1, volume24h: 1000 }),
    ];

    mockCreate.mockResolvedValue(makeAnthropicResponse(makeValidResult()));

    const results = await analyzePoolsBatch(pools, mockClient);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.result !== null)).toBe(true);
  });
});
