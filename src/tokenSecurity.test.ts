import axios from 'axios';
import {
  scoreToken,
  checkToken,
  checkPoolSecurity,
  checkPoolsBatch,
  fetchRugcheck,
  fetchBirdeye,
} from './tokenSecurity';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

const SAFE_MINT = 'SafeMint111111111111111111111111111111111111';
const WARN_MINT = 'WarnMint111111111111111111111111111111111111';
const DANGER_MINT = 'DangerMint11111111111111111111111111111111111';

const OLD_DATE_MS = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago
const RECENT_DATE_MS = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago

const rugcheckSafeResponse = {
  data: {
    mintAuthority: null,
    freezeAuthority: null,
    topHolders: [{ pct: 5 }, { pct: 3 }, { pct: 2 }],
    createdAt: Math.floor(OLD_DATE_MS / 1000),
  },
};

const rugcheckDangerResponse = {
  data: {
    mintAuthority: 'SomeAuthority111111111111111111111111111111',
    freezeAuthority: 'SomeFreeze111111111111111111111111111111111',
    topHolders: [{ pct: 40 }, { pct: 20 }, { pct: 5 }],
    createdAt: Math.floor(RECENT_DATE_MS / 1000),
  },
};

const birdeyeSafeResponse = {
  data: {
    data: {
      mintAuthority: null,
      freezeAuthority: null,
      top10HolderPercent: 0.1,
      creationTx: { blockTime: Math.floor(OLD_DATE_MS / 1000) },
    },
  },
};

const birdeyeWarnResponse = {
  data: {
    data: {
      mintAuthority: null,
      freezeAuthority: 'SomeFreeze111111111111111111111111111111111',
      top10HolderPercent: 0.35,
      creationTx: { blockTime: Math.floor(OLD_DATE_MS / 1000) },
    },
  },
};

describe('scoreToken', () => {
  it('returns safe when no issues', () => {
    const r = scoreToken(SAFE_MINT, false, false, 10, 365);
    expect(r.level).toBe('safe');
    expect(r.flags).toHaveLength(0);
  });

  it('returns danger when mint authority active', () => {
    const r = scoreToken(DANGER_MINT, true, false, 10, 365);
    expect(r.level).toBe('danger');
    expect(r.flags.some(f => f.includes('Mint authority'))).toBe(true);
  });

  it('returns warn when freeze authority active', () => {
    const r = scoreToken(WARN_MINT, false, true, 10, 365);
    expect(r.level).toBe('warn');
    expect(r.flags.some(f => f.includes('Freeze authority'))).toBe(true);
  });

  it('returns danger when top holders > 50%', () => {
    const r = scoreToken(DANGER_MINT, false, false, 55, 365);
    expect(r.level).toBe('danger');
    expect(r.flags.some(f => f.includes('concentrated'))).toBe(true);
  });

  it('returns warn when top holders between 30-50%', () => {
    const r = scoreToken(WARN_MINT, false, false, 35, 365);
    expect(r.level).toBe('warn');
  });

  it('returns danger when contract age < 7 days', () => {
    const r = scoreToken(DANGER_MINT, false, false, 10, 3);
    expect(r.level).toBe('danger');
    expect(r.flags.some(f => f.includes('days old'))).toBe(true);
  });

  it('returns warn when contract age between 7-30 days', () => {
    const r = scoreToken(WARN_MINT, false, false, 10, 15);
    expect(r.level).toBe('warn');
  });

  it('danger overrides warn', () => {
    const r = scoreToken(DANGER_MINT, true, true, 10, 15);
    expect(r.level).toBe('danger');
  });

  it('returns correct fields', () => {
    const r = scoreToken(SAFE_MINT, false, false, 10, 365);
    expect(r.mint).toBe(SAFE_MINT);
    expect(r.mintAuthorityActive).toBe(false);
    expect(r.freezeAuthorityActive).toBe(false);
    expect(r.topHoldersConcentration).toBe(10);
    expect(r.contractAgedays).toBe(365);
  });
});

describe('fetchRugcheck', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches rugcheck report', async () => {
    mockAxios.get.mockResolvedValueOnce(rugcheckSafeResponse);
    const r = await fetchRugcheck(SAFE_MINT);
    expect(r.mintAuthority).toBeNull();
    expect(mockAxios.get).toHaveBeenCalledWith(
      expect.stringContaining(SAFE_MINT),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
  });
});

describe('fetchBirdeye', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches birdeye security data', async () => {
    mockAxios.get.mockResolvedValueOnce(birdeyeSafeResponse);
    const r = await fetchBirdeye(SAFE_MINT);
    expect(r.mintAuthority).toBeNull();
  });

  it('includes API key in headers when provided', async () => {
    mockAxios.get.mockResolvedValueOnce(birdeyeSafeResponse);
    await fetchBirdeye(SAFE_MINT, 'my-api-key');
    expect(mockAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-KEY': 'my-api-key' }) })
    );
  });
});

