export interface PoolInputs {
  tvl: number;
  volume24h: number;
  fees24h: number;
  myCapital: number;
}

export interface ProfitabilityMetrics {
  realFeeRate: number;
  volumeTvlRatio: number;
  estimatedApr: number;
  myDailyRevenue: number;
  myMonthlyRevenue: number;
  myAnnualRevenue: number;
  score: number;
  verdict: 'excellent' | 'decent' | 'low';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeProfitability(inputs: PoolInputs): ProfitabilityMetrics {
  const { tvl, volume24h, fees24h, myCapital } = inputs;

  const realFeeRate = volume24h > 0 ? (fees24h / volume24h) * 100 : 0;
  const volumeTvlRatio = tvl > 0 ? volume24h / tvl : 0;
  const estimatedApr = tvl > 0 ? (fees24h * 365 / tvl) * 100 : 0;

  const myShare = tvl > 0 ? myCapital / tvl : 0;
  const myDailyRevenue = fees24h * myShare;
  const myMonthlyRevenue = myDailyRevenue * 30;
  const myAnnualRevenue = myDailyRevenue * 365;

  const vtlScore = clamp((volumeTvlRatio / 3) * 100, 0, 100);
  const aprScore = clamp((estimatedApr / 300) * 100, 0, 100);
  const feeRateScore = clamp((realFeeRate / 0.5) * 100, 0, 100);
  const score = vtlScore * 0.50 + aprScore * 0.35 + feeRateScore * 0.15;

  const verdict: 'excellent' | 'decent' | 'low' =
    score >= 70 ? 'excellent' : score >= 40 ? 'decent' : 'low';

  return {
    realFeeRate,
    volumeTvlRatio,
    estimatedApr,
    myDailyRevenue,
    myMonthlyRevenue,
    myAnnualRevenue,
    score,
    verdict,
  };
}

export function rankPools(
  pools: Array<{ label: string } & PoolInputs>
): Array<{ label: string } & PoolInputs & ProfitabilityMetrics> {
  return pools
    .map((p) => ({ ...p, ...computeProfitability(p) }))
    .sort((a, b) => b.score - a.score);
}
