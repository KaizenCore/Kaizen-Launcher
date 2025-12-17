# Changelog

All notable changes to Kaizen Launcher will be documented in this file.

## [0.6.4] - 2025-12-17

### Added
- **Skin Viewer Background Customization** - New background settings for the 3D skin viewer
  - Three modes: Theme (uses current theme colors), Color (custom color picker), Image (custom background image)
  - Color mode includes preset colors and hex input
  - Image mode supports PNG, JPG, WebP, and GIF formats
  - Settings persist in localStorage across sessions

### Changed
- **Theme-Aware Background** - Default skin viewer background now uses your theme's card color instead of hardcoded blue
  - Automatically updates when switching between light and dark themes
  - Dynamically reads CSS custom properties for accurate theming

### Technical
- Added `backgroundImage` prop to `SkinViewer3D` component
- HSL to hex conversion for CSS custom property colors
- Background preferences stored in localStorage with key `kaizen-skin-viewer-background`
- New translation keys for background settings UI in all 4 locales

## [0.6.3] - 2025-12-17

### Added
- **Mods List Refactor** - Complete redesign of the mods tab in instance details
  - Infinite scroll replaces pagination for smoother browsing
  - View modes: List and Grid layouts
  - Sort options: Name (A-Z, Z-A), Enabled first, Disabled first, Updates first
  - Filter options: All, Enabled only, Disabled only, With updates
  - Improved performance with lazy loading
- **Mod Sync from Modrinth** - Identify and restore mod metadata for imported modpacks
  - Multi-technique identification: SHA-512 hash, SHA-1 hash, filename parsing + search
  - Similarity scoring algorithm finds best matches on Modrinth
  - Restores icons, descriptions, and project links for unidentified mods
  - Progress indicator shows sync status in real-time
  - Useful for imported modpacks where mods lack metadata

### Fixed
- **Skins Manager Scroll** - Fixed missing scroll in Skins page tabs (Favorites, Browse, Upload). Refactored to use flexbox layout like other pages for proper height adaptation
- **Schematics Copy to Instance** - Fixed "missing required key instanceIds" error when copying schematics to instances from the library
- **Settings Persistence** - Fixed appearance settings not persisting after app restart
  - Language, theme, and custom colors now stored in SQLite database instead of browser localStorage
  - Tauri webview localStorage was not persistent between app sessions
  - Migration from Zustand persist middleware to backend Tauri commands
- **Custom Theme Persistence** - Custom theme colors and presets now correctly persist across app restarts
- **Language Settings Persistence** - Selected language no longer resets to English on every app restart

### Technical
- New `ModsList.tsx` component with IntersectionObserver-based infinite scroll
- New `sync_mods_metadata` Tauri command with batch hash lookups
- Added `get_versions_by_hashes` method to Modrinth client for batch operations
- Progress events via `mod-sync-progress` Tauri event
- Added `get_appearance_settings`, `save_appearance_setting`, and `save_custom_theme_settings` Tauri commands
- Modified `customThemeStore.ts` to use backend storage instead of localStorage
- Modified `ThemeProvider.tsx` to load/save theme via backend
- Modified `i18n/index.ts` to use backend storage for locale preference
- All appearance settings now use the existing `settings` SQLite table

## [0.6.2] - 2025-12-17

### Added
- **Kaizen Branding Theme** - New default theme using official Kaizen brand colors
  - Warm beige/gold color palette (#E8D3AA light, #312E21 dark)
  - Replaces the previous blue default theme
  - Applied to both light and dark modes
- **Butler Icon in TitleBar** - Added the Kaizen butler mascot icon next to the app name
- **Installation Footer** - New minimizable footer showing real-time installation progress
  - Slides up from the bottom of the screen
  - Shows multiple installations simultaneously
  - Displays file counter (e.g., "420/483 files")
  - Click to navigate to instance details

### Changed
- **Parallel Modpack Downloads** - Modpack installation is now ~60% faster
  - 8 simultaneous mod downloads instead of sequential
  - Parallel metadata fetching for all mods
  - Installation time reduced from ~2 min to ~44s for large modpacks
- **Installation Queue System** - Prevents duplicate installations
  - Install button disabled while modpack is already installing
  - Shows loading spinner during installation
- **WebTorrent Removal** - Removed unused WebTorrent P2P dependency and related Node.js polyfills
  - HTTP tunnels are now the exclusive sharing method (more reliable, better firewall compatibility)
  - Reduced bundle size by 122 packages
  - Removed `vite-plugin-node-polyfills` dependency
  - Deleted `bittorrent-dht` stub file

### Technical
- Simplified `vite.config.ts` by removing nodePolyfills plugin configuration
- Cleaned up `src/lib/stubs/` directory
- Updated `src/index.css` with new Kaizen brand color variables
- Updated `src/lib/customTheme.ts` with new default color values (hue 40, saturation 55)
- Backend: `download_files_parallel_with_progress()` for mod downloads
- Backend: Semaphore-limited parallel metadata fetching with `FuturesUnordered`
- Frontend: New `InstallationFooter` component replacing `InstallationNotification`
- Frontend: Enhanced `installationStore` with `isProjectInstalling()` and queue management

## [0.6.1] - 2025-12-16

### Fixed
- **Forge 1.18+ Launch Fix** - Fixed `Missing required option(s) [fml.mcpVersion]` error when launching Forge modpacks
  - Changed FML argument from `--fml.neoFormVersion` to `--fml.mcpVersion` for Forge (NeoForge uses different args)
  - Added missing `--fml.forgeGroup=net.minecraftforge` argument
  - MCP version now extracted and saved during Forge installation (`forge_meta.json`)
- Instance names now properly truncate with ellipsis in Schematics "By Instance" view

### Technical
- Removed unused Rust imports and variables (22 compiler warnings fixed)
- Added `extract_forge_mcp_version()` function to extract MCP_VERSION from Forge installer
- Added `read_mcp_version()` function to read MCP version at launch time

## [0.6.0] - 2025-12-14

### Added
- **Schematics Manager** - Complete schematic library management system
  - Import, organize, and manage .schem, .schematic, .litematic, and .nbt files
  - View dimensions, format, author, and metadata extracted from NBT
  - Tags and favorites system for organization
  - Search and filter by format
- **Bidirectional Sync** - Sync schematics between library and instances
  - Copy schematics to WorldEdit, Litematica, Axiom, or Create folders
  - Import schematics from instances back to library
  - Automatic conflict detection and resolution
- **Smart Scanning** - Scan all instances for existing schematics
  - Detects schematics in client and server folders
  - Parallel scanning for fast results
- **Schematic Sharing** - Share schematics via HTTP tunnel (Bore or Cloudflare)
  - Password protection support
  - Download counter
  - Integration with sharing system
- **Cloud Ready** - Upload schematics to cloud storage providers

### Technical
- Streaming hash calculation for large files
- Parallel instance scanning
- N+1 query elimination in database
- React memoization and debounced search
- Stable translation hooks

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
