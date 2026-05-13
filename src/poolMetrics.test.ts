import {
  calculateFeeTvlRatio,
  calculateVolumeTrend,
  calculatePoolAgeHours,
  calculateVolumeTvlRatio,
  computePoolMetrics,
  PoolWithPreviousPeriod,
} from './poolMetrics';

describe('Pool Metrics', () => {
  describe('calculateFeeTvlRatio', () => {
    it('should calculate fee/TVL ratio as percentage', () => {
      const ratio = calculateFeeTvlRatio(1000000, 10000);
      expect(ratio).toBeCloseTo(1.0, 5);
    });

    it('should handle zero TVL', () => {
      const ratio = calculateFeeTvlRatio(0, 5000);
      expect(ratio).toBe(0);
    });

    it('should handle high fees relative to TVL', () => {
      const ratio = calculateFeeTvlRatio(100000, 5000);
      expect(ratio).toBeCloseTo(5.0, 5);
    });

    it('should handle small fees relative to TVL', () => {
      const ratio = calculateFeeTvlRatio(10000000, 100);
      expect(ratio).toBeCloseTo(0.001, 5);
    });

    it('should handle zero fees', () => {
      const ratio = calculateFeeTvlRatio(1000000, 0);
      expect(ratio).toBe(0);
    });
  });

  describe('calculateVolumeTrend', () => {
    it('should calculate positive trend (increase)', () => {
      const trend = calculateVolumeTrend(1000000, 500000);
      expect(trend).toBeCloseTo(100, 5);
    });

    it('should calculate negative trend (decrease)', () => {
      const trend = calculateVolumeTrend(250000, 1000000);
      expect(trend).toBeCloseTo(-75, 5);
    });

    it('should return 0 when no previous volume provided', () => {
      const trend = calculateVolumeTrend(1000000, undefined);
      expect(trend).toBe(0);
    });

    it('should return 0 when previous volume is zero', () => {
      const trend = calculateVolumeTrend(1000000, 0);
      expect(trend).toBe(0);
    });

    it('should handle same volume (0% change)', () => {
      const trend = calculateVolumeTrend(500000, 500000);
      expect(trend).toBeCloseTo(0, 5);
    });

    it('should handle small percentage changes', () => {
      const trend = calculateVolumeTrend(1005000, 1000000);
      expect(trend).toBeCloseTo(0.5, 5);
    });
  });

  describe('calculatePoolAgeHours', () => {
    it('should convert seconds to hours', () => {
      const hours = calculatePoolAgeHours(3600);
      expect(hours).toBe(1);
    });

    it('should handle 24 hours', () => {
      const hours = calculatePoolAgeHours(86400);
      expect(hours).toBe(24);
    });

    it('should handle fractional hours', () => {
      const hours = calculatePoolAgeHours(5400);
      expect(hours).toBeCloseTo(1.5, 5);
    });

    it('should handle zero seconds', () => {
      const hours = calculatePoolAgeHours(0);
      expect(hours).toBe(0);
    });

    it('should clamp negative values to 0', () => {
      const hours = calculatePoolAgeHours(-1000);
      expect(hours).toBe(0);
    });

    it('should handle large pool ages', () => {
      const hours = calculatePoolAgeHours(31536000); // 1 year
      expect(hours).toBe(8760);
    });
  });

  describe('calculateVolumeTvlRatio', () => {
    it('should calculate volume/TVL ratio', () => {
      const ratio = calculateVolumeTvlRatio(1000000, 5000000);
      expect(ratio).toBeCloseTo(5, 5);
    });

    it('should handle zero TVL', () => {
      const ratio = calculateVolumeTvlRatio(0, 1000000);
      expect(ratio).toBe(0);
    });

    it('should handle small volume relative to TVL', () => {
      const ratio = calculateVolumeTvlRatio(10000000, 100000);
      expect(ratio).toBeCloseTo(0.01, 5);
    });

    it('should handle zero volume', () => {
      const ratio = calculateVolumeTvlRatio(1000000, 0);
      expect(ratio).toBe(0);
    });

    it('should handle high volume relative to TVL', () => {
      const ratio = calculateVolumeTvlRatio(100000, 1000000);
      expect(ratio).toBeCloseTo(10, 5);
    });
  });

  describe('computePoolMetrics', () => {
    it('should compute all metrics correctly', () => {
      const pool: PoolWithPreviousPeriod = {
        tvl: 1000000,
        fees24h: 10000,
        volume24h: 5000000,
        poolAgeSeconds: 86400,
        volumePreviousPeriod24h: 4000000,
      };

      const metrics = computePoolMetrics(pool);

      expect(metrics.feeTvlRatio).toBeCloseTo(1.0, 5);
      expect(metrics.volumeTrendPercent).toBeCloseTo(25, 5);
      expect(metrics.poolAgeHours).toBe(24);
      expect(metrics.volumeTvlRatio).toBe(5);
    });

    it('should handle pool without previous volume data', () => {
      const pool: PoolWithPreviousPeriod = {
        tvl: 500000,
        fees24h: 2500,
        volume24h: 2000000,
        poolAgeSeconds: 3600,
      };

      const metrics = computePoolMetrics(pool);

      expect(metrics.feeTvlRatio).toBeCloseTo(0.5, 5);
      expect(metrics.volumeTrendPercent).toBe(0);
      expect(metrics.poolAgeHours).toBe(1);
      expect(metrics.volumeTvlRatio).toBe(4);
    });

    it('should handle zero TVL and fees', () => {
      const pool: PoolWithPreviousPeriod = {
        tvl: 0,
        fees24h: 0,
        volume24h: 0,
        poolAgeSeconds: 0,
      };

      const metrics = computePoolMetrics(pool);

      expect(metrics.feeTvlRatio).toBe(0);
      expect(metrics.volumeTrendPercent).toBe(0);
      expect(metrics.poolAgeHours).toBe(0);
      expect(metrics.volumeTvlRatio).toBe(0);
    });

    it('should handle large numbers without overflow', () => {
      const pool: PoolWithPreviousPeriod = {
        tvl: 1000000000,
        fees24h: 5000000,
        volume24h: 50000000000,
        poolAgeSeconds: 31536000,
        volumePreviousPeriod24h: 40000000000,
      };

      const metrics = computePoolMetrics(pool);

      expect(metrics.feeTvlRatio).toBeCloseTo(0.5, 5);
      expect(metrics.volumeTrendPercent).toBeCloseTo(25, 5);
      expect(metrics.poolAgeHours).toBe(8760);
      expect(metrics.volumeTvlRatio).toBe(50);
    });
  });
});
