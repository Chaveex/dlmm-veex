# SCRUM-59 : Connexion Phantom Wallet

## Résumé

Intégration complète de Phantom wallet dans la SPA. Bouton de connexion en haut à droite du header, détection automatique de l'extension, récupération de la clé publique, gestion de la déconnexion, et affichage de l'adresse tronquée.

## Implémentation

### UI (Header)
- **Connect Wallet** : bouton gradient (violet) en haut à droite
- **Wallet Info** : affiche adresse tronquée (premiers 4 + derniers 4 caractères) quand connecté
- **Disconnect** : bouton ✕ pour se déconnecter

### Logique
- `handleWalletClick()` : détecte Phantom via `window.solana.isPhantom`, appelle `provider.connect()`, stocke `connectedWallet`
- `handleDisconnect()` : appelle `provider.disconnect()`, nettoie session
- `updateWalletUI()` : bascule entre bouton Connect et info wallet
- `checkWalletConnection()` : au chargement, détecte connexion existante via `provider._publicKey`
- Listener `solana.on('disconnect')` : maj UI automatique si déconnexion depuis Phantom

### Styles
- Bouton gradient cohérent avec UI existante
- Wallet info : fond léger, border, monospace font pour adresse
- Responsive (flex layout)

## Tests
- Build TypeScript : ✓
- Jest (109 tests) : ✓
- Aucune régression

## Branche
`feat/SCRUM-59/phantomWalletConnection` → prêt pour PR vers dev-1.0
