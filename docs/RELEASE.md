# Kaizen Launcher - Guide de Release

Ce document explique comment créer une nouvelle release du Kaizen Launcher en utilisant le système de build Docker local.

## 📋 Prérequis

- **Docker Desktop** installé et en cours d'exécution
- **GitHub CLI** (`gh`) installé et authentifié
- **Node.js 20+** installé
- **Rust** installé (pour les builds macOS natifs)
- Être sur macOS pour les builds macOS (requis par Apple)

### Installation des prérequis

```bash
# macOS avec Homebrew
brew install gh node@20 rust

# Authentification GitHub
gh auth login
```

## 🔐 Configuration des Clés de Signature

Les builds signés sont nécessaires pour l'auto-updater de Tauri.

### Générer de nouvelles clés

```bash
npm run release:generate-keys
# ou
./scripts/release.sh --generate-keys
```

Cela crée:
- `~/.tauri/kaizen.key` - Clé privée (NE JAMAIS PARTAGER!)
- `~/.tauri/kaizen.key.pub` - Clé publique
- `.env.local.example` - Template de configuration

### Configurer les clés

1. Copiez le template:
```bash
cp .env.local.example .env.local
```

2. Le fichier `.env.local` contient:
```bash
TAURI_SIGNING_PRIVATE_KEY=<votre clé privée>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<mot de passe si défini>
```

⚠️ **IMPORTANT**: Ne jamais commit `.env.local` ou les fichiers `.key`!

### Mettre à jour la clé publique

Si vous générez de nouvelles clés, mettez à jour `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<contenu de kaizen.key.pub>"
    }
  }
}
```

## 🚀 Créer une Release

### Mode Interactif (Recommandé)

```bash
npm run release
# ou
./scripts/release.sh
```

Le script vous guidera pour choisir le type de version.

### Releases Rapides

```bash
# Patch (0.1.19 → 0.1.20) - Bug fixes
npm run release:patch

# Minor (0.1.19 → 0.2.0) - Nouvelles fonctionnalités
npm run release:minor

# Major (0.1.19 → 1.0.0) - Breaking changes
npm run release:major
```

### Version Spécifique

```bash
./scripts/release.sh --version 1.0.0
```

### Mode Dry-Run (Preview)

```bash
npm run release:dry-run
# Affiche ce qui serait fait sans rien modifier
```

## 🛠️ Options Avancées

### Build Uniquement (Sans Release)

```bash
npm run release:build-only
# ou
./scripts/release.sh --only-build
```

### Builds Parallèles

```bash
./scripts/release.sh patch --parallel
# Build Linux et Windows en parallèle
```

### Sélection de Plateformes

```bash
./scripts/release.sh patch --no-windows  # Sans Windows
./scripts/release.sh patch --no-linux    # Sans Linux
./scripts/release.sh patch --no-macos    # Sans macOS
```

### Release Draft/Prerelease

```bash
./scripts/release.sh patch --draft       # Release en brouillon
./scripts/release.sh patch --prerelease  # Marquer comme prerelease
```

### Notes Personnalisées

```bash
./scripts/release.sh patch --notes "Cette release corrige un bug critique"
```

## 📁 Structure des Artifacts

Après un build, les artifacts sont dans `dist-release/`:

```
dist-release/
├── Kaizen Launcher_0.1.20_aarch64.dmg      # macOS ARM64
├── Kaizen Launcher_0.1.20_x64.dmg          # macOS Intel
├── Kaizen Launcher_0.1.20_amd64.AppImage   # Linux AppImage
├── Kaizen Launcher_0.1.20_amd64.deb        # Linux Debian
├── Kaizen Launcher_0.1.20_x64-setup.exe    # Windows
├── latest.json                              # Metadata auto-updater
└── *.sig                                    # Fichiers de signature
```

## 🔄 Workflow Complet d'une Release

1. **Préparation**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Vérifier les changements**
   ```bash
   git log --oneline $(git describe --tags --abbrev=0)..HEAD
   ```

3. **Lancer la release**
   ```bash
   npm run release:patch  # ou minor/major
   ```

4. **Le script fait automatiquement**:
   - ✅ Vérifie les dépendances (Docker, gh, etc.)
   - ✅ Vérifie le statut git
   - ✅ Charge les clés de signature
   - ✅ Incrémente la version dans tous les fichiers
   - ✅ Met à jour le CHANGELOG.md
   - ✅ Build Linux via Docker
   - ✅ Build Windows via Docker (cross-compilation)
   - ✅ Build macOS nativement (si sur Mac)
   - ✅ Signe tous les artifacts
   - ✅ Génère `latest.json` pour l'auto-updater
   - ✅ Commit et tag les changements
   - ✅ Push vers GitHub
   - ✅ Crée la release GitHub avec les artifacts

5. **Vérifier la release**
   ```bash
   gh release view v0.1.20
   ```

## 🐳 Builds Docker Séparés

Pour builder uniquement certaines plateformes via Docker:

```bash
# Linux uniquement
npm run docker:linux

# Windows uniquement
npm run docker:windows

# Tous (Linux + Windows)
npm run docker:build
```

## 🔧 Dépannage

### Docker ne démarre pas

```bash
# Vérifier que Docker Desktop est lancé
docker info

# Reconstruire les images
cd docker
docker compose build --no-cache
```

### Erreur de signature

```bash
# Vérifier que les clés sont chargées
echo $TAURI_SIGNING_PRIVATE_KEY | head -c 50

# Régénérer les clés si nécessaire
npm run release:generate-keys
```

### Build Windows échoue

Le cross-compile Windows nécessite `cargo-xwin`. Le Dockerfile l'installe automatiquement, mais la première build peut être lente (téléchargement du SDK Windows).

### Pas d'artifacts macOS

Les builds macOS ne fonctionnent que sur macOS (restriction Apple). Utilisez GitHub Actions pour les builds macOS si vous n'êtes pas sur Mac.

### Authentification GitHub échoue

```bash
gh auth status
gh auth login
```

## 📊 CI/CD GitHub Actions

Le projet a aussi des workflows GitHub Actions pour les builds automatisés:

- `.github/workflows/ci.yml` - Tests et linting sur chaque PR
- `.github/workflows/release.yml` - Build complet sur tag `v*`

Les GitHub Actions sont utiles pour:
- Builds sur des runners dédiés
- Builds macOS sans avoir de Mac
- Releases automatiques depuis CI

## 🔗 Liens Utiles

- [Tauri Updater Documentation](https://v2.tauri.app/plugin/updater/)
- [Tauri Signing Guide](https://v2.tauri.app/distribute/sign/)
- [GitHub CLI Manual](https://cli.github.com/manual/)
