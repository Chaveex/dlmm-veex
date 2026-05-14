import 'dotenv/config';
import express from 'express';
import path from 'path';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { PoolData } from './types';
import { calculateFeeTvlRatio, calculateVolumeTvlRatio, calculatePoolAgeHours } from './poolMetrics';
import { checkPoolSecurity } from './tokenSecurity';
import { analyzePool } from './poolAnalysis';
import { batchAnalyzePools } from './batchAnalyzer';
import { buildDlmmTransaction, BuildTransactionRequest } from './transactionBuilder';

const app = express();
app.use(express.json());
const PORT = 3000;

app.use(express.static(path.join(__dirname, '../public')));

const API_URL = 'https://dlmm.datapi.meteora.ag/pools';

const PAGE_SIZE = 50;
const SEARCH_PAGES = 10; // fetch 10 pages = 500 pools for name search

app.get('/api/pairs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const searchAddress = (req.query.address as string)?.toLowerCase() || '';
    const searchName = (req.query.name as string)?.toLowerCase() || '';

    let pools: PoolData[];
    let total: number;

    if (searchName) {
      // API has no name filter — fetch SEARCH_PAGES in parallel, filter, paginate manually
      const pageRequests = Array.from({ length: SEARCH_PAGES }, (_, i) =>
        axios.get<any>(API_URL, { params: { page: i + 1, page_size: PAGE_SIZE } })
      );
      const responses = await Promise.allSettled(pageRequests);

      const all: PoolData[] = [];
      for (const r of responses) {
        if (r.status === 'fulfilled' && r.value.data?.data) {
          const extracted = r.value.data.data
            .map(extractPoolData)
            .filter((p: PoolData | null) => p) as PoolData[];
          all.push(...extracted);
        }
      }

      const filtered = all.filter((p: PoolData) => p.pair.toLowerCase().includes(searchName));
      total = filtered.length;
      pools = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    } else {
      // Normal pagination — pass page + page_size directly to API
      const response = await axios.get<any>(API_URL, { params: { page, page_size: PAGE_SIZE } });
      if (!response.data?.data) throw new Error('Invalid API response');

      pools = response.data.data.map(extractPoolData).filter((p: PoolData | null) => p) as PoolData[];
      total = response.data.total || 0;

      if (searchAddress) {
        pools = pools.filter((p: PoolData) => p.address.toLowerCase().includes(searchAddress));
      }
    }

    res.json({ success: true, data: pools, count: pools.length, page, total });
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

    const tokenXMint = typeof raw.token_x?.address === 'string' ? raw.token_x.address : '';
    const tokenYMint = typeof raw.token_y?.address === 'string' ? raw.token_y.address : '';

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
      tokenXMint,
      tokenYMint,
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

app.get('/api/security', async (req, res) => {
  const poolAddress = req.query.pool as string;
  const tokenXMint = req.query.tokenX as string;
  const tokenYMint = req.query.tokenY as string;

  if (!poolAddress || !tokenXMint || !tokenYMint) {
    res.status(400).json({ success: false, error: 'pool, tokenX, tokenY required' });
    return;
  }

  try {
    const result = await checkPoolSecurity({ poolAddress, tokenXMint, tokenYMint });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/batch-analyze', async (req, res) => {
  const pools: PoolData[] = req.body?.pools;

  if (!Array.isArray(pools) || pools.length === 0) {
    res.status(400).json({ success: false, error: 'pools array required' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  try {
    const summary = await batchAnalyzePools(pools, { batchSize: 10, concurrency: 3 });
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/analyze', async (req, res) => {
  const pool: PoolData = req.body;

  if (!pool?.address || !pool?.pair) {
    res.status(400).json({ success: false, error: 'pool data required' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  try {
    const result = await analyzePool(pool);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/build-transaction', async (req, res) => {
  const { pool_address, wallet_pubkey, amount, is_bid } = req.body as BuildTransactionRequest;

  if (!pool_address || !wallet_pubkey || amount === undefined || is_bid === undefined) {
    res.status(400).json({
      success: false,
      error: 'pool_address, wallet_pubkey, amount, is_bid required',
    });
    return;
  }

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({
      success: false,
      error: 'amount must be positive number',
    });
    return;
  }

  try {
    const result = await buildDlmmTransaction({
      pool_address,
      wallet_pubkey,
      amount,
      is_bid: Boolean(is_bid),
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/strategy-recommend', async (req, res) => {
  const { pool, amount, score } = req.body;

  if (!pool || amount === undefined || score === undefined) {
    res.status(400).json({ success: false, error: 'pool, amount, score required' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  try {
    const client = new Anthropic();
    const prompt = `You are an expert in DLMM (Dynamic Liquidity Market Maker) on Meteora protocol.

Pool Analysis:
- Pair: ${pool.pair}
- TVL: $${pool.tvl.toLocaleString()}
- 24h Volume: $${pool.volume24h.toLocaleString()}
- 24h Fees: $${pool.fees24h.toLocaleString()}
- Volume/TVL Ratio: ${pool.volumeTvlRatio.toFixed(2)}x
- Fee/TVL Ratio: ${pool.feeTvlRatioPercent.toFixed(2)}%
- Pool Age: ${pool.poolAge.toFixed(0)}s
- Bin Step: ${pool.binStep}bp
- Pool Score: ${score}/100

User wants to provide liquidity with ${amount} SOL.

DLMM Meteora Strategies:
1. Bid-Ask Spread: Dual-sided liquidity capture (best for high volume/volatility, captures fees both ways)
2. One-Sided Bid: Directional bullish position (use if expecting price increase)
3. One-Sided Ask: Directional bearish position (use if expecting price decrease)
4. Concentrated Spot: Capital-efficient liquidity around current price (best for stable pairs, low vol)

Based on the pool characteristics, recommend THE BEST strategy for this user.

Respond in JSON format ONLY:
{
  "strategy": "Strategy Name (must be exactly one of: Bid-Ask Spread, One-Sided Bid, One-Sided Ask, Concentrated Spot)",
  "reasoning": "Brief explanation why this strategy is best for this pool (max 50 words)"
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const result = JSON.parse(jsonMatch[0]);
    res.json({
      success: true,
      data: {
        strategy: result.strategy,
        reasoning: result.reasoning,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
