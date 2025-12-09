# Kaizen Launcher

> **Early Access Preview**
>
> This project is currently in **early beta** and under active development. Features may be incomplete, unstable, or subject to change. Use at your own risk and expect bugs!
>
> We welcome feedback and bug reports via [GitHub Issues](https://github.com/KaizenCore/Kaizen-Launcher/issues).

A modern, feature-rich Minecraft launcher built with Tauri 2, React 19, and TypeScript.

## Features

### Client Support
- **Vanilla** - Pure Minecraft experience
- **Fabric** - Lightweight modding platform
- **Forge** - Classic modding framework
- **NeoForge** - Modern Forge successor
- **Quilt** - Fabric-compatible alternative

### Server Support
- **Vanilla** - Official Minecraft server
- **Paper** - High-performance Spigot fork
- **Purpur** - Paper fork with extra features
- **Folia** - Multi-threaded Paper fork
- **Pufferfish** - Optimized Paper fork
- **Fabric** - Fabric server
- **Forge/NeoForge** - Modded servers
- **SpongeVanilla/SpongeForge** - Plugin API platform

### Proxy Support
- **Velocity** - Modern proxy server
- **BungeeCord** - Original proxy solution
- **Waterfall** - BungeeCord fork

### Additional Features
- **Microsoft Authentication** - Secure OAuth login
- **Modrinth Integration** - Browse and install mods/modpacks
- **Instance Management** - Multiple isolated instances
- **Java Management** - Automatic Java 21 installation
- **Server Console** - Real-time server output and commands
- **Tunnel Support** - Expose servers via Cloudflare, Playit, Ngrok, or Bore
- **Custom JVM Arguments** - Per-instance memory and JVM settings
- **Internationalization** - French and English support

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.70+
- Platform-specific dependencies:
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/kaizen-launcher.git
cd kaizen-launcher

# Install dependencies
npm install

# Start development server
npm start
```

### Build for Production

```bash
npm run tauri build
```

## Development Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start Tauri development server |
| `npm run dev` | Start Vite frontend only |
| `npm run build` | Build frontend for production |
| `npm run tauri build` | Build complete application |
| `npm run type-check` | Check TypeScript types |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint issues |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run restart` | Kill and restart dev server |
| `npm run stop` | Stop all dev processes |

## Project Structure

```
kaizen-launcher/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── ui/            # Radix UI components
│   │   ├── layout/        # Layout components
│   │   └── dialogs/       # Modal dialogs
│   ├── pages/             # Route pages
│   ├── i18n/              # Internationalization
│   ├── hooks/             # Custom React hooks
│   └── lib/               # Utilities
├── src-tauri/             # Rust backend
│   └── src/
│       ├── auth/          # Microsoft OAuth
│       ├── db/            # SQLite operations
│       ├── download/      # Download management
│       ├── instance/      # Instance management
│       ├── launcher/      # Game launching
│       ├── minecraft/     # Version management
│       ├── modloader/     # Loader support
│       ├── modrinth/      # Modrinth API
│       └── tunnel/        # Server tunneling
└── .github/workflows/     # CI/CD pipelines
```

## Security

- **Token Encryption**: Access and refresh tokens are encrypted at rest using AES-256-GCM
- **Content Security Policy**: Strict CSP to prevent XSS attacks
- **Secure Downloads**: SHA1/SHA256 verification for all downloaded files
- **No Secrets in Code**: OAuth uses device code flow (public client)

## Configuration

### Data Directory

The launcher stores data in platform-specific locations:

| Platform | Location |
|----------|----------|
| Windows | `%APPDATA%\com.kaizen.launcher` |
| macOS | `~/Library/Application Support/com.kaizen.launcher` |
| Linux | `~/.local/share/com.kaizen.launcher` |

### Database

SQLite database (`kaizen.db`) contains:
- `accounts` - Microsoft and offline accounts
- `instances` - Game instances with settings
- `instance_mods` - Installed mods per instance
- `settings` - Application settings
- `tunnel_configs` - Server tunnel configurations

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- **TypeScript**: ESLint + Prettier
- **Rust**: `cargo fmt` + Clippy

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop app framework
- [Modrinth](https://modrinth.com/) - Mod hosting platform
- [PaperMC](https://papermc.io/) - Server software
- [Radix UI](https://www.radix-ui.com/) - UI primitives
