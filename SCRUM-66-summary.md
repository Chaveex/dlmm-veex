# SCRUM-66 : Bouton Close Position

## Résumé

Bouton Close sur chaque position ouverte pour clôturer la position et réclamer les fees. Pattern sign-broadcast via Phantom wallet avec confirmation Solscan.

## Implémentation

### Frontend UI
- **Colonne Action** : ajout colonne "Action" au tableau positions
- **Bouton Close** : déclencheur onclick pour closePosition(idx, poolName)
- **Styling** : gradient rouge (#dc3545 → #c82333) pour indiquer action destructrice
- **Loading state** : "Closing..." pendant broadcast
- **Confirmation** : Solscan link via showTxSuccess() existante

### Logique Frontend

**closePosition(idx, poolName)**
1. Vérifie wallet connecté
2. Récupère position data depuis loadedPositions[] global
3. Appelle `POST /api/build-close-tx` avec position + wallet pubkey
4. Décodes transaction Base64
5. Signe via Phantom provider.signTransaction()
6. Broadcast à Solana RPC (sendTransaction)
7. Affiche tx hash + Solscan link
8. Auto-refresh positions après 2 sec

**loadedPositions = []**
- Global array stocke positions chargées pour accès dans closePosition()
- Populée dans loadPositions() après fetch /api/user-positions

### Backend Endpoint
`POST /api/build-close-tx`
- Input: `{ position: {...}, wallet_pubkey: "..." }`
- Output: `{ success: true, data: { transaction: "base64", message: "..." } }`
- Construit transaction avec:
  - removeLiquidity instruction (placeholder, idx=1)
  - claimFees instruction (placeholder, idx=2)
- Sérialise en Base64 pour frontend

### Styling
- `.btn-close-pos`: gradient rouge, padding réduit, min-width 70px
- `.btn-close-pos:hover`: box-shadow rouge pour cohérence

## Stack
- Frontend: browser APIs (atob/btoa), Phantom signTransaction
- Backend: Solana Web3.js (Connection, PublicKey, Transaction)
- Pattern: build-sign-broadcast identical à executeTransaction() (SCRUM-61)

## Tests
- Build TypeScript : ✓
- Jest (109 tests) : ✓
- Aucune régression

## Branche
`feat/SCRUM-66/closePosition` → prêt pour PR vers dev-1.0

## Prochaines Étapes
1. Blockchain integration : fetch actual position accounts from DLMM program
2. Real instruction construction pour removeLiquidity + claimFees
3. Event listener pour confirm position close on-chain
4. Auto-refresh interval au lieu de fixed 2s delay
