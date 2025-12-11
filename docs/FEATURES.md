# Kaizen Launcher - Features Overview

## Instance Management

### Multi-Instance Support
Create and manage multiple Minecraft installations, each with their own:
- Minecraft version
- Modloader configuration
- Memory settings
- Mod collection
- World saves

### View Modes
- **Grid View**: Large cards with visual information
- **List View**: Compact list with quick actions
- **Compact View**: Maximum density for many instances

### Instance Types

| Type | Use Case | Supported Software |
|------|----------|-------------------|
| Client | Playing Minecraft | Vanilla, Fabric, Quilt, Forge, NeoForge |
| Server | Hosting servers | Paper, Purpur, Folia, Pufferfish, Fabric, Forge |
| Proxy | Network servers | Velocity, BungeeCord, Waterfall |

---

## Modloader Support

### Client Modloaders

| Loader | Description | Compatibility |
|--------|-------------|---------------|
| **Fabric** | Lightweight, fast updates | Modern versions (1.14+) |
| **Quilt** | Fabric fork with enhancements | Modern versions (1.14+) |
| **Forge** | Classic modding platform | All versions |
| **NeoForge** | Modern Forge successor | 1.20.1+ |

### Server Software

| Software | Description | Best For |
|----------|-------------|----------|
| **Paper** | High-performance Spigot fork | Most servers |
| **Purpur** | Paper fork with extras | Customization |
| **Folia** | Multi-threaded Paper | Large servers |
| **Pufferfish** | Optimized Paper | Performance |

---

## Mod Management

### Modrinth Integration
- Browse thousands of mods
- Search by name, category, loader
- Version compatibility filtering
- Automatic dependency resolution
- One-click installation

### Mod Operations
- **Enable/Disable**: Toggle mods without deleting
- **Update Detection**: Find newer versions
- **Batch Updates**: Update all mods at once
- **Batch Selection**: Select multiple for bulk actions

### Modpack Support
- Install complete modpacks from Modrinth
- Automatic mod downloading
- Version selection
- Creates new instance with all mods

---

## World & Backup System

### World Management
- View all worlds per instance
- Rename, copy, delete worlds
- See world size and last played
- Open world folder directly

### Backup Features
- **Manual Backups**: Create on demand
- **Auto-Backup**: Before each launch
- **Restore**: Return to any backup point
- **Global View**: See all backups in one place

### Cloud Sync
Upload backups to cloud storage:
- Google Drive (OAuth)
- Dropbox (OAuth)
- Nextcloud (WebDAV)
- S3-Compatible (AWS, MinIO)

---

## Server Hosting

### Server Console
- Real-time log output
- Command input
- Colored log levels
- Auto-scroll

### Server Statistics
- Player count
- Server TPS
- Memory usage
- CPU usage
- Uptime

### Tunnel Support
Share your server without port forwarding:

| Provider | Setup | Features |
|----------|-------|----------|
| **Playit.gg** | Easy | Free, game-optimized |
| **Cloudflare** | Medium | Zero Trust, reliable |
| **Ngrok** | Easy | Auth tokens, domains |
| **Bore** | Simple | Lightweight CLI |

Features:
- Auto-start with server
- URL persistence
- Copy-to-clipboard
- Status indicators

---

## Discord Integration

### Rich Presence
Show your activity on Discord:

**States:**
- `Idle` - Browsing launcher
- `Playing` - In-game with instance details
- `Hosting` - Running a server

**Displayed Info:**
- Instance name
- Minecraft version
- Modloader type
- Elapsed time

### Webhooks
Receive notifications for:
- Server started/stopped
- Player joined/left
- Backup created

Configure per-event and test before using.

---

## Account Management

### Microsoft Accounts
- Secure OAuth Device Code flow
- No password storage
- Token encryption (AES-256-GCM)
- Multiple account support

### Offline Accounts
- Play without internet
- Custom username
- Automatic UUID generation

### Account Features
- Set active account
- Visual badges
- Skin display
- Quick switching

---

## Customization

### Theming
- Light/Dark/System modes
- Custom color palette
- Preset themes:
  - Modern
  - Cyberpunk
  - Ocean
  - Forest
  - Sunset

### Per-Instance Settings
- Custom icons (URL or file)
- Memory allocation
- Java version
- JVM arguments
- Auto-backup toggle

### JVM Templates
Pre-configured arguments for:
- Vanilla optimization
- Fabric optimization
- Forge optimization
- Server optimization

---

## Configuration

### Config Editor
Edit server/mod configs directly:
- YAML support
- JSON support
- TOML support
- Properties files
- Syntax-aware editing

### Log Viewer
- Browse all log files
- Syntax coloring by level
- Search within logs
- Filter by level
- Sort by date/name/size

---

## Performance (v0.4.0)

### Optimizations
- 90% CPU reduction
- Parallel database operations
- Optimized polling intervals
- Non-blocking async operations
- Proper React memoization

### Resource Usage
- Idle: <5% CPU
- Active: <20% CPU
- Memory: ~150MB base

---

## Internationalization

### Supported Languages
- English (US)
- French (FR)

### Features
- Type-safe translations
- Runtime language switching
- Locale-aware formatting

---

## Security

### Encryption
- AES-256-GCM for tokens
- Secure credential storage
- No plaintext passwords

### Authentication
- OAuth 2.0 Device Code
- No credential exposure
- Automatic token refresh

---

## Cross-Platform

### Supported Platforms

| Platform | Architecture | Format |
|----------|--------------|--------|
| Windows | x64 | MSI, NSIS |
| macOS | Intel x64 | DMG |
| macOS | Apple Silicon | DMG |
| Linux | x64 | DEB, RPM |

### Auto-Updates
- Background update checking
- One-click installation
- Graceful restart

---

## Technical Stack

### Frontend
- React 19
- TypeScript
- Tailwind CSS
- Shadcn/UI (Radix)
- Zustand state management

### Backend
- Rust
- Tauri 2
- SQLite (sqlx)
- Tokio async runtime

---

*Kaizen Launcher v0.4.0 - Modern Minecraft Management*
