import { computeProfitability, rankPools, PoolInputs } from './profitability';

const BASE: PoolInputs = {
  tvl: 1_000_000,
  volume24h: 5_000_000,
  fees24h: 10_000,
  myCapital: 10_000,
};

describe('computeProfitability', () => {
  it('calculates realFeeRate', () => {
    const { realFeeRate } = computeProfitability(BASE);
    expect(realFeeRate).toBeCloseTo((10_000 / 5_000_000) * 100, 5);
  });

  it('calculates volumeTvlRatio', () => {
    const { volumeTvlRatio } = computeProfitability(BASE);
    expect(volumeTvlRatio).toBeCloseTo(5_000_000 / 1_000_000, 5);
  });

  it('calculates estimatedApr', () => {
    const { estimatedApr } = computeProfitability(BASE);
    expect(estimatedApr).toBeCloseTo((10_000 * 365 / 1_000_000) * 100, 2);
  });

  it('calculates my revenues proportional to capital share', () => {
    const { myDailyRevenue, myMonthlyRevenue, myAnnualRevenue } = computeProfitability(BASE);
    const share = 10_000 / 1_000_000;
    expect(myDailyRevenue).toBeCloseTo(10_000 * share, 5);
    expect(myMonthlyRevenue).toBeCloseTo(myDailyRevenue * 30, 5);
    expect(myAnnualRevenue).toBeCloseTo(myDailyRevenue * 365, 5);
  });

  it('returns zero revenues when TVL is zero', () => {
    const { myDailyRevenue } = computeProfitability({ ...BASE, tvl: 0 });
    expect(myDailyRevenue).toBe(0);
  });

  it('returns zero feeRate when volume is zero', () => {
    const { realFeeRate } = computeProfitability({ ...BASE, volume24h: 0 });
    expect(realFeeRate).toBe(0);
  });

  it('computes score using weighted formula', () => {
    const { score, volumeTvlRatio, estimatedApr, realFeeRate } = computeProfitability(BASE);
    const vtlS = Math.min((volumeTvlRatio / 3) * 100, 100);
    const aprS = Math.min((estimatedApr / 300) * 100, 100);
    const feeS = Math.min((realFeeRate / 0.5) * 100, 100);
    const expected = vtlS * 0.50 + aprS * 0.35 + feeS * 0.15;
    expect(score).toBeCloseTo(expected, 5);
  });

  it('clamps score to [0, 100]', () => {
    const highPool: PoolInputs = { tvl: 100, volume24h: 1_000_000, fees24h: 100_000, myCapital: 10 };
    const { score } = computeProfitability(highPool);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('verdict excellent when score >= 70', () => {
    const highPool: PoolInputs = { tvl: 100_000, volume24h: 1_000_000, fees24h: 50_000, myCapital: 1_000 };
    const { verdict } = computeProfitability(highPool);
    expect(verdict).toBe('excellent');
  });

  it('verdict decent when score 40-69', () => {
    // vtlRatio=1.5 → vtlScore=50, APR≈137% → aprScore≈45, feeRate≈0.25% → feeScore=50
    // score ≈ 25 + 15.75 + 7.5 = 48.25
    const midPool: PoolInputs = { tvl: 1_000_000, volume24h: 1_500_000, fees24h: 3_750, myCapital: 1_000 };
    const { verdict, score } = computeProfitability(midPool);
    expect(score).toBeGreaterThanOrEqual(40);
    expect(score).toBeLessThan(70);
    expect(verdict).toBe('decent');
  });

  it('verdict low when score < 40', () => {
    const lowPool: PoolInputs = { tvl: 10_000_000, volume24h: 10_000, fees24h: 10, myCapital: 100 };
    const { verdict } = computeProfitability(lowPool);
    expect(verdict).toBe('low');
  });

  it('score is 0 when all inputs are 0', () => {
    const { score, myDailyRevenue } = computeProfitability({ tvl: 0, volume24h: 0, fees24h: 0, myCapital: 0 });
    expect(score).toBe(0);
    expect(myDailyRevenue).toBe(0);
  });
});

describe('rankPools', () => {
  it('ranks pools by score descending', () => {
    const pools = [
      { label: 'Low', tvl: 10_000_000, volume24h: 10_000, fees24h: 10, myCapital: 100 },
      { label: 'High', tvl: 100_000, volume24h: 1_000_000, fees24h: 50_000, myCapital: 1_000 },
      { label: 'Mid', tvl: 1_000_000, volume24h: 500_000, fees24h: 1_500, myCapital: 1_000 },
    ];

    const ranked = rankPools(pools);

    expect(ranked[0].label).toBe('High');
    expect(ranked[1].label).toBe('Mid');
    expect(ranked[2].label).toBe('Low');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it('includes computed metrics in ranked output', () => {
    const pools = [{ label: 'Pool', ...BASE }];
    const ranked = rankPools(pools);
    expect(ranked[0].estimatedApr).toBeGreaterThan(0);
    expect(ranked[0].verdict).toBeDefined();
  });

  it('handles single pool', () => {
    const pools = [{ label: 'Solo', ...BASE }];
    const ranked = rankPools(pools);
    expect(ranked).toHaveLength(1);
  });
});
