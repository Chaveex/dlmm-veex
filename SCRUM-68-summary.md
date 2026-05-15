# SCRUM-68 : Service Bot Autonome

## Résumé

Process Node.js séparé (service autonome) qui trade les pools DLMM sans intervention utilisateur. Wallet propre (keypair fichier), stratégie configurable par thresholds.

## Implémentation

### Architecture
- **Deux processes**:
  - `npm run dev`: web server UI (Phantom user trades)
  - `npm run bot`: autonomous bot service (own wallet, continuous trading)
- **Complètement séparé**: bot ne touche jamais Phantom wallet

### Classes

**AutonomousBot (src/botService.ts)**
- Constructor: charge config + keypair
- `start()`: lance loop périodique (default 60s)
- `tick()`: fetch pools → filter par score → open positions → monitor
- `filterCandidates()`: score filtering (vol/TVL, APR, fees ratios)
- `openPosition()`: build tx + sign avec bot keypair + broadcast
- `monitorPositions()`: vérifie status des positions ouvertes
- `getStatus()`: retourne state courant

**Bot CLI (src/bot-cli.ts)**
- Load config depuis env vars + `.env.bot` file
- Load keypair depuis fichier JSON
- Graceful shutdown (SIGINT)
- Help messages si keypair manquant

### Configuration

```env
BOT_MIN_SCORE=70                    # Score minimum pour ouvrir (0-100)
BOT_MAX_CAPITAL=1                   # SOL par position
BOT_MAX_POSITIONS=3                 # Positions simultanées max
BOT_UPDATE_INTERVAL=60000           # Check frequency (ms)
BOT_KEYPAIR_PATH=./bot-keypair.json # Path to secret key
```

### Scoring Algorithm
```
vol/TVL score: (volumeTvlRatio / 2) * 100, clamped [0,100]
APR score: (feeTvlRatioPercent / 3) * 100, clamped [0,100]
Fee rate score: (fees24h/tvl / 0.5) * 100, clamped [0,100]
Total = vol_score×0.50 + apr_score×0.35 + fee_score×0.15
```

### Types (src/types.ts)

```typescript
interface BotConfig {
  minScore: number;
  maxCapitalPerPosition: number;  // SOL
  maxSimultaneousPositions: number;
  updateIntervalMs: number;
  keypairPath: string;
}

interface BotPosition {
  poolAddress: string;
  pair: string;
  capitalDeployed: number;  // SOL
  signature: string;        // Tx hash
  timestamp: number;        // Unix ms
  status: 'open' | 'closed' | 'pending';
}
```

## Usage

### Setup

1. **Generate keypair** (new wallet pour bot):
```bash
npm run bot:gen-keypair > bot-keypair.json
# Output: [array of 64 numbers] + Public key
```

2. **Fund wallet** (send some SOL to bot public key):
```bash
# CLI will show: [Bot] Wallet: 7kQ5...
# Send SOL to that address
```

3. **Create config** (copy + customize):
```bash
cp .env.bot.example .env.bot
# Edit: min score, max capital, etc.
```

### Run Bot

**Dev mode (hot reload)**:
```bash
npm run bot
```

**Production (compiled)**:
```bash
npm run build
npm run bot:build
```

### Monitoring

Console logs show:
```
[Bot] Initialized with config: ...
[Bot] Tick: fetched 50 pools, 5 candidates
[Bot] Opening position: SOL/USDC (score threshold met)
[Bot] Position opened: SOL/USDC | Tx: xyz...
[Bot] Monitoring 1 position(s)
[Bot] Position SOL/USDC: Active (1 SOL)
```

Graceful shutdown: `Ctrl+C` shows final status.

## Security

- **Private key**: stored in `bot-keypair.json`, NEVER in code/git
- **Separation**: bot wallet ≠ Phantom wallet (user trades ≠ bot trades)
- **Config**: can set max capital + max positions to limit loss
- **RPC**: uses mainnet by default, respects RPC_URL env var

## Constraints Implemented

✓ Min score threshold: only open positions with score ≥ minScore  
✓ Max capital per position: deploy maxCapitalPerPosition SOL per trade  
✓ Max simultaneous positions: never exceed maxSimultaneousPositions open  
✓ Separate wallet: keypair file, own public key, independent of Phantom  

## Tests

✓ Build TypeScript: passes  
✓ Jest tests (109): no regression  
✓ Type safety: AutonomousBot fully typed  

## Known Limitations / TODO

1. **Placeholder instructions**: tx instructions are stubs (data: Buffer.from([0]))
   → Real Meteora DLMM instructions needed for production
2. **No PnL tracking**: positions opened but no close logic yet
3. **No data persistence**: positions lost on restart (could add JSON state file)
4. **Mainnet only**: works on mainnet-beta, can switch with RPC_URL
5. **Single pool per tick**: could fetch + process multiple pages

## Branche
`feat/SCRUM-68/autonomousBot` → prêt pour PR vers dev-1.0

## Integration avec UI

Bot service complètement indépendant. UI continue:
- `/api/pairs`: same endpoint, bot + UI both fetch
- `/api/user-positions`: bot positions NOT visible in UI (separate wallet)
- Web server port 3000: bot has no web interface

Possible future: `/api/bot-status` endpoint to monitor bot from UI.
