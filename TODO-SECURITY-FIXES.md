# Kaizen Launcher - Security & Performance Fixes

## PARTIE 1 : SÉCURITÉ (10 items)

| # | Tâche | Fichier(s) | Priorité | Status |
|---|-------|-----------|----------|--------|
| 1 | Bloquer HTTP - forcer HTTPS only | `url_validation.rs` | 🔴 Critique | ✅ |
| 2 | Protéger clé AES sur Windows (DPAPI) | `crypto.rs` | 🔴 Critique | ✅ |
| 3 | Ne plus retourner tokens en clair au frontend | `auth/commands.rs` | 🔴 Critique | ✅ |
| 4 | Chiffrer TOUS les secrets stockés | webhooks, configs | 🔴 Critique | ✅ |
| 5 | Masquer URLs sensibles dans erreurs | `utils/redact.rs` | 🟠 Haute | ✅ |
| 6 | Upgrader SHA1 → SHA256/512 | `modrinth/`, `download/` | 🟠 Haute | ✅ |
| 7 | Validation JWT Kaizen Account | `db/kaizen_accounts.rs` | 🟠 Haute | ✅ |
| 8 | Argon2id pour passwords partage | `sharing/server.rs` | 🟡 Moyenne | ✅ |
| 9 | Expiration/révocation tokens de partage | `sharing/server.rs` | 🟡 Moyenne | ✅ |
| 10 | Documenter OAuth secrets embeddés | Documentation | 🟡 Moyenne | ✅ |

---

## SÉCURITÉ : Documentation OAuth

### OAuth Clients Utilisés

| Service | Type | Client ID | Sécurité |
|---------|------|-----------|----------|
| **Microsoft** | Public Client (Device Code) | `46e2883f-...` | ✅ Sûr - Conçu pour clients publics |
| **Kaizen Account** | Public Client (Device Code) | Env var `KAIZEN_OAUTH_CLIENT_ID` | ✅ Sûr - Compilé à build time |
| **Google Drive** | Public Client (Device Code) | Runtime config | ✅ Sûr - Géré par l'utilisateur |
| **Dropbox** | Public Client (Device Code) | Runtime config | ✅ Sûr - Géré par l'utilisateur |

### Analyse de Sécurité

**Pourquoi les Client IDs ne sont pas des secrets sensibles:**

1. **Device Code Flow (RFC 8628)** - Ce protocole OAuth 2.0 est spécifiquement conçu pour les clients publics (applications desktop, CLI, IoT). Le client ID est intentionnellement public.

2. **Pas de Client Secret** - Contrairement au "Authorization Code Flow" classique, le Device Code Flow n'utilise pas de client secret car il est impossible de le garder confidentiel dans une app distribuée.

3. **Sécurité par d'autres moyens:**
   - L'utilisateur doit approuver l'accès sur un appareil séparé
   - Les tokens sont stockés localement avec chiffrement AES-256 + DPAPI
   - Les tokens ne transitent jamais vers le frontend
   - Refresh tokens sont utilisés pour renouveler les accès sans ré-authentification

4. **Mitigations en place:**
   - Le client ID Microsoft est celui de l'application Minecraft officielle
   - Le client ID Kaizen est injecté à la compilation (non visible dans le code source public)
   - Tous les tokens obtenus sont chiffrés avant stockage

**Risques résiduels:**
- Un attaquant avec accès au binaire pourrait extraire le client ID
- Impact: Pourrait créer des requêtes OAuth mais sans accès aux tokens utilisateur
- Mitigation: Le Device Code Flow requiert l'approbation utilisateur sur un autre appareil

---

## PARTIE 2 : PERFORMANCE & QUALITÉ (12 items)

| # | Tâche | Fichier(s) | Priorité | Status |
|---|-------|-----------|----------|--------|
| 1 | Remplacer 73 `.unwrap()` | Tous modules Rust | 🔴 Critique | ⬜ |
| 2 | Fixer memory leaks `listen()` | 5 composants React | 🔴 Critique | ⬜ |
| 3 | Réduire scope RwLock | Commands Tauri | 🟠 Haute | ⬜ |
| 4 | Supprimer 160 `.clone()` redondants | Backend Rust | 🟠 Haute | ⬜ |
| 5 | Extraire code dupliqué browsers | `ModBrowser`, etc. | 🟠 Haute | ⬜ |
| 6 | Créer hook `useTauriListener` | Nouveau fichier | 🟠 Haute | ⬜ |
| 7 | Debounce recherche mods | `ModsList.tsx` | 🟡 Moyenne | ⬜ |
| 8 | Extraire types partagés | `types/modrinth.ts` | 🟡 Moyenne | ⬜ |
| 9 | Optimiser tokio features | `Cargo.toml` | 🟡 Moyenne | ⬜ |
| 10 | Extraire fonctions dupliquées | `get_content_folder` | 🟡 Moyenne | ⬜ |
| 11 | Tests d'intégration (25%→60%) | `tests/` | 🟢 Backlog | ⬜ |
| 12 | Audit accessibilité | Composants UI | 🟢 Backlog | ⬜ |

---

## Notes d'implémentation

### Partie 1 - Détails

**1. HTTPS Only**
- Fichier: `src-tauri/src/utils/url_validation.rs`
- Changer validation pour rejeter `http://`

**2. Protection clé Windows**
- Fichier: `src-tauri/src/crypto.rs`
- Utiliser Windows DPAPI ou ACLs restrictives

**3. Tokens frontend**
- Fichier: `src-tauri/src/auth/commands.rs`
- Retourner tokens masqués ou IDs opaques

**4. Secrets chiffrés**
- Forcer encryption pour tous les secrets dans settings

**5. URLs masquées**
- Créer fonction `redact_sensitive_url()`
- Appliquer dans logs et erreurs

**6. SHA256/512**
- Upgrader vérification hash dans downloads
- Utiliser SHA512 quand disponible (Modrinth)

**7. JWT Validation**
- Ajouter vérification signature JWT côté client

**8. bcrypt passwords**
- Remplacer SHA256 simple par argon2

**9. Token expiration**
- Ajouter TTL et liste de révocation

**10. Documentation OAuth**
- Documenter risques et mitigation

---

*Généré le: 2024-12-21*
