# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kaizen Launcher is a modern Minecraft launcher built with **Tauri 2**, **React 19**, and **TypeScript**. It supports multiple modloaders (Fabric, Forge, NeoForge, Quilt) and server types (Paper, Purpur, Folia, Pufferfish, Velocity, BungeeCord, Waterfall).

## Development Commands

```bash
# Start development server (runs both Vite and Tauri)
npm start              # or: npm run tauri dev

# Restart (kills existing processes then starts)
npm run restart

# Stop all dev processes
npm run stop

# Build for production
npm run tauri build

# Type check TypeScript
npm run type-check

# Linting
npm run lint           # Check for issues
npm run lint:fix       # Auto-fix issues

# Testing
npm run test           # Run tests once
npm run test:watch     # Watch mode

# Rust-specific (run from src-tauri/)
cargo check            # Fast compile check
cargo clippy           # Linting
cargo fmt              # Format code
cargo test             # Run Rust tests

# Release scripts
npm run release:patch  # Bump patch version and trigger CI
npm run release:minor  # Bump minor version
npm run release:major  # Bump major version
```

---

## Architecture

### Backend (Rust/Tauri) - `src-tauri/src/`

#### Core Files

| File | Purpose |
|------|---------|
| `lib.rs` | Tauri Builder setup, plugin registration, command handler registration. All commands are registered here via `tauri::generate_handler![]` |
| `state.rs` | `AppState` struct containing `SqlitePool`, `reqwest::Client`, `data_dir`, running instances map, server stdin handles, tunnels, encryption key. Uses `Arc<RwLock<AppState>>` as `SharedState` |
| `error.rs` | `AppError` enum using `thiserror`. Implements `Serialize` for Tauri IPC. All commands return `AppResult<T>` |
| `crypto.rs` | AES-256-GCM encryption (via `aes-gcm` crate) for token storage. Key stored in `.encryption_key` file with 0600 permissions |

#### Database Layer

**SQLite with sqlx** - WAL mode for concurrent reads, 50 connection pool:

```rust
// Connection config in state.rs
SqliteConnectOptions::new()
    .journal_mode(SqliteJournalMode::Wal)
    .synchronous(SqliteSynchronous::Normal)
    .busy_timeout(Duration::from_secs(30))
```

**Migrations**: Inline in `state.rs::run_migrations()`. Uses idempotent `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN` (silently fails if exists).

**Tables**:
- `accounts` - Microsoft/offline accounts with AES-encrypted tokens
- `instances` - Game instances with loader config, JVM settings, playtime
- `instance_mods` - Mods per instance with enable/disable state
- `settings` - Key-value app settings (JSON values)
- `tunnel_configs` - Per-instance tunnel configuration
- `cloud_storage_config` - Global cloud backup settings (single row id='global')
- `cloud_backup_sync` - Tracks backup upload status
- `discord_config` - Discord RPC and webhook settings
- `skin_favorites` - Saved community skins
- `persistent_shares` - Auto-restored shares on app restart

#### Module Structure

Each feature module follows a pattern: `mod.rs` (types/traits), `commands.rs` (Tauri commands), domain files.

