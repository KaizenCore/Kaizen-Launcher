# Changelog

All notable changes to Kaizen Launcher will be documented in this file.

## [0.5.4] - 2025-12-12

### Added
- **AppImage Linux Builds** - Re-enabled AppImage format for Linux users
- Improved CI/CD pipeline reliability

### Fixed
- Resolved Clippy warnings across all Rust modules
- Fixed npm rollup issue in CI (optional dependencies bug)
- Prevented duplicate GitHub releases during deployment

### Technical
- Simplified CI workflows (removed redundant build jobs)
- Added concurrency controls to prevent race conditions in releases
- Code style improvements from `cargo clippy --fix`

## [0.5.3] - 2025-12-12

### Added
- **i18n Integrity Check Script** - New `npm run i18n:check` command to verify translation completeness
  - Compares all language files against English base
  - Reports missing keys, extra keys, type mismatches, and empty values
  - Shows coverage percentage summary for each locale
- Enhanced large screen support with 4xl breakpoint (2560px) for ultra-wide/4K displays

### Fixed
- Sidebar badge count now updates correctly when shares are deleted with an instance
- Missing skin translations for Dutch (nl) and German (de) languages - 85+ keys added
- Hardcoded strings replaced with i18n translation keys across multiple components:
  - ConfigEditor: French "Ajouter un element" text
  - CloudStorageConfig: 8 toast messages
  - DiscordConfig: 7 toast messages
  - WorldsTab, Settings, Backups, ModpackDetails, Skins, Home, Instances: Various error messages

### Changed
- Improved responsive grid layouts for 4K displays:
  - Instances page: up to 6 columns on 4xl screens
  - Home page (recent instances): up to 6 columns on 4xl screens
  - Skins page (favorites & browse): up to 12 columns on 4xl screens
  - ModpackDetails gallery: up to 8 columns on 4xl screens
  - Sharing page: up to 4 columns on 4xl screens

### Technical
- Added 12 new translation keys to all 4 language files (en, fr, nl, de)
- All locales now at 100% coverage with 1237+ keys each

## [0.5.2] - 2025-12-12

### Added
- **Skin Manager** - Complete skin customization system
  - Interactive 3D skin viewer with pose animations (idle, walk, run, wave)
  - Camera controls (zoom, rotate, reset) and screenshot capture
  - Browse community skins from MineSkin gallery
  - Search player skins by Minecraft username
  - Favorites system to save preferred skins
  - Upload custom skins from file or URL
  - Cape selector for premium accounts
  - Support for both Classic (Steve) and Slim (Alex) skin variants
- Responsive grid layouts for large screens (up to 4K displays)
- Unified toolbar design for Browse tab

### Changed
- Skin thumbnails now display proper 3D body renders instead of raw textures
- Improved card layouts with better aspect ratios and padding

### Fixed
- Tooltips now properly display above 3D viewer overlays
- Debug console.log statements removed from production code
- Fixed JSX structure issues in Skins page

### Technical
- Added skinview3d library for WebGL skin rendering
- New Tailwind breakpoints for 3xl (1920px) and 4xl (2560px) screens
- Backend skin APIs: MineSkin v2, Ashcon player lookup, MCHeads renders

## [0.5.0] - 2025-12-11

### Added
- Manual update check for dev/patch versions
- HTTP Tunnel sharing system (replaces WebTorrent P2P)

### Fixed
- Update notifications now show for ALL version types

## [0.2.1] - 2025-12-10

### Added
- Full self-hosted runner support (macOS, Linux, Windows)

### Fixed
- Corrected reqwest dependency version (0.12 instead of 0.2.0)
- Fixed self-hosted runner labels for standard GitHub format

## [0.2.0] - 2025-12-10

### Added
- Docker-based cross-platform build system
  - Dockerfile for Linux builds (Ubuntu 22.04, Node 20, Rust)
  - Dockerfile for Windows cross-compilation using cargo-xwin
  - docker-compose.yml with volume caching for faster rebuilds
  - release-docker.sh script for building all platforms locally
- npm scripts for Docker builds: `docker:build`, `docker:linux`, `docker:windows`, `docker:release`
- Self-hosted runner support for faster CI/CD builds
- Local release script with auto-versioning and signing

### Fixed
- npm optional dependencies bug with @tauri-apps/cli (cross-platform clean)
- Window dragging on custom title bar
- Modpack installation notification tracking

### Technical
- Optimized GitHub Actions workflows with better caching
- Added cargo-xwin for MSVC-compatible Windows cross-compilation

## [0.1.18] - 2025-12-10

### Added
- Docker-based cross-platform build system
  - Dockerfile for Linux builds (Ubuntu 22.04, Node 20, Rust)
  - Dockerfile for Windows cross-compilation using cargo-xwin
  - docker-compose.yml with volume caching for faster rebuilds
  - release-docker.sh script for building all platforms locally
- npm scripts for Docker builds: `docker:build`, `docker:linux`, `docker:windows`, `docker:release`
- Support for parallel builds with `--parallel` flag
- GitHub release integration with `--push` flag

### Technical
- Added cargo-xwin for MSVC-compatible Windows cross-compilation from Linux
- Docker volumes cache cargo registry and build targets for incremental builds
- Optimized CI/CD workflows with better caching and concurrency

## [0.1.18] - 2025-12-10

### Added
- Global installation notification system for modpacks
  - Non-blocking floating notification in top-right corner
  - Shows real-time progress for both modpack download (0-50%) and Minecraft installation (50-100%)
  - Click to navigate to instance details
  - Auto-dismisses 3 seconds after completion
- Installation state synchronization across all pages
- Window dragging support via title bar (Tauri 2 capability)

### Changed
- Modpack installation no longer blocks the UI with a modal dialog
- Users can browse and perform other actions while modpacks install
- Improved progress tracking with smooth transitions between installation steps

### Fixed
- Fixed "instance not found" error when clicking on modpack installation notification
- Fixed installation notification not auto-closing after completion
- Fixed progress percentage jumping during modpack installation transitions
- Fixed window not being draggable on custom title bar

### Technical
- Added `installationStore` (Zustand) for global installation state management
- Added `InstallationNotification` component for persistent progress display
- Added `migrateInstallation` method to handle tracking ID changes
- Backend now emits `instance_id` in progress events for proper tracking
- Added `core:window:allow-start-dragging` capability for Tauri 2
