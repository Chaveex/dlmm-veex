# SCRUM-65 : Dashboard Positions Ouvertes

## Résumé

Section dashboard dans la SPA affichant les positions actives du wallet connecté. Utilisateur voit en un coup d'œil: quelle pool, combien déposé, fees générées, PnL non-réalisé, et si la position est in-range ou out-of-range (important pour les DLMM).

## Implémentation

### Frontend UI
- **Widget collapsible** : "💼 My Positions" (expand/collapse comme calculator/transaction)
- **Tableau** : affiche positions actives avec colonnes
  - Pool (nom paire)
  - Deposited (montant SOL)
  - Fees Collected ($USD)
  - PnL (Unrealized) (% color-coded: green si +, red si -)
  - Status (in-range/out-of-range badge)
- **Refresh Button** : charge positions depuis backend
- **Empty State** : "No positions found" si wallet connecté mais pas de positions
- **Wallet Guard** : "Connect wallet to view positions" si pas connecté
- **Loading State** : "Loading positions..." pendant fetch

### Logique Frontend

**loadPositions()**
1. Vérifie wallet connecté
2. Appelle `POST /api/user-positions` avec wallet pubkey
3. Parse réponse, affiche positions en tableau
4. Gère erreurs avec message affichage

**updatePositionsWidget()**
- Cache widget si wallet pas connecté
- Affiche si connecté

**togglePositionsWidget()**
- Collapse/expand comme txWidget

### Backend Endpoint
`POST /api/user-positions`
- Input: `{ wallet: "pubkey" }`
- Output: `{ success: true, data: { positions: [...] } }`
- Positions format:
  ```typescript
  interface Position {
    pool: string;           // "SOL/USDC"
    deposited: number;      // 5.5 SOL
    feesCollected: number;  // $12.45
    pnl: number;            // 2.3 (%)
    inRange: boolean;       // true/false
  }
  ```
- Actuellement returns empty array (scaffold ready)

### Styling
- **Status Badges**:
  - In-Range: #d4edda (vert)
  - Out-of-Range: #f8d7da (rouge)
- **PnL Color**: green si >= 0, red si < 0
- **Table**: consistent avec pools-table existante

## À Faire (To-Do)

1. **Blockchain Integration**
   - Fetch actual DLMM positions from Solana RPC
   - Parse position account data (DLMM program)
   - Filter by wallet pubkey

2. **PnL Calculation**
   - Current bin price vs. position entry price
   - Unrealized gain/loss calculation
   - Fees earned since position open

3. **In-Range Detection**
   - Get current pool bin from RPC
   - Compare vs. position bin range
   - Update status

4. **Features**
   - Click position to see details (range, bins, entry price)
   - Close position button
   - Auto-refresh on interval
   - Claim fees button

## Tests
- Build TypeScript : ✓
- Jest (109 tests) : ✓
- Aucune régression

## Branche
`feat/SCRUM-65/openPositionsDashboard` → prêt pour PR vers dev-1.0