**auth/** - Microsoft OAuth Device Code flow:
- `microsoft.rs` - Device code request, token polling, refresh. Uses Azure AD `/consumers/` endpoint
- `xbox.rs` - XBL authentication, XSTS token
- `minecraft.rs` - Minecraft authentication, profile fetch
- Flow: Microsoft → Xbox Live → XSTS → Minecraft API

**instance/** - Instance CRUD and management:
- Instance = isolated game directory with its own mods, worlds, config
- Fields: `is_server`, `is_proxy` for server/proxy detection
- World management: backup, restore, duplicate, rename
- Config file editing: reads/writes `.properties`, `.yml`, `.json`

**launcher/** - Java and game execution:
- `java.rs` - Java detection (bundled, homebrew, system), version parsing, auto-install via Adoptium API
- `runner.rs` - Process spawning for clients and servers:
  - Builds JVM args (memory, classpath, natives)
  - Builds game args (account, assets, version)
  - Emits `instance-status` and `instance-log` events
  - Tracks playtime, integrates with Discord RPC
  - For NeoForge/Forge: adds `--add-opens` flags and FML arguments

**minecraft/** - Version management:
- `versions.rs` - Fetches/caches Mojang version manifest
- `installer.rs` - Downloads client JAR, libraries, assets with progress events

**modloader/** - Each loader has its own file:
- `fabric.rs` - Fabric Meta API (`meta.fabricmc.net`)
- `forge.rs` - Forge Maven
- `neoforge.rs` - NeoForge Maven (`maven.neoforged.net`)
- `quilt.rs` - Quilt Meta API
- `paper.rs` - PaperMC API (Paper, Velocity, Waterfall, Folia, Purpur, Pufferfish)
- `installer.rs` - Modloader library installation
- `neoforge_processor.rs` - NeoForge installer processor execution

**modrinth/** - Modrinth API v2 client:
- Search, project details, versions, dependencies
- Batch requests with rate limiting (429 retry with exponential backoff)
- Download with SHA1 verification
- Security: Domain allowlist for downloads (`ALLOWED_DOWNLOAD_DOMAINS`)

**download/** - File downloads:
- `client.rs` - `download_file()`, `download_files_parallel_with_progress()`
- SHA1/SHA256 verification, automatic retry with exponential backoff
- Skips existing files with matching hash

**tunnel/** - Server tunneling:
- Providers: `playit.rs`, `cloudflare.rs`, `ngrok.rs`, `bore.rs`
- `agent.rs` - Agent binary download and installation
- `manager.rs` - Start/stop tunnels, status tracking
- Auto-start on server launch if `auto_start` enabled

**cloud_storage/** - World backup sync:
- Providers: `google_drive.rs`, `dropbox.rs`, `nextcloud.rs` (WebDAV), `s3.rs`
- OAuth device code flow for Google/Dropbox
- Upload progress events

**discord/** - Integration:
- `rpc.rs` - Rich Presence via Discord Game SDK IPC
- `webhook.rs` - Discord webhook messages
- `hooks.rs` - Lifecycle hooks (server start/stop, player join/leave)

**sharing/** - Instance export/import:
- `export.rs` - Package instance as zip with manifest
- `import.rs` - Unpack and create instance from package
- `server.rs` - HTTP server with bore tunnel for peer-to-peer sharing

**skins/** - Minecraft skins:
- Profile fetch, skin upload (file/URL)
- MineSkin API integration for community skins
- Cape detection (OptiFine, Migrator, vanilla)

---

### Frontend (React/TypeScript) - `src/`

#### State Management

**Zustand** with persist middleware for client-side state:

```typescript
// stores/onboardingStore.ts pattern
export const useOnboardingStore = create<State>()(
  persist(
    (set) => ({
      completed: false,
      setCompleted: (completed) => set({ completed }),
    }),
    { name: "kaizen-onboarding" }  // localStorage key
  )
);
```

Stores: `onboardingStore.ts`, `customThemeStore.ts`

#### Internationalization

**Type-safe i18n** via Zustand + JSON files:

```typescript
// i18n/index.ts
type TranslationKey = NestedKeyOf<TranslationKeys>;  // "settings.title" etc.

const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
  // Supports {param} and {{param}} interpolation
};
```

Locales: `fr.json`, `en.json`, `de.json`, `nl.json`

#### Theming

React Context-based (`lib/themes.ts`):
- Themes: `"light" | "dark" | "system"`
- `resolvedTheme` gives actual light/dark based on system preference

#### Tauri Communication

```typescript
// Invoke commands
import { invoke } from "@tauri-apps/api/core";
const instances = await invoke<Instance[]>("get_instances");

// Listen to events
import { listen } from "@tauri-apps/api/event";
const unlisten = await listen<InstallProgress>("install-progress", (event) => {
  console.log(event.payload.stage, event.payload.current);
});
```

#### Auto-updates

`useUpdateChecker` hook uses `@tauri-apps/plugin-updater`:
- Auto-check on startup (if enabled in settings)
- Major updates (0.4.x → 0.5.x) shown automatically
- Patch updates shown only on manual check

---

## Key Patterns

### Tauri Command Structure

```rust
#[tauri::command]
pub async fn command_name(
    state: tauri::State<'_, SharedState>,
    app: tauri::AppHandle,
    // other params with serde types
) -> AppResult<ReturnType> {
    let state = state.read().await;
    // Access: state.db, state.http_client, state.data_dir, state.encryption_key
}
```

Commands are registered in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    module::commands::command_name,
])
```

### Event Emission

Backend → Frontend real-time updates:

```rust
use tauri::{AppHandle, Emitter};

let _ = app.emit("install-progress", InstallProgress {
    stage: "installing".to_string(),
    current: 50,
    total: 100,
    message: "Downloading libraries...".to_string(),
    instance_id: Some(id),
});
```

**Events used**:
| Event | Payload | Purpose |
|-------|---------|---------|
| `install-progress` | `InstallProgress` | Installation progress |
| `instance-status` | `InstanceStatusEvent` | Running/stopped status |
| `instance-log` | `InstanceLogEvent` | Console output streaming |
| `tunnel-status` | `TunnelStatusEvent` | Tunnel connection state |
| `tunnel-url` | `TunnelUrlEvent` | Tunnel public URL |
| `cloud-upload-progress` | `CloudUploadProgressEvent` | Backup upload progress |
| `export-progress` | `ExportProgress` | Instance export progress |
| `import-progress` | `ImportProgress` | Instance import progress |
| `share-download-progress` | Progress | Peer download progress |

### Process Management

Running processes tracked in `AppState`:
```rust
pub running_instances: Arc<RwLock<HashMap<String, u32>>>  // instance_id -> PID
pub server_stdin_handles: Arc<RwLock<HashMap<String, Arc<Mutex<ChildStdin>>>>>
pub running_tunnels: Arc<RwLock<HashMap<String, RunningTunnel>>>
```

Server stdin access for sending commands:
```rust
let handles = stdin_handles.read().await;
if let Some(stdin) = handles.get(&instance_id) {
    let mut stdin = stdin.lock().await;
    stdin.write_all(b"stop\n").await?;
}
```

### Security Measures

1. **Token Encryption**: AES-256-GCM with per-installation key
2. **Download Domain Allowlist**: Only trusted CDNs (Modrinth, GitHub, Maven repos)
3. **Hash Verification**: SHA1/SHA256 for all downloaded files
4. **SSRF Protection**: URL validation for user-provided URLs
5. **No Hardcoded Secrets**: OAuth uses public client (Device Code flow)

---

## Data Storage

Platform-specific via `directories` crate:

| Platform | Location |
|----------|----------|
| Windows | `%APPDATA%\com.kaizen.launcher` |
| macOS | `~/Library/Application Support/com.kaizen.launcher` |
| Linux | `~/.local/share/com.kaizen.launcher` |

Structure:
```
com.kaizen.launcher/
├── kaizen.db              # SQLite database
├── .encryption_key        # AES key (600 permissions)
├── logs/                  # Daily rotating logs
├── java/                  # Bundled Java installations
├── instances/             # Game instances (configurable)
│   └── {instance-name}/
│       ├── .installed     # Marker file
│       ├── client/        # Client JAR
│       ├── libraries/     # Game libraries
│       ├── assets/        # Game assets
│       ├── natives/       # Native libraries
│       ├── mods/          # Mods folder
│       ├── world/         # Server worlds
│       └── neoforge_meta.json  # NeoForge metadata
├── versions/              # Cached version manifests
├── tunnel_agents/         # Tunnel binaries (playit, cloudflared, ngrok, bore)
└── sharing/               # Temporary export packages
```

---

## Routes

```
/                              Home (recent instances, quick actions)
/instances                     Instance list
/instances/:instanceId         Instance details (settings, mods, worlds)
/instances/:instanceId/create-server  Create server from client
/browse                        Modrinth browser
/browse/modpack/:projectId     Modpack details
/backups                       Cloud backup management
/sharing                       Server sharing
/accounts                      Account management
/skins                         Skin viewer
/settings                      App settings
/changelog                     Version changelog
```

---

## Dev Tools

- Press `Ctrl+Shift+D` (Mac: `Cmd+Shift+D`) to toggle DevMonitor overlay
- Logs at `{data_dir}/logs/kaizen.log` (daily rotation)
- Set `RUST_LOG=debug` for verbose logging