describe('checkToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns safe when both APIs report safe token', async () => {
    mockAxios.get
      .mockResolvedValueOnce(rugcheckSafeResponse)
      .mockResolvedValueOnce(birdeyeSafeResponse);
    const r = await checkToken(SAFE_MINT);
    expect(r.level).toBe('safe');
    expect(r.flags).toHaveLength(0);
  });

  it('returns danger when rugcheck reports danger', async () => {
    mockAxios.get
      .mockResolvedValueOnce(rugcheckDangerResponse)
      .mockResolvedValueOnce(birdeyeSafeResponse);
    const r = await checkToken(DANGER_MINT);
    expect(r.level).toBe('danger');
  });

  it('returns warn from birdeye when rugcheck safe', async () => {
    mockAxios.get
      .mockResolvedValueOnce(rugcheckSafeResponse)
      .mockResolvedValueOnce(birdeyeWarnResponse);
    const r = await checkToken(WARN_MINT);
    expect(r.level).toBe('warn');
  });

  it('still resolves when one API fails', async () => {
    mockAxios.get
      .mockRejectedValueOnce(new Error('Rugcheck timeout'))
      .mockResolvedValueOnce(birdeyeSafeResponse);
    const r = await checkToken(SAFE_MINT);
    expect(r.level).toBe('safe');
  });

  it('throws when both APIs fail', async () => {
    mockAxios.get
      .mockRejectedValueOnce(new Error('Rugcheck down'))
      .mockRejectedValueOnce(new Error('Birdeye down'));
    await expect(checkToken(DANGER_MINT)).rejects.toThrow();
  });
});

describe('checkPoolSecurity', () => {
  beforeEach(() => jest.clearAllMocks());

  const pool = {
    poolAddress: 'Pool111111111111111111111111111111111111111',
    tokenXMint: SAFE_MINT,
    tokenYMint: WARN_MINT,
  };

  it('returns worst level of the two tokens', async () => {
    mockAxios.get
      .mockResolvedValueOnce(rugcheckSafeResponse)  // tokenX rugcheck
      .mockResolvedValueOnce(birdeyeSafeResponse)   // tokenX birdeye
      .mockResolvedValueOnce(rugcheckSafeResponse)  // tokenY rugcheck
      .mockResolvedValueOnce(birdeyeWarnResponse);  // tokenY birdeye

    const r = await checkPoolSecurity(pool);
    expect(r.level).toBe('warn');
    expect(r.tokenX.level).toBe('safe');
    expect(r.tokenY.level).toBe('warn');
    expect(r.poolAddress).toBe(pool.poolAddress);
  });

  it('returns danger when one token is dangerous', async () => {
    mockAxios.get
      .mockResolvedValueOnce(rugcheckDangerResponse)
      .mockResolvedValueOnce(birdeyeSafeResponse)
      .mockResolvedValueOnce(rugcheckSafeResponse)
      .mockResolvedValueOnce(birdeyeSafeResponse);

    const r = await checkPoolSecurity(pool);
    expect(r.level).toBe('danger');
  });

  it('returns danger with error field when both APIs crash', async () => {
    mockAxios.get.mockRejectedValue(new Error('Network error'));
    const r = await checkPoolSecurity(pool);
    expect(r.level).toBe('danger');
    expect(r.error).toBeDefined();
  });
});

describe('checkPoolsBatch', () => {
  beforeEach(() => jest.clearAllMocks());

  const pools = [
    { poolAddress: 'Pool1', tokenXMint: SAFE_MINT, tokenYMint: SAFE_MINT },
    { poolAddress: 'Pool2', tokenXMint: WARN_MINT, tokenYMint: SAFE_MINT },
    { poolAddress: 'Pool3', tokenXMint: DANGER_MINT, tokenYMint: SAFE_MINT },
  ];

  it('processes all pools and returns results', async () => {
    mockAxios.get.mockResolvedValue(rugcheckSafeResponse);

    const results = await checkPoolsBatch(pools);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.poolAddress)).toBe(true);
  });

  it('respects concurrency limit — processes in batches', async () => {
    mockAxios.get.mockResolvedValue(rugcheckSafeResponse);

    const results = await checkPoolsBatch(pools, undefined, 2);
    expect(results).toHaveLength(3);
  });

  it('continues batch even when one pool fails', async () => {
    mockAxios.get
      .mockResolvedValue(rugcheckSafeResponse)
      .mockRejectedValueOnce(new Error('Pool2 error'));

    const results = await checkPoolsBatch(pools, undefined, 1);
    expect(results).toHaveLength(3);
  });
});
