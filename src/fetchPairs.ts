import axios from 'axios';
import { PoolData, RawPoolResponse, ApiResponse } from './types';

const API_URL = 'https://dlmm-api.meteora.ag/pair/all';

export async function fetchPairs(): Promise<PoolData[]> {
  const response = await axios.get<ApiResponse>(API_URL);

  if (!response.data || !Array.isArray(response.data.pairs)) {
    throw new Error('Invalid API response: pairs array not found');
  }

  return response.data.pairs.map(extractPoolData);
}

function extractPoolData(raw: RawPoolResponse): PoolData {
  const address = extractString(raw.address, 'address');
  const pair = extractString(raw.pair, 'pair');
  const tvl = extractNumber(raw.tvl, 'tvl');
  const fees24h = extractNumber(raw.fees24h, 'fees24h');
  const volume24h = extractNumber(raw.volume24h, 'volume24h');
  const binStep = extractNumber(raw.binStep, 'binStep');
  const poolAge = extractNumber(raw.poolAge, 'poolAge');

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
