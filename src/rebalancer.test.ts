import { isOutOfRange, canRebalance, computeNewRange, performRebalance } from './rebalancer';
import { BotPosition, BotConfig } from './types';

jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn(),
  Keypair: {
    generate: jest.fn(() => ({
      publicKey: { toString: () => 'MockPubkey', toBuffer: () => Buffer.alloc(32) },
      secretKey: new Uint8Array(64),
    })),
  },
  PublicKey: jest.fn().mockImplementation((key: string) => ({
    toString: () => key,
    toBuffer: () => Buffer.alloc(32),
  })),
  Transaction: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    sign: jest.fn(),
    serialize: jest.fn(() => Buffer.from('mocktx')),
    recentBlockhash: '',
    feePayer: null,
  })),
}));

function makePosition(overrides: Partial<BotPosition> = {}): BotPosition {
  return {
    poolAddress: 'PoolAddr1111111111111111111111111111111111',
    pair: 'SOL-USDC',
    capitalDeployed: 1,
    signature: 'sig1',
    timestamp: Date.now(),
    status: 'open',
    rangeLowerBinId: 100,
    rangeUpperBinId: 140,
    activeBinAtOpen: 120,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    minScore: 70,
    maxCapitalPerPosition: 1,
    maxSimultaneousPositions: 3,
    updateIntervalMs: 60000,
    keypairPath: 'bot-keypair.json',
    dryRun: true,
    rebalanceCooldownMs: 300_000,
    rangeWidthBins: 20,
    ...overrides,
  };
}

describe('isOutOfRange', () => {
  it('returns false when active bin inside range', () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    expect(isOutOfRange(pos, 120)).toBe(false);
  });

  it('returns false when active bin equals lower bound', () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    expect(isOutOfRange(pos, 100)).toBe(false);
  });

  it('returns false when active bin equals upper bound', () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    expect(isOutOfRange(pos, 140)).toBe(false);
  });

  it('returns true when active bin below range', () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    expect(isOutOfRange(pos, 99)).toBe(true);
  });

  it('returns true when active bin above range', () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    expect(isOutOfRange(pos, 141)).toBe(true);
  });

  it('returns false when range not set (undefined bounds)', () => {
    const pos = makePosition({ rangeLowerBinId: undefined, rangeUpperBinId: undefined });
    expect(isOutOfRange(pos, 200)).toBe(false);
  });
});

describe('canRebalance', () => {
  it('returns true when never rebalanced', () => {
    const pos = makePosition({ lastRebalanceAt: undefined });
    expect(canRebalance(pos, 300_000)).toBe(true);
  });

  it('returns false when cooldown not elapsed', () => {
    const pos = makePosition({ lastRebalanceAt: Date.now() - 60_000 }); // 1min ago
    expect(canRebalance(pos, 300_000)).toBe(false); // cooldown 5min
  });

  it('returns true when cooldown elapsed', () => {
    const pos = makePosition({ lastRebalanceAt: Date.now() - 400_000 }); // 6.7min ago
    expect(canRebalance(pos, 300_000)).toBe(true);
  });

  it('returns true at exact cooldown boundary', () => {
    const cooldown = 300_000;
    const pos = makePosition({ lastRebalanceAt: Date.now() - cooldown });
    expect(canRebalance(pos, cooldown)).toBe(true);
  });
});

describe('computeNewRange', () => {
  it('computes symmetric range', () => {
    const { lower, upper } = computeNewRange(120, 20);
    expect(lower).toBe(100);
    expect(upper).toBe(140);
  });

  it('handles bin 0 (lower goes negative)', () => {
    const { lower, upper } = computeNewRange(0, 10);
    expect(lower).toBe(-10);
    expect(upper).toBe(10);
  });

  it('uses rangeWidthBins correctly', () => {
    const { lower, upper } = computeNewRange(500, 5);
    expect(upper - lower).toBe(10);
    expect(lower).toBe(495);
    expect(upper).toBe(505);
  });
});

describe('performRebalance', () => {
  const mockConnection = {
    getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: 'mockblockhash', lastValidBlockHeight: 100 }),
    sendRawTransaction: jest.fn().mockResolvedValue('realSig'),
    confirmTransaction: jest.fn().mockResolvedValue({}),
  } as any;

  const mockKeypair = {
    publicKey: { toString: () => 'MockPubkey', toBuffer: () => Buffer.alloc(32) },
    secretKey: new Uint8Array(64),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('returns rebalanced=true with new range in dry run', async () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    const config = makeConfig({ dryRun: true, rangeWidthBins: 20 });

    const result = await performRebalance(pos, 160, config, mockKeypair, mockConnection);

    expect(result.rebalanced).toBe(true);
    expect(result.newRangeLowerBinId).toBe(140); // 160 - 20
    expect(result.newRangeUpperBinId).toBe(180); // 160 + 20
    expect(result.newActiveBin).toBe(160);
    expect(result.removeSig).toMatch(/^sim_/);
    expect(result.openSig).toMatch(/^sim_/);
  });

  it('reason contains old range and new active bin', async () => {
    const pos = makePosition({ rangeLowerBinId: 100, rangeUpperBinId: 140 });
    const config = makeConfig({ dryRun: true });

    const result = await performRebalance(pos, 200, config, mockKeypair, mockConnection);

    expect(result.reason).toContain('200');
    expect(result.reason).toContain('100');
    expect(result.reason).toContain('140');
  });

  it('returns rebalanced=false on connection error', async () => {
    const failConnection = {
      getLatestBlockhash: jest.fn().mockRejectedValue(new Error('RPC down')),
    } as any;

    const pos = makePosition();
    const config = makeConfig({ dryRun: false });

    const result = await performRebalance(pos, 200, config, mockKeypair, failConnection);

    expect(result.rebalanced).toBe(false);
    expect(result.reason).toContain('RPC down');
  });
});
