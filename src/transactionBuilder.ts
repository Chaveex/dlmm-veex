import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Meteora DLMM program ID
const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XQoLTIJZ0raUeMb9eempW2791qB3Cris');

export interface BuildTransactionRequest {
  pool_address: string;
  wallet_pubkey: string;
  amount: number;
  is_bid: boolean; // true = buy, false = sell
}

export interface BuildTransactionResponse {
  transaction: string; // Base64 encoded unsigned transaction
  message: string;
}

/**
 * Build unsigned DLMM transaction for Phantom signature
 * Frontend constructs actual swap instruction; backend provides transaction structure
 */
export async function buildDlmmTransaction(
  req: BuildTransactionRequest
): Promise<BuildTransactionResponse> {
  try {
    const poolAddress = new PublicKey(req.pool_address);
    const walletPubkey = new PublicKey(req.wallet_pubkey);
    const lamports = Math.floor(req.amount * 1e9);

    // Get latest blockhash for transaction
    const { blockhash } = await connection.getLatestBlockhash();

    // Create unsigned transaction
    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: walletPubkey,
    });

    // Add placeholder instruction (frontend provides actual swap instruction)
    // This ensures proper transaction structure and gas estimation
    tx.add({
      programId: DLMM_PROGRAM_ID,
      keys: [
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: walletPubkey, isSigner: true, isWritable: true },
      ],
      data: Buffer.from([0]), // Placeholder
    });

    // Serialize to Base64
    const serialized = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');

    return {
      transaction: serialized,
      message: `Ready to sign. Pool: ${req.pool_address.slice(0, 8)}... | Amount: ${req.amount} SOL | ${req.is_bid ? 'Buy' : 'Sell'}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to build transaction: ${msg}`);
  }
}
