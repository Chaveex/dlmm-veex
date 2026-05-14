# SCRUM-61 : Signature et Broadcast

## Résumé

Frontend complète la transaction. Reçoit tx sérialisée de `/api/build-transaction`, demande signature Phantom via `provider.signTransaction()`, broadcast sur Solana, affiche tx hash avec lien Solscan. Widget uniquement visible si wallet connecté.

## Implémentation

### Widget UI
- **Transaction widget** : section accordéon (expand/collapse)
- Bouton **Sign & Broadcast** : déclenche le flux
- Message alerte si wallet pas connecté
- Affichage résultat : tx hash + lien Solscan

### Logique

**executeTransaction()**
1. Vérifie wallet connecté
2. Récupère TVL/volume/fees/montant du calculator
3. Appelle `POST /api/build-transaction`
4. Reçoit tx Base64 non-signée
5. Décode `Buffer.from(txBase64, 'base64')`
6. Appelle `provider.signTransaction(tx)` (Phantom popup)
7. Broadcast via `connection.sendRawTransaction(txSigned.serialize())`
8. Affiche tx hash avec succès/erreur

**signAndBroadcast()**
- `showTxSuccess(txId)` : affiche hash + lien Solscan
- `showTxError(error)` : affiche message erreur
- `updateTxWidget()` : bascule visibilité (wallet connecté?)
- `toggleTxWidget()` : expand/collapse widget

### Dépendances
- `@solana/web3.js` (CDN) : `Transaction`, `Connection`, `PublicKey`
- Phantom provider : `signTransaction()` (standard Solana)

## Flux Complet (SCRUM-60 + 61)

```
Frontend: POST /api/build-transaction
  ↓
Backend: construit tx unsigned + sérialise Base64
  ↓
Frontend: reçoit + décode
  ↓
Phantom: demande signature (popup utilisateur)
  ↓
Frontend: signe tx
  ↓
Frontend: broadcast à Solana RPC
  ↓
Affiche tx hash + lien Solscan
```

## Tests
- Build TypeScript : ✓
- Jest (109 tests) : ✓
- Aucune régression

## Branche
`feat/SCRUM-61/signAndBroadcast` → prêt pour PR vers dev-1.0
