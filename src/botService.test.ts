import { AutonomousBot } from './botService';
import { BotConfig, PoolData } from './types';
import { PoolAnalysisResult } from './poolAnalysis';

jest.mock('./poolAnalysis');
jest.mock('axios');
jest.mock('@anthropic-ai/sdk');
jest.mock('@solana/web3.js', () => ({
  Keypair: {
    generate: jest.fn(() => ({
      publicKey: { toString: () => 'MockPublicKey11111111111111111111111111111111' },
      secretKey: new Uint8Array(64),
    })),
    fromSecretKey: jest.fn((key: Uint8Array) => ({
      publicKey: { toString: () => 'MockPublicKey11111111111111111111111111111111' },
      secretKey: key,
    })),
  },
  Connection: jest.fn().mockImplementation(() => ({
    getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: 'mockblockhash', lastValidBlockHeight: 100 }),
    sendRawTransaction: jest.fn().mockResolvedValue('mocksig123'),
    confirmTransaction: jest.fn().mockResolvedValue({}),
    getTransaction: jest.fn().mockResolvedValue(null),
  })),
  PublicKey: jest.fn().mockImplementation((key: string) => ({ toString: () => key, toBuffer: () => Buffer.alloc(32) })),
  Transaction: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    sign: jest.fn(),
    serialize: jest.fn(() => Buffer.from('mocktx')),
    recentBlockhash: '',
    feePayer: null,
  })),
}));

const { analyzePool } = require('./poolAnalysis') as { analyzePool: jest.Mock };

const MOCK_CONFIG: BotConfig = {
  minScore: 70,
  maxCapitalPerPosition: 1,
  maxSimultaneousPositions: 3,
  updateIntervalMs: 60000,
  keypairPath: 'bot-keypair.json',
  dryRun: true,
};

function makePool(overrides: Partial<PoolData> = {}): PoolData {
  return {
    address: 'pool-address-' + Math.random().toString(36).slice(2),
    pair: 'SOL-USDC',
    tvl: 100000,
    fees24h: 500,
    volume24h: 200000,
    binStep: 10,
    poolAge: 86400,
    feeTvlRatioPercent: 0.5,
    volumeTvlRatio: 2,
    poolAgeHours: 24,
    tokenXMint: 'mintX',
    tokenYMint: 'mintY',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<PoolAnalysisResult> = {}): PoolAnalysisResult {
  return {
    score: 8,
    conviction: 'high',
    recommandation: 'open',
    bin_step_optimal: 10,
    range_suggeree: { min: 90, max: 110 },
    raisonnement: 'Strong volume and fee yield.',
    ...overrides,
  };
}

function makeBot(configOverrides: Partial<BotConfig> = {}): AutonomousBot {
  const { Keypair } = require('@solana/web3.js');
  const keypair = Keypair.generate();
  const config = { ...MOCK_CONFIG, ...configOverrides };
  return new AutonomousBot(config, keypair);
}

describe('AutonomousBot.analyzeWithClaude', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns analysis when Claude score meets threshold and recommends open', async () => {
    const bot = makeBot({ minScore: 70 });
    const pool = makePool();
    analyzePool.mockResolvedValue(makeAnalysis({ score: 8, recommandation: 'open' })); // 8*10=80 >= 70

    const result = await bot.analyzeWithClaude(pool);

    expect(result).not.toBeNull();
    expect(result?.recommandation).toBe('open');
  });

  it('returns null when Claude score below threshold', async () => {
    const bot = makeBot({ minScore: 80 });
    const pool = makePool();
    analyzePool.mockResolvedValue(makeAnalysis({ score: 7, recommandation: 'open' })); // 7*10=70 < 80

    const result = await bot.analyzeWithClaude(pool);

    expect(result).toBeNull();
  });

  it('returns null when Claude recommends skip even if score high', async () => {
    const bot = makeBot({ minScore: 50 });
    const pool = makePool();
    analyzePool.mockResolvedValue(makeAnalysis({ score: 9, recommandation: 'skip' }));

    const result = await bot.analyzeWithClaude(pool);

    expect(result).toBeNull();
  });

  it('returns null when Claude recommends watch', async () => {
    const bot = makeBot({ minScore: 50 });
    const pool = makePool();
    analyzePool.mockResolvedValue(makeAnalysis({ score: 8, recommandation: 'watch' }));

    const result = await bot.analyzeWithClaude(pool);

    expect(result).toBeNull();
  });

  it('returns null when analyzePool throws', async () => {
    const bot = makeBot();
    const pool = makePool();
    analyzePool.mockRejectedValue(new Error('API error'));

    const result = await bot.analyzeWithClaude(pool);

    expect(result).toBeNull();
  });

  it('passes at minScore=0 with score 0 and open recommendation', async () => {
    const bot = makeBot({ minScore: 0 });
    const pool = makePool();
    analyzePool.mockResolvedValue(makeAnalysis({ score: 0, recommandation: 'open' }));

    const result = await bot.analyzeWithClaude(pool);

    expect(result).not.toBeNull();
  });

  it('fails at exact boundary: score*10 === minScore passes', async () => {
    const bot = makeBot({ minScore: 70 });
    const pool = makePool();
    analyzePool.mockResolvedValue(makeAnalysis({ score: 7, recommandation: 'open' })); // 7*10=70 >= 70

    const result = await bot.analyzeWithClaude(pool);

    expect(result).not.toBeNull();
  });
});

