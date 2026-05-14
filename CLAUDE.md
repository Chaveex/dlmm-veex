# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DLMM pool data viewer for Meteora/Solana DeFi. Fetches pools from `dlmm.datapi.meteora.ag/pools`, computes profitability metrics, checks token security (rugcheck + Birdeye), and uses Claude API for AI-driven pool analysis. Frontend SPA with filtering, sorting, and batch analysis.

## Commands

```bash
npm install              # Install dependencies
npm run build           # Compile TypeScript to dist/
npm run dev             # Start server with ts-node (port 3000)
npm start               # Run compiled server from dist/
npm test                # Run all Jest tests
npm test -- --watch     # Watch mode
npm test -- poolMetrics # Run single test file
npm run lint            # ESLint (TypeScript)
```

Setup `.env` with `ANTHROPIC_API_KEY=sk-ant-api03-...` (not committed; see `.env.example`).

## Architecture

### Backend (Express, TypeScript)
- `src/server.ts` — Main server; endpoints: `/api/pairs`, `/api/security`, `/api/analyze`, `/api/batch-analyze`
- `src/types.ts` — Core types: `PoolData`, `SecurityLevel`, `PoolAnalysisResult`, etc.
- `src/fetchPairs.ts` — Fetch from Meteora API with validation
- `src/poolMetrics.ts` — Pure functions: fee/TVL ratio, volume/TVL ratio, pool age, metrics aggregation
- `src/tokenSecurity.ts` — Score tokens via rugcheck + Birdeye; returns `safe|warn|danger`
- `src/poolAnalysis.ts` — Single pool Claude analysis (claude-haiku-4-5, tool_use for JSON)
- `src/batchAnalyzer.ts` — Batch analyzer: 10 pools/call, retry on 429/5xx, concurrency limit
- `src/profitability.ts` — Pure profitability calc: APR, volume/TVL, fee rate score (weighted formula)

### Frontend (Vanilla JS SPA)
- `public/index.html` — Single pool table with:
  - Search (address/name); name search fetches 10 pages parallel (API has no filter)
  - Columns: pair, address, TVL, fees24h, volume24h, bin step, pool age, fee/TVL ratio, vol/TVL, APR, profitability score (0–100 with color pill), security check, AI analysis
  - Filters: "High yield" (score ≥70), "Vol/TVL > 1x"
  - Sort by any numeric column
  - Global tooltip (getBoundingClientRect) for score pill tips
  - Pagination (50 per page)
  - Batch analyze button; pools cached in JS object (`poolsCache`) to avoid JSON in HTML attrs
  - Calculator widget: fill from table row → shows APR/score; input fields for custom pool

### CI/CD
- `.github/workflows/ci.yml` — Build + test on push/PR to main, dev-1.0, feat/**

## Key Technical Details

**API params:** `page` and `page_size` (NOT offset/limit).

**Name search:** API has no name filter → fetch 10 pages in parallel, filter client-side, paginate manually.

**Token security:** rugcheck `/report` endpoint (NOT `/report/summary`); field path `r.token?.mintAuthority`, date `r.detectedAt`, unknown age = warn.

**Claude API:** Uses tool_use to force structured JSON output; claude-haiku-4-5 for cost.

**Retry logic:** Exponential backoff (1000ms base, 2^attempt). Retries on 429 (RateLimitError), 500 (InternalServerError), 529 (overloaded). Max 3 retries.

**Profitability score:** Weighted formula = `vol/TVL_score×0.50 + APR_score×0.35 + fee_rate_score×0.15`. Each component clamped to [0,100]. Verdicts: ≥70 excellent, 40–69 decent, <40 low.

**Performance:** Use `performance.now()` for timing (not `Date.now()`); sub-ms precision for CI test flakiness.

**Tooltip fix:** Global `#global-tooltip` div in body (outside table overflow clip); JS positions via `getBoundingClientRect()`.

**Branching:** Feature branches from `dev-1.0` named `feat/[NUMERO-US]/[descriptionCourte]`. CI required before merge.

## Testing

Tests use Jest + ts-jest. Mocked axios and @anthropic-ai/sdk (includes error constructors like `Anthropic.RateLimitError`). Tests pass locally and on CI (GitHub Actions, Node 20, ubuntu-latest).

## Security

Never store/commit API keys. `.env` in `.gitignore`. `.claude/` (local settings) also ignored.
