import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import { BotConfig } from './types';
import { AutonomousBot } from './botService';

// Load config from environment and .env.bot file
function loadConfig(): BotConfig {
  const configPath = process.env.BOT_CONFIG_PATH || '.env.bot';

  let config: Partial<BotConfig> = {
    minScore: 70,
    maxCapitalPerPosition: 1,
    maxSimultaneousPositions: 3,
    updateIntervalMs: 60000,
    keypairPath: path.join(process.cwd(), 'bot-keypair.json'),
    dryRun: false,
  };

  // Override with env vars
  if (process.env.BOT_MIN_SCORE) config.minScore = parseInt(process.env.BOT_MIN_SCORE);
  if (process.env.BOT_MAX_CAPITAL) config.maxCapitalPerPosition = parseFloat(process.env.BOT_MAX_CAPITAL);
  if (process.env.BOT_MAX_POSITIONS) config.maxSimultaneousPositions = parseInt(process.env.BOT_MAX_POSITIONS);
  if (process.env.BOT_UPDATE_INTERVAL) config.updateIntervalMs = parseInt(process.env.BOT_UPDATE_INTERVAL);
  if (process.env.BOT_KEYPAIR_PATH) config.keypairPath = process.env.BOT_KEYPAIR_PATH;
  if (process.env.BOT_DRY_RUN === 'true') config.dryRun = true;
  if (process.env.BOT_TARGET_PAIR) config.targetPair = process.env.BOT_TARGET_PAIR;

  return config as BotConfig;
}

// Load keypair from file
function loadKeypair(keypairPath: string): Keypair {
  try {
    const keyData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(keyData));
  } catch (err) {
    console.error(`Failed to load keypair from ${keypairPath}`);
    console.error(`Generate new keypair with: npx ts-node -e "import {Keypair} from '@solana/web3.js'; const k = Keypair.generate(); console.log(JSON.stringify(Array.from(k.secretKey)))"`);
    throw err;
  }
}

// Main entry
async function main() {
  console.log(`[Main] DLMM Autonomous Bot CLI`);

  const config = loadConfig();
  console.log(`[Main] Config loaded:`);
  console.log(`  - Keypair path: ${config.keypairPath}`);

  if (!fs.existsSync(config.keypairPath)) {
    console.error(`[Error] Keypair file not found: ${config.keypairPath}`);
    console.log(`[Help] Create a keypair JSON file with:`);
    console.log(`       npx ts-node -e "import {Keypair} from '@solana/web3.js'; const k = Keypair.generate(); console.log('[' + Array.from(k.secretKey).join(',') + ']')" > bot-keypair.json`);
    process.exit(1);
  }

  const keypair = loadKeypair(config.keypairPath);
  const bot = new AutonomousBot(config, keypair);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n[Bot] Shutting down...`);
    const status = bot.getStatus();
    console.log(`[Bot] Final status:`, JSON.stringify(status, null, 2));
    process.exit(0);
  });

  await bot.start();
}

main().catch((err) => {
  console.error('[Error]', err);
  process.exit(1);
});