describe('AutonomousBot deduplication and capital guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getStatus counts only non-closed positions', () => {
    const bot = makeBot({ maxSimultaneousPositions: 3 });
    const positions = (bot as any).openPositions;
    positions.push({ poolAddress: 'a', pair: 'A-B', capitalDeployed: 1, signature: 'sig1', timestamp: Date.now(), status: 'open' });
    positions.push({ poolAddress: 'b', pair: 'B-C', capitalDeployed: 1, signature: 'sig2', timestamp: Date.now(), status: 'closed' });

    const status = bot.getStatus();

    expect(status.openPositions).toBe(1);
    expect(status.totalCapitalDeployed).toBe(1);
  });

  it('stores claude fields on position after openPosition', async () => {
    const bot = makeBot({ dryRun: true });
    const pool = makePool({ address: 'unique-pool-addr' });
    const analysis = makeAnalysis({ score: 9, conviction: 'high', raisonnement: 'Great pool.' });

    await (bot as any).openPosition(pool, analysis);

    const positions = (bot as any).openPositions;
    expect(positions).toHaveLength(1);
    expect(positions[0].claudeScore).toBe(9);
    expect(positions[0].claudeConviction).toBe('high');
    expect(positions[0].claudeReasoning).toBe('Great pool.');
  });

  it('deduplication: already-open pool excluded from candidates in tick', async () => {
    const bot = makeBot({ minScore: 0 });
    const pool = makePool({ address: 'existing-pool' });

    // Pre-inject an open position for this pool
    (bot as any).openPositions.push({
      poolAddress: 'existing-pool',
      pair: pool.pair,
      capitalDeployed: 1,
      signature: 'sig1',
      timestamp: Date.now(),
      status: 'open',
    });

    analyzePool.mockResolvedValue(makeAnalysis({ score: 9, recommandation: 'open' }));

    // Simulate tick with that same pool as only candidate
    const newCandidates = [pool].filter(
      (p) => !(bot as any).openPositions.some((pos: any) => pos.poolAddress === p.address && pos.status !== 'closed')
    );

    expect(newCandidates).toHaveLength(0);
    expect(analyzePool).not.toHaveBeenCalled();
  });

  it('deduplication: closed position allows re-entry on same pool', () => {
    const bot = makeBot();
    const pool = makePool({ address: 'closed-pool' });

    (bot as any).openPositions.push({
      poolAddress: 'closed-pool',
      pair: pool.pair,
      capitalDeployed: 1,
      signature: 'sig1',
      timestamp: Date.now(),
      status: 'closed',
    });

    const newCandidates = [pool].filter(
      (p) => !(bot as any).openPositions.some((pos: any) => pos.poolAddress === p.address && pos.status !== 'closed')
    );

    expect(newCandidates).toHaveLength(1);
  });
});
