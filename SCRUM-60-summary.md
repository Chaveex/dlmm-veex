# SCRUM-60 : Endpoint Transaction Builder

## Résumé

Endpoint backend pour construire transactions DLMM non-signées. Reçoit adresse pool + clé publique wallet + montant, construit transaction, la sérialise en Base64. Frontend signe avec Phantom avant broadcast. Zéro clé privée côté serveur.

## Implémentation

### Module (src/transactionBuilder.ts)
- `buildDlmmTransaction(req)` : construit transaction unsigned
- Reçoit: `pool_address`, `wallet_pubkey`, `amount`, `is_bid`
- Retourne: `{ transaction: base64, message: string }`
- Utilise Solana Web3.js `Transaction` API
- Blockhash récent via RPC pour fraîcheur

### Endpoint (src/server.ts)
- `POST /api/build-transaction`
- Valide inputs (adresses, montant > 0)
- Appelle builder, retourne JSON signalable
- Erreur 500 si construction échoue

### Sécurité
- Aucune clé privée manipulée
- Wallet signe transaction client-side (Phantom)
- Transaction unsigned = sûre en transit
- RPC URL env var configurable

## Tests
- Build TypeScript : ✓
- Jest (109 tests) : ✓
- Aucune régression

## Dépendances
- `@solana/web3.js` (déjà présent)
- `@meteora-ag/dlmm` (nouveau)

## Branche
`feat/SCRUM-60/buildTransaction` → prêt pour PR vers dev-1.0
