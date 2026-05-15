import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BotConfig, BotPosition } from './types';

const DLMM_PROGRAM_ID = '11111111111111111111111111111111';

export interface RebalanceResult {
  rebalanced: boolean;
  reason: string;
  removeSig?: string;
  openSig?: string;
  newRangeLowerBinId?: number;
  newRangeUpperBinId?: number;
  newActiveBin?: number;
}

export function isOutOfRange(position: BotPosition, currentActiveBin: number): boolean {
  if (position.rangeLowerBinId === undefined || position.rangeUpperBinId === undefined) {
    return false;
  }
  return currentActiveBin < position.rangeLowerBinId || currentActiveBin > position.rangeUpperBinId;
}

export function canRebalance(position: BotPosition, cooldownMs: number): boolean {
  if (!position.lastRebalanceAt) return true;
  return Date.now() - position.lastRebalanceAt >= cooldownMs;
}

export function computeNewRange(
  activeBinId: number,
  rangeWidthBins: number
): { lower: number; upper: number } {
  return {
    lower: activeBinId - rangeWidthBins,
    upper: activeBinId + rangeWidthBins,
  };
}

export async function performRebalance(
  position: BotPosition,
  newActiveBin: number,
  config: BotConfig,
  keypair: Keypair,
  connection: Connection
): Promise<RebalanceResult> {
  const rangeWidth = config.rangeWidthBins ?? 20;
  const { lower, upper } = computeNewRange(newActiveBin, rangeWidth);
  const dryRun = config.dryRun ?? false;
  const modeLabel = dryRun ? '[DRY RUN]' : '';

  try {
    // Step 1: remove liquidity
    const removeSig = await buildAndSendTx(
      { type: 'remove', position },
      keypair,
      connection,
      dryRun
    );
    console.log(`[Rebalancer] ${modeLabel} Remove liquidity ${position.pair}: ${removeSig.slice(0, 20)}...`);

    // Step 2: reopen centered on new active bin
    const openSig = await buildAndSendTx(
      { type: 'open', position, lower, upper },
      keypair,
      connection,
      dryRun
    );
    console.log(`[Rebalancer] ${modeLabel} Reopen ${position.pair} bins [${lower}..${upper}]: ${openSig.slice(0, 20)}...`);

    return {
      rebalanced: true,
      reason: `Active bin ${newActiveBin} was outside [${position.rangeLowerBinId}..${position.rangeUpperBinId}]`,
      removeSig,
      openSig,
      newRangeLowerBinId: lower,
      newRangeUpperBinId: upper,
      newActiveBin,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { rebalanced: false, reason: `Rebalance failed: ${msg}` };
  }
}

async function buildAndSendTx(
  params: { type: string; position: BotPosition; lower?: number; upper?: number },
  keypair: Keypair,
  connection: Connection,
  dryRun: boolean
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: keypair.publicKey,
  });

  // Instruction data: 1 = remove liquidity, 2 = open position
  const opcode = params.type === 'remove' ? 1 : 2;
  tx.add({
    programId: new PublicKey(DLMM_PROGRAM_ID),
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(params.position.poolAddress), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([opcode]),
  });

  tx.sign(keypair);

  if (dryRun) {
    const serialized = tx.serialize();
    return `sim_${Buffer.from(serialized).toString('hex').slice(0, 40)}`;
  }

  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig);
  return sig;
}
