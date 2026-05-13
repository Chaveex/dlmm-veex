import axios from 'axios';
import { PoolData, RawPool, ApiResponse } from './types';

const API_URL = 'https://dlmm.datapi.meteora.ag/pools';

export async function fetchPairs(limit: number = 100): Promise<PoolData[]> {
  const response = await axios.get<ApiResponse>(API_URL, {
    params: { limit },
  });

  if (!response.data || !Array.isArray(response.data.data)) {
    throw new Error('Invalid API response: data array not found');
  }

  return response.data.data.map(extractPoolData);
}

function extractPoolData(raw: RawPool): PoolData {
  const address = extractString(raw.address, 'address');
  const pair = extractString(raw.name, 'pair name');
  const tvl = extractNumber(raw.tvl, 'tvl');
  const fees24h = extractNumber(raw.fees?.['24h'], 'fees.24h');
  const volume24h = extractNumber(raw.volume?.['24h'], 'volume.24h');
  const binStep = extractNumber(raw.pool_config?.bin_step, 'pool_config.bin_step');
  const poolAge = calculatePoolAge(raw.created_at);

  return {
    address,
    pair,
    tvl,
    fees24h,
    volume24h,
    binStep,
    poolAge,
  };
}

function calculatePoolAge(createdAt: unknown): number {
  const timestamp = Number(createdAt);
  if (isNaN(timestamp)) {
    throw new Error('Field created_at must be a valid timestamp');
  }
  const ageMs = Date.now() - timestamp;
  const ageSeconds = Math.max(0, ageMs / 1000);
  return ageSeconds;
}

function extractString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Field ${fieldName} must be a string, got ${typeof value}`);
  }
  if (value.trim() === '') {
    throw new Error(`Field ${fieldName} cannot be empty`);
  }
  return value;
}

function extractNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`Field ${fieldName} must be a valid number, got ${value}`);
  }
  if (num < 0) {
    throw new Error(`Field ${fieldName} must be non-negative, got ${num}`);
  }
  return num;
}

async function main(): Promise<void> {
  const pools = await fetchPairs();
  console.log(`Fetched ${pools.length} pools`);
  console.table(pools);
}

main().catch(console.error);
