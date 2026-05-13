export interface PoolMetrics {
  feeTvlRatio: number;
  volumeTrendPercent: number;
  poolAgeHours: number;
  volumeTvlRatio: number;
}

export interface PoolSnapshot {
  tvl: number;
  fees24h: number;
  volume24h: number;
  poolAgeSeconds: number;
}

export interface PoolWithPreviousPeriod extends PoolSnapshot {
  volumePreviousPeriod24h?: number;
}

/**
 * Calculate fee/TVL ratio as percentage
 * @param tvl Total Value Locked
 * @param fees24h 24h fees earned
 * @returns fee/TVL ratio as percentage (0-100)
 */
export function calculateFeeTvlRatio(tvl: number, fees24h: number): number {
  if (tvl <= 0) {
    return 0;
  }
  return (fees24h / tvl) * 100;
}

/**
 * Calculate volume trend percentage
 * Positive = increase, Negative = decrease vs previous period
 * @param currentVolume24h Current 24h volume
 * @param previousVolume24h Previous 24h volume
 * @returns Trend as percentage change
 */
export function calculateVolumeTrend(
  currentVolume24h: number,
  previousVolume24h: number | undefined
): number {
  if (!previousVolume24h || previousVolume24h <= 0) {
    return 0;
  }
  return ((currentVolume24h - previousVolume24h) / previousVolume24h) * 100;
}

/**
 * Convert pool age from seconds to hours
 * @param poolAgeSeconds Pool age in seconds
 * @returns Pool age in hours
 */
export function calculatePoolAgeHours(poolAgeSeconds: number): number {
  if (poolAgeSeconds < 0) {
    return 0;
  }
  return poolAgeSeconds / 3600;
}

/**
 * Calculate volume/TVL ratio
 * Higher = more trading activity relative to liquidity
 * @param tvl Total Value Locked
 * @param volume24h 24h trading volume
 * @returns volume/TVL ratio
 */
export function calculateVolumeTvlRatio(tvl: number, volume24h: number): number {
  if (tvl <= 0) {
    return 0;
  }
  return volume24h / tvl;
}

/**
 * Compute all metrics for a pool
 * @param pool Pool snapshot with current data
 * @returns All calculated metrics
 */
export function computePoolMetrics(pool: PoolWithPreviousPeriod): PoolMetrics {
  const feeTvlRatio = calculateFeeTvlRatio(pool.tvl, pool.fees24h);
  const volumeTrendPercent = calculateVolumeTrend(pool.volume24h, pool.volumePreviousPeriod24h);
  const poolAgeHours = calculatePoolAgeHours(pool.poolAgeSeconds);
  const volumeTvlRatio = calculateVolumeTvlRatio(pool.tvl, pool.volume24h);

  return {
    feeTvlRatio,
    volumeTrendPercent,
    poolAgeHours,
    volumeTvlRatio,
  };
}
