import express from 'express';
import path from 'path';
import axios from 'axios';
import { PoolData } from './types';
import { calculateFeeTvlRatio, calculateVolumeTvlRatio, calculatePoolAgeHours } from './poolMetrics';

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, '../public')));

const API_URL = 'https://dlmm.datapi.meteora.ag/pools';

app.get('/api/pairs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const searchAddress = (req.query.address as string)?.toLowerCase() || '';
    const searchName = (req.query.name as string)?.toLowerCase() || '';

    const response = await axios.get<any>(API_URL, {
      params: {
        offset,
        limit: Math.min(limit, 100),
      },
    });

    if (!response.data?.data) {
      throw new Error('Invalid API response');
    }

    let pools = response.data.data.map(extractPoolData).filter((p: PoolData | null) => p) as PoolData[];

    if (searchAddress) {
      pools = pools.filter((p: PoolData) => p.address.toLowerCase().includes(searchAddress));
    }
    if (searchName) {
      pools = pools.filter((p: PoolData) => p.pair.toLowerCase().includes(searchName));
    }

    res.json({
      success: true,
      data: pools,
      count: pools.length,
      page,
      total: response.data.total || 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

function extractPoolData(raw: any): PoolData | null {
  try {
    const address = extractString(raw.address, 'address');
    const pair = extractString(raw.name, 'pair name');
    const tvl = extractNumber(raw.tvl, 'tvl');
    const fees24h = extractNumber(raw.fees?.['24h'], 'fees.24h');
    const volume24h = extractNumber(raw.volume?.['24h'], 'volume.24h');
    const binStep = extractNumber(raw.pool_config?.bin_step, 'bin_step');
    const poolAge = calculatePoolAge(raw.created_at);

    const feeTvlRatioPercent = calculateFeeTvlRatio(tvl, fees24h);
    const volumeTvlRatio = calculateVolumeTvlRatio(tvl, volume24h);
    const poolAgeHours = calculatePoolAgeHours(poolAge);

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
    };
  } catch {
    return null;
  }
}

function extractString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be string`);
  }
  if (!value.trim()) {
    throw new Error(`${fieldName} empty`);
  }
  return value;
}

function extractNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`${fieldName} invalid`);
  }
  if (num < 0) {
    throw new Error(`${fieldName} negative`);
  }
  return num;
}

function calculatePoolAge(createdAt: unknown): number {
  const timestamp = Number(createdAt);
  if (isNaN(timestamp)) throw new Error('timestamp invalid');
  return Math.max(0, (Date.now() - timestamp) / 1000);
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
