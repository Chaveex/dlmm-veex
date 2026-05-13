import axios, { AxiosError } from 'axios';
import { SecurityLevel, TokenSecurityResult, PoolSecurityResult } from './types';

const TIMEOUT_MS = 8000;

const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1';
const BIRDEYE_BASE = 'https://public-api.birdeye.so';

const DANGER_HOLDER_CONCENTRATION = 50;
const WARN_HOLDER_CONCENTRATION = 30;
const DANGER_CONTRACT_AGE_DAYS = 7;
const WARN_CONTRACT_AGE_DAYS = 30;

export interface RugcheckReport {
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  topHolders?: Array<{ pct: number }>;
  createdAt?: string | number;
  risks?: Array<{ level: string; description: string }>;
}

export interface BirdeyeSecurity {
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  top10HolderPercent?: number;
  creationTx?: { blockTime?: number };
}

export async function fetchRugcheck(mint: string): Promise<RugcheckReport> {
  const res = await axios.get<RugcheckReport>(
    `${RUGCHECK_BASE}/tokens/${mint}/report/summary`,
    { timeout: TIMEOUT_MS }
  );
  return res.data;
}

export async function fetchBirdeye(mint: string, apiKey?: string): Promise<BirdeyeSecurity> {
  const headers: Record<string, string> = { 'X-Chain': 'solana' };
  if (apiKey) headers['X-API-KEY'] = apiKey;
  const res = await axios.get<{ data: BirdeyeSecurity }>(
    `${BIRDEYE_BASE}/defi/token_security?address=${mint}`,
    { timeout: TIMEOUT_MS, headers }
  );
  return res.data.data;
}

export function scoreToken(
  mint: string,
  mintAuthorityActive: boolean,
  freezeAuthorityActive: boolean,
  topHoldersConcentration: number,
  contractAgeDays: number
): TokenSecurityResult {
  const flags: string[] = [];
  let level: SecurityLevel = 'safe';

  if (mintAuthorityActive) {
    flags.push('Mint authority active — supply can be inflated');
    level = 'danger';
  }

  if (freezeAuthorityActive) {
    flags.push('Freeze authority active — accounts can be frozen');
    if (level !== 'danger') level = 'warn';
  }

  if (topHoldersConcentration >= DANGER_HOLDER_CONCENTRATION) {
    flags.push(`Top holders own ${topHoldersConcentration.toFixed(1)}% — very concentrated`);
    level = 'danger';
  } else if (topHoldersConcentration >= WARN_HOLDER_CONCENTRATION) {
    flags.push(`Top holders own ${topHoldersConcentration.toFixed(1)}% — concentrated`);
    if (level !== 'danger') level = 'warn';
  }

  if (contractAgeDays <= DANGER_CONTRACT_AGE_DAYS) {
    flags.push(`Contract only ${contractAgeDays.toFixed(1)} days old — very recent`);
    level = 'danger';
  } else if (contractAgeDays <= WARN_CONTRACT_AGE_DAYS) {
    flags.push(`Contract ${contractAgeDays.toFixed(1)} days old — recent`);
    if (level !== 'danger') level = 'warn';
  }

  return {
    mint,
    level,
    flags,
    mintAuthorityActive,
    freezeAuthorityActive,
    topHoldersConcentration,
    contractAgedays: contractAgeDays,
  };
}

export async function checkToken(mint: string, birdeyeApiKey?: string): Promise<TokenSecurityResult> {
  const [rugcheckResult, birdeyeResult] = await Promise.allSettled([
    fetchRugcheck(mint),
    fetchBirdeye(mint, birdeyeApiKey),
  ]);

  let mintAuthorityActive = false;
  let freezeAuthorityActive = false;
  let topHoldersConcentration = 0;
  let contractAgeDays = 9999;

  if (rugcheckResult.status === 'fulfilled') {
    const r = rugcheckResult.value;
    mintAuthorityActive = !!r.mintAuthority;
    freezeAuthorityActive = !!r.freezeAuthority;
    topHoldersConcentration = r.topHolders?.reduce((sum, h) => sum + (h.pct || 0), 0) ?? 0;
    if (r.createdAt) {
      const ts = typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : r.createdAt * 1000;
      contractAgeDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    }
  }

  if (birdeyeResult.status === 'fulfilled') {
    const b = birdeyeResult.value;
    mintAuthorityActive = mintAuthorityActive || !!b.mintAuthority;
    freezeAuthorityActive = freezeAuthorityActive || !!b.freezeAuthority;
    if (b.top10HolderPercent !== undefined) {
      topHoldersConcentration = Math.max(topHoldersConcentration, b.top10HolderPercent * 100);
    }
    if (b.creationTx?.blockTime && contractAgeDays === 9999) {
      contractAgeDays = (Date.now() - b.creationTx.blockTime * 1000) / (1000 * 60 * 60 * 24);
    }
  }

  if (rugcheckResult.status === 'rejected' && birdeyeResult.status === 'rejected') {
    throw new Error(`Both APIs failed for ${mint}: ${(rugcheckResult.reason as AxiosError).message}`);
  }

  return scoreToken(mint, mintAuthorityActive, freezeAuthorityActive, topHoldersConcentration, contractAgeDays);
}

export interface PoolCandidate {
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
}

export async function checkPoolSecurity(
  pool: PoolCandidate,
  birdeyeApiKey?: string
): Promise<PoolSecurityResult> {
  try {
    const [tokenX, tokenY] = await Promise.all([
      checkToken(pool.tokenXMint, birdeyeApiKey),
      checkToken(pool.tokenYMint, birdeyeApiKey),
    ]);

    const worstLevel = (a: SecurityLevel, b: SecurityLevel): SecurityLevel => {
      if (a === 'danger' || b === 'danger') return 'danger';
      if (a === 'warn' || b === 'warn') return 'warn';
      return 'safe';
    };

    return {
      poolAddress: pool.poolAddress,
      level: worstLevel(tokenX.level, tokenY.level),
      tokenX,
      tokenY,
    };
  } catch (err) {
    return {
      poolAddress: pool.poolAddress,
      level: 'danger',
      tokenX: scoreToken(pool.tokenXMint, false, false, 0, 9999),
      tokenY: scoreToken(pool.tokenYMint, false, false, 0, 9999),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function checkPoolsBatch(
  pools: PoolCandidate[],
  birdeyeApiKey?: string,
  concurrency: number = 5
): Promise<PoolSecurityResult[]> {
  const results: PoolSecurityResult[] = [];

  for (let i = 0; i < pools.length; i += concurrency) {
    const batch = pools.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((p) => checkPoolSecurity(p, birdeyeApiKey))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          poolAddress: 'unknown',
          level: 'danger',
          tokenX: scoreToken('unknown', false, false, 0, 9999),
          tokenY: scoreToken('unknown', false, false, 0, 9999),
          error: result.reason?.message ?? 'Batch error',
        });
      }
    }
  }

  return results;
}
