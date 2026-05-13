export interface PoolData {
  address: string;
  pair: string;
  tvl: number;
  fees24h: number;
  volume24h: number;
  binStep: number;
  poolAge: number;
}

export interface RawPoolResponse {
  address?: string;
  pair?: string;
  tvl?: number | string;
  fees24h?: number | string;
  volume24h?: number | string;
  binStep?: number | string;
  poolAge?: number | string;
}

export interface ApiResponse {
  pairs: RawPoolResponse[];
}
