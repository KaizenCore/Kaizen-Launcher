<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Kaizen Launcher" width="128" height="128">
</p>

<h1 align="center">Kaizen Launcher</h1>

<p align="center">
  <strong>A modern, feature-rich Minecraft launcher</strong>
</p>

<p align="center">
  <a href="https://github.com/KaizenCore/Kaizen-Launcher/releases/latest">
    <img src="https://img.shields.io/github/v/release/KaizenCore/Kaizen-Launcher?style=flat-square&color=blue" alt="Latest Release">
  </a>
  <a href="https://github.com/KaizenCore/Kaizen-Launcher/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/KaizenCore/Kaizen-Launcher?style=flat-square" alt="License">
  </a>
  <a href="https://github.com/KaizenCore/Kaizen-Launcher/releases">
    <img src="https://img.shields.io/github/downloads/KaizenCore/Kaizen-Launcher/total?style=flat-square&color=green" alt="Downloads">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux">
</p>

---

> **Early Access Preview**
>
> This project is currently in **early beta** and under active development. Features may be incomplete or subject to change.
>
> We welcome feedback and bug reports via [GitHub Issues](https://github.com/KaizenCore/Kaizen-Launcher/issues).

---

## Downloads

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| Windows | [Kaizen-Launcher_x.x.x_x64-setup.exe](https://github.com/KaizenCore/Kaizen-Launcher/releases/latest) |
| macOS (Apple Silicon) | [Kaizen-Launcher_x.x.x_aarch64.dmg](https://github.com/KaizenCore/Kaizen-Launcher/releases/latest) |
| macOS (Intel) | [Kaizen-Launcher_x.x.x_x64.dmg](https://github.com/KaizenCore/Kaizen-Launcher/releases/latest) |
| Linux (Debian/Ubuntu) | [Kaizen-Launcher_x.x.x_amd64.deb](https://github.com/KaizenCore/Kaizen-Launcher/releases/latest) |
| Linux (Fedora/RHEL) | [Kaizen-Launcher_x.x.x.rpm](https://github.com/KaizenCore/Kaizen-Launcher/releases/latest) |
| Linux (AppImage) | [Kaizen-Launcher_x.x.x_amd64.AppImage](https://github.com/KaizenCore/Kaizen-Launcher/releases/latest) |

---

## Features

### Modloaders & Clients
- **Vanilla** - Pure Minecraft experience
- **Fabric** - Lightweight modding platform
- **Forge** - Classic modding framework
- **NeoForge** - Modern Forge successor
- **Quilt** - Fabric-compatible alternative

### Server Software
- **Vanilla** - Official Minecraft server
- **Paper** - High-performance Spigot fork
- **Purpur** - Paper fork with extra features
- **Folia** - Multi-threaded Paper fork
- **Pufferfish** - Optimized Paper fork
- **Fabric/Forge/NeoForge** - Modded servers
- **SpongeVanilla/SpongeForge** - Plugin API platform

### Proxy Support
- **Velocity** - Modern proxy server
- **BungeeCord** - Original proxy solution
- **Waterfall** - BungeeCord fork

### Instance Management
- Multiple isolated instances with custom settings
- Per-instance JVM arguments and memory allocation
- Mod management with enable/disable support
- Batch actions for mods (select, enable, disable, delete)
- World management with backup/restore functionality

### Modrinth Integration
- Browse and search mods, modpacks, resourcepacks, shaders
- One-click installation with dependency resolution
- Version compatibility checking
- Modpack installation with automatic mod downloads

### Authentication
- **Microsoft Authentication** - Secure OAuth Device Code flow
- **Offline Mode** - Play without an account
- Multiple account support with easy switching

### Discord Integration
- **Rich Presence** - Show your activity on Discord
  - Idle status when browsing the launcher
  - Playing status with instance name, version, and modloader
  - Hosting status for servers with player count
- **Webhooks** - Get notified on Discord
  - Server start/stop notifications
  - Player join/leave notifications
  - Configurable per event type

### Cloud Backup Storage
- Sync world backups to cloud providers:
  - Google Drive
  - Dropbox
  - Nextcloud (WebDAV)
  - S3-compatible storage (AWS, MinIO)
- Automatic upload option
- Sync status tracking

### Server Features
- Real-time console output with command input
- Tunnel support for easy server sharing:
  - Cloudflare Tunnel
  - Playit.gg
  - Ngrok
  - Bore
- Automatic port configuration
- Player join/leave detection

### Additional Features
- **Java Management** - Automatic Java 21 installation
- **Onboarding Wizard** - Guided setup for new users
- **Interactive Tour** - Learn the launcher features
- **Custom Themes** - Personalize your experience
- **Internationalization** - French and English support

---

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** - Complete guide for using the launcher
- **[Features Overview](docs/FEATURES.md)** - Detailed feature documentation

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.70+
- Platform-specific dependencies:
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools with C++ workload

### Quick Start

```bash
# Clone the repository
git clone https://github.com/KaizenCore/Kaizen-Launcher.git
cd Kaizen-Launcher

# Install dependencies
npm install

# Start development server
npm start
```

### Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start Tauri development server |
| `npm run restart` | Restart development server |
| `npm run stop` | Stop all dev processes |
| `npm run tauri build` | Build for production |
| `npm run type-check` | Check TypeScript types |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run test` | Run tests |

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Radix UI
- **Backend**: Rust, Tauri 2, SQLite (sqlx)
- **Build**: Vite, ESBuild

---

## Project Structure

```
Kaizen-Launcher/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── ui/            # Radix UI primitives
│   │   ├── layout/        # Layout (Sidebar, TitleBar)
│   │   ├── dialogs/       # Modal dialogs
│   │   └── onboarding/    # Onboarding wizard
│   ├── pages/             # Route pages
│   ├── i18n/              # Translations (en, fr)
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # Zustand stores
│   └── lib/               # Utilities
├── src-tauri/             # Rust backend
│   └── src/
│       ├── auth/          # Microsoft OAuth
│       ├── db/            # SQLite operations
│       ├── discord/       # Discord RPC & Webhooks
│       ├── download/      # Download management
│       ├── instance/      # Instance management
│       ├── launcher/      # Game launching
│       ├── minecraft/     # Version management
│       ├── modloader/     # Loader support
│       ├── modrinth/      # Modrinth API
│       ├── cloud_storage/ # Cloud backup providers
│       └── tunnel/        # Server tunneling
└── .github/workflows/     # CI/CD pipelines
```

---

## Data Storage

| Platform | Location |
|----------|----------|
| Windows | `%APPDATA%\com.kaizen.launcher` |
| macOS | `~/Library/Application Support/com.kaizen.launcher` |
| Linux | `~/.local/share/com.kaizen.launcher` |

---

## Security

- **Token Encryption**: AES-256-GCM encryption for access/refresh tokens
- **Content Security Policy**: Strict CSP to prevent XSS attacks
- **Secure Downloads**: SHA1/SHA256 verification for all files
- **No Secrets in Code**: OAuth uses public client (Device Code flow)

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- **TypeScript**: ESLint + Prettier
- **Rust**: `cargo fmt` + Clippy

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop app framework
- [Modrinth](https://modrinth.com/) - Mod hosting platform
- [PaperMC](https://papermc.io/) - Server software
- [Radix UI](https://www.radix-ui.com/) - UI primitives

---

<p align="center">
  Made with <a href="https://tauri.app">Tauri</a> + <a href="https://react.dev">React</a>
</p>
