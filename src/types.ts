export interface PoolData {
  address: string;
  pair: string;
  tvl: number;
  fees24h: number;
  volume24h: number;
  binStep: number;
  poolAge: number;
  feeTvlRatioPercent: number;
  volumeTvlRatio: number;
  poolAgeHours: number;
  tokenXMint: string;
  tokenYMint: string;
}

export interface RawPool {
  address?: string;
  name?: string;
  tvl?: number | string;
  volume?: { '24h'?: number | string };
  fees?: { '24h'?: number | string };
  pool_config?: { bin_step?: number | string };
  created_at?: number | string;
  token_x?: { address?: string };
  token_y?: { address?: string };
}

export interface ApiResponse {
  data?: RawPool[];
  total?: number;
}

export type SecurityLevel = 'safe' | 'warn' | 'danger';

export interface TokenSecurityResult {
  mint: string;
  level: SecurityLevel;
  flags: string[];
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  topHoldersConcentration: number;
  contractAgedays: number;
}

export interface PoolSecurityResult {
  poolAddress: string;
  level: SecurityLevel;
  tokenX: TokenSecurityResult;
  tokenY: TokenSecurityResult;
  error?: string;
}
