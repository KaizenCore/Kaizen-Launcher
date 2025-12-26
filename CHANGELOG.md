# Changelog

All notable changes to Kaizen Launcher will be documented in this file.

## [0.7.5] - 2025-12-26

### Added
- **Full Instance Backups** - Create complete backups of entire instances
  - Backup includes: mods, configs, saves, libraries, assets, client files
  - 100% autonomous backups that can be restored anywhere
  - New "Create Full Backup" button in instance details → Backups tab
  - Stored in `{data_dir}/backups/instances/{instance_id}/`
- **Instance Backup Cloud Upload** - Upload instance backups to cloud storage
  - Supports all configured providers: Google Drive, Dropbox, Nextcloud, S3
  - Uses separate folder structure: "Kaizen Instance Backups/{instance_id}/"
  - Same configuration as world backups (no additional setup needed)
  - Shows sync status badge on uploaded backups
- **Instance Backup Restore** - Restore instance backups with two options
  - Replace existing instance: Overwrites all files in the original instance
  - Create new instance: Creates a new instance from backup with custom name
  - Progress tracking during restore operation
- **Backups Page Redesign** - New tab-based interface
  - Separate tabs for World Backups and Instance Backups
  - Each tab has its own filtering, sorting, and statistics
  - Fixed: World backups no longer show instance backups incorrectly
- **Change Instance Minecraft Version** - Change the Minecraft version of existing instances
  - New "Change Version" button in instance settings (next to version display)
  - Multi-step dialog: Select version → Compatibility check → Progress → Complete
  - Works for both client and server instances
  - Preserves user data: mods, configs, worlds, resource packs, shader packs
  - Cleans installation files: client/, libraries/, assets/, natives/, .installed
- **Mod Compatibility Checking** - Automatic mod compatibility verification via Modrinth API
  - Checks all mods with `.meta.json` files against the new version
  - Three compatibility states: Compatible (update available), Incompatible, Unknown
  - Shows grouped mod list with icons and version info
  - Unknown mods (no Modrinth link) are preserved and shown separately
- **Auto-Update Compatible Mods** - Automatically download new mod versions when changing versions
  - Fetches latest compatible version from Modrinth for each mod
  - Downloads and replaces mod files with SHA-512 verification
  - Incompatible mods are preserved (user can manually remove if needed)

### Fixed
- World Backups tab no longer shows instance backups as "Unknown (instance)"
- Backup statistics now correctly exclude instance backups from world backup counts

### Technical
- New `src-tauri/src/instance/instance_backup.rs` module for instance backup logic
- New Tauri commands: `create_instance_backup`, `restore_instance_backup`, `get_all_instance_backups`, `get_instance_backup_stats`, `delete_instance_backup`, `upload_instance_backup_to_cloud`
- New `src/components/backups/` directory with `WorldBackupsTab.tsx` and `InstanceBackupsTab.tsx`
- Refactored `src/pages/Backups.tsx` to use tab-based layout
- New `src/types/backups.ts` for TypeScript interfaces
- `upload_instance_backup()` function in `cloud_storage/manager.rs`
- Skip "instances" folder in `list_all_backups()` and `get_backup_storage_stats()` in `worlds.rs`
- New `update_version()` method in `src-tauri/src/db/instances.rs`
- New `check_mods_version_compatibility` command in `src-tauri/src/modrinth/commands.rs`
- New `change_instance_version` command in `src-tauri/src/instance/commands.rs`
- New `src/components/dialogs/ChangeVersionDialog.tsx` multi-step dialog component
- New translation keys in all 4 locales (en, fr, de, nl) for instance backups and changeVersion

## [0.7.4] - 2025-12-26

### Added
- **External Launcher Import** - Import instances from other Minecraft launchers
  - Supports Modrinth App, CurseForge, Prism Launcher, MultiMC, and Minecraft Launcher
  - 4-step wizard: Detection → Selection → Options → Progress
  - Auto-detects installed launchers on Windows, macOS, and Linux
  - Select which content to copy: mods, configs, resource packs, shader packs, worlds
- **Modrinth App SQLite Parsing** - Read profile metadata directly from Modrinth's database
  - Parses `app.db` to get game version, mod loader (Fabric, NeoForge, Forge, Quilt)
  - Correctly identifies loader version for all profiles
  - Falls back to folder structure inference if database unavailable
- **Modpack File Support** - Import .mrpack and CurseForge .zip files
  - Extracts `modrinth.index.json` for mod dependencies
  - Handles `overrides/` folders for config and resource files
  - Parses manifest for Minecraft version and loader requirements
- **Content Preview** - See importable content before importing
  - Shows mod count, config files, resource packs, shader packs, and worlds
  - Displays estimated size for each content type
  - Select exactly what to include in the import

### Improved
- **Smart File Copy with Retry** - Better handling of locked files
  - Automatic retry logic for Windows file locking errors (error 32/33)
  - Retries up to 3 times with increasing delays (100ms, 200ms, 300ms)
  - Fallback to manual read/write if direct copy fails
  - Clear error messages suggesting to close source launcher
- **Import UI Redesign** - Modern launcher cards interface
  - Expand/collapse launchers to see instances
  - Select all / Deselect all buttons per launcher
  - Colored badges for loaders (Fabric=amber, Forge=blue, NeoForge=orange, Quilt=purple)
  - Mod count and last played date display
  - Visual selection indicator with checkboxes

### Technical
- New `src-tauri/src/external_import/` module with parsers for each launcher
- Added `sqlx` queries for reading Modrinth App's SQLite database
- `copy_file_with_retry()` function with Windows error code handling
- New `src/components/import/` directory with wizard components
- `LauncherCard` and `InstanceRow` components with shadcn/ui styling

## [0.7.3] - 2025-12-26

### Security
- **Offline Account Permission Gate** - Offline accounts now require `launcher.dev` permission
  - Option hidden from account creation dialog for regular users
  - Server-side validation prevents bypass attempts via direct Tauri command invocation
  - Requires active Kaizen account with valid token for permission verification
- **Enhanced SSRF Protection** - Comprehensive IP range blocking for URL validation
  - Blocks all private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 127.x)
  - Blocks AWS metadata service (169.254.169.254)
  - Blocks IPv6 private ranges (::1, fe80::, fc00::, fd00::)
  - 18 new unit tests for IP validation

### Added
- **TunnelProvider Trait** - New trait interface for tunnel providers
  - Unified interface with `start()`, `stop()`, `name()`, `requires_auth()`, `is_configured()`
  - Implemented for Playit, Cloudflare, Ngrok, and Bore providers
  - Factory function `get_provider()` for provider instantiation
  - Reduces code duplication across tunnel implementations
- **Structured Error Codes** - AppError now includes categorized error codes
  - 60+ error codes across 15 categories (AUTH, INST, DL, LAUNCH, CRYPTO, etc.)
  - `code()` method returns error code (e.g., "AUTH_001")
  - `category()` method returns human-readable category
  - Frontend receives structured JSON with code, category, and message
- **59 New Unit Tests** - Comprehensive test coverage for critical functions
  - LoaderType parsing and validation (12 tests)
  - NeoForge version utilities (9 tests)
  - Forge installer URL generation (5 tests)
  - Java version detection and vendor parsing (15 tests)
  - URL/IP validation for SSRF protection (18 tests)

### Improved
- **UI/UX Enhancements**
  - Framer Motion animations for all dialogs (fade + scale transitions)
  - Comprehensive aria-labels for accessibility (screen reader support)
  - Dismiss buttons on error states across all pages
  - React.memo and useCallback optimizations for SkinCard, ModsList, Accounts
  - Responsive mobile improvements for dialogs and tabs
- **Type Safety** - skinStore.ts now fully typed
  - New interfaces: Skin, Cape, SkinProfile, StoreFavoriteSkin
  - Union types: SkinVariant, SkinSource, CapeSource
  - Removed all `any` type usage

### Technical
- New `src-tauri/src/tunnel/mod.rs` TunnelProviderTrait
- Enhanced `src-tauri/src/error.rs` with ErrorCode enum and serialization
- New `src/components/ui/dialog.tsx` AnimatedDialog components
- Added accessibility section to i18n locales (en.json, fr.json)
- Test count increased from 64 to 123 (all passing)

## [0.7.2] - 2025-12-22

### Added
- **Forge Modloader Installation** - Complete Forge support for Minecraft 1.18+
  - New `forge_processor.rs` module runs Forge installer headlessly
  - Copies patched client JAR (`forge-{version}-client.jar`) to instance
  - Properly installs all Forge libraries including processors
  - Configures Java module system for BootstrapLauncher

### Fixed
- **Forge Launch Target** - Fixed `Missing LaunchHandler forgeclient` error when launching Forge
  - Changed `--launchTarget` argument from `forgeclient` to `forge_client` (with underscore)
  - Forge version.json specifies `forge_client`, not `forgeclient`
  - This was the root cause of all Forge 1.18+ launch failures

### Improved
- **Forge Bootstrap Cleanup** - Added bootstrap version conflict resolution
  - Detects when multiple bootstrap versions exist in libraries
  - Keeps only the highest version to prevent module conflicts
  - Forge installer may download processor libs that conflict with runtime libs
- **Enhanced Forge Logging** - Comprehensive logging with tracing macros
  - Track installer progress, library copies, and bootstrap operations
  - Easier debugging of Forge installation issues
  - Uses `tracing::info!` and `tracing::debug!` throughout

### Technical
- New `src-tauri/src/modloader/forge_processor.rs` module
- Added `forge_version` parameter to `run_processors` function
- Modified `src-tauri/src/launcher/runner.rs` line 154 for correct launch target
- Modified `src-tauri/src/modloader/installer.rs` to pass forge version
- Added `copy_directory_contents` with overwrite-always behavior
- Uses `tracing` crate for structured logging

## [0.7.1] - 2025-12-21

### Added
- **Skin Viewer Cache** - New `skinStore` with 5-minute caching for skin profiles and favorites
  - Instant page loads when returning to Skins page within cache window
  - Automatic cache invalidation when account changes
  - Force refresh after skin uploads/applies
  - Optimistic UI updates for favorites (instant feedback)

### Fixed
- **Playground Panel Error** - Fixed "Group not found" error when navigating away and back to Playground
  - Added try-catch for panel expand/collapse operations during component remounting
  - Prevents crash when panel refs become stale
- **Console Log Spam** - Removed excessive "[App] Kaizen Launcher initializing..." logs
  - Log was in component body causing spam on every re-render
  - Cleaner console output for debugging

## [0.7.0] - 2025-12-21

### Security
- **HTTPS Only** - All HTTP URLs are now blocked; only HTTPS connections are allowed
  - Prevents man-in-the-middle attacks on downloads and API calls
  - URL validation rejects any `http://` scheme
- **Windows DPAPI Key Protection** - AES encryption key is now protected by Windows DPAPI
  - Key file encrypted at OS level, accessible only by the current user
  - Automatic migration of existing unprotected keys
  - Falls back gracefully on non-Windows platforms
- **Token Security Hardening** - Sensitive tokens are never exposed to the frontend
  - New `AccountInfo` struct without `access_token` or `refresh_token` fields
  - Frontend receives `has_valid_token: bool` instead of actual tokens
  - All IPC responses sanitized before transmission
- **Encrypted Secret Storage** - All sensitive data encrypted with AES-256-GCM
  - Discord webhooks, cloud storage tokens, and API keys encrypted at rest
  - Encryption applied to all settings containing sensitive URLs or credentials
- **Sensitive URL Redaction** - Error messages no longer expose sensitive URLs
  - New `redact_sensitive_url()` utility masks tokens, keys, and credentials
  - Applies to logs, error dialogs, and user-facing messages
- **SHA-512 File Verification** - Upgraded from SHA-1 to SHA-512 for mod verification
  - All Modrinth downloads now verified with SHA-512 hashes
  - Stronger collision resistance for integrity checks
  - Backwards compatible with existing SHA-1/SHA-256 verification
- **Server-Side Permission Validation** - Permissions validated with Kaizen API
  - New `validate_permission_with_server()` for security-critical operations
  - Local permission cache rejected if token expired
  - Prevents privilege escalation via cached permissions
- **Argon2id Password Hashing** - Sharing passwords now use Argon2id instead of SHA-256
  - Memory-hard algorithm resistant to GPU/ASIC attacks
  - Parameters: m=19456 KiB, t=2 iterations, p=1 parallelism
  - Automatic migration from legacy SHA-256 hashes
- **Share Token Expiration & Revocation** - Enhanced sharing security
  - Default 24-hour expiration for all shares
  - Optional max download limit per share
  - Manual revocation support via `revoke_share()`
  - Expired/revoked shares automatically rejected

### Performance & Quality
- **Static Regex Compilation** - All regex patterns now use `once_cell::Lazy<Regex>`
  - Eliminates repeated regex compilation on each call
  - Applied to log parser, URL redaction, and NeoForge processor
- **Memory Leak Prevention** - New `useTauriListener` hook for safe Tauri event handling
  - Properly handles async cleanup when components unmount
  - Prevents race conditions with pending `listen()` calls
  - Applied to Console, ServerConsole, and Sidebar components
- **Optimized Tokio Runtime** - Reduced tokio features from "full" to only required features
  - Only includes: fs, io-util, time, net, process, sync, rt-multi-thread, macros
  - Smaller binary size and faster compilation
- **Shared Browser Utilities** - Extracted common code from browse components
  - New `src/types/browse.ts` for shared types (ModSearchResult, ModVersionInfo, etc.)
  - New `src/lib/browse-utils.ts` for shared functions (formatDownloads, pagination)
  - Reduces code duplication across ModBrowser, PluginBrowser, etc.

### Technical
- Added `argon2 = "0.5"` dependency for password hashing
- New `src-tauri/src/utils/redact.rs` module for URL sanitization
- Modified `crypto.rs` with DPAPI integration via `windows-sys` crate
- Enhanced `download/client.rs` with `HashAlgorithm::Sha512` support
- New validation methods in `db/kaizen_accounts.rs` for permission checks
- Updated `sharing/server.rs` with expiration, revocation, and Argon2 hashing
- New `src/hooks/useTauriListener.ts` hook for safe Tauri event subscription
- New `src/types/browse.ts` and `src/lib/browse-utils.ts` for shared browser code
- Optimized `src-tauri/Cargo.toml` tokio features for minimal footprint

## [0.6.9] - 2025-12-21

### Added
- **Panel-Based Playground Layout** - Complete redesign from node-based to a 3-panel layout
  - Left panel: Mod list with search, sort, and filter options
  - Center panel: Console with real-time logs and server commands
  - Right panel: Details with mod info, configs, and instance settings
  - All panels are resizable with drag handles and collapsible via toolbar buttons
  - Uses `react-resizable-panels` library for smooth resizing
- **Quick Add Mod Dialog** - Search and install mods from Modrinth instantly
  - Real-time search with debounce (300ms)
  - Shows mod icon, title, author, description, and download count
  - Auto-selects best compatible version (stable preferred)
  - Infinite scroll for browsing more results
  - Shows "Installed" badge for already-installed mods
- **Import Local Mods** - Upload button to import .jar files from your computer
  - Multi-file selection support
  - Files are copied directly to the instance's mods folder
  - New `get_mods_folder_path` Tauri command for backend support
- **Console Font Size Controls** - Adjust text size in the Playground console
  - Ctrl+Scroll to zoom in/out
  - Slider control (8px to 20px range)
  - +/- buttons for precise adjustments
  - Persists to localStorage across sessions

### Changed
- **Visual Config Editor** - Improved GUI editor for mod config files
  - Support for JSON, TOML, YAML, and .properties files
  - Toggle switches for booleans, sliders for numbers, color pickers for hex colors
  - Nested object and array editing with expand/collapse
  - Toggle between visual and text editor modes
- **Mod List Enhancements** - Better mod management in the left panel
  - Search by mod name or filename
  - Sort by: name (A-Z, Z-A), enabled first, disabled first
  - Filter by: all, enabled, disabled, missing dependencies
  - Infinite scroll with lazy loading
  - Batch selection with "Select All" checkbox
  - Shows missing dependency warnings

### Technical
- Removed React Flow dependency and node-based architecture
- New `src/components/playground/PlaygroundLayout.tsx` - Main 3-panel layout
- New `src/components/playground/panels/` directory with modular components:
  - `PlaygroundModList.tsx` - Left panel mod list
  - `PlaygroundDetailsPanel.tsx` - Right panel with tabs
  - `ModListItem.tsx` - Individual mod row component
  - `QuickAddModDialog.tsx` - Modrinth search and install dialog
  - `ModConfigEditor.tsx` - Visual config editor
  - `ModDetailsTab.tsx`, `InstanceInfoTab.tsx`, `DependencyTreeView.tsx`
- Modified `src/stores/playgroundStore.ts` - Simplified state for panel layout
- Modified `src/components/playground/PlaygroundConsole.tsx` - Added font size controls
- Modified `src/components/playground/PlaygroundToolbar.tsx` - Panel toggle buttons, instance selector
- Added `get_mods_folder_path` command in `src-tauri/src/instance/commands.rs`

## [0.6.8] - 2025-12-19

### Added
- **Playground Visual Canvas** - Complete visual workspace for modpack and server management (requires beta access)
  - Display instance and mods as interconnected nodes with dependency edges
  - React Flow-based canvas with pan, zoom, and drag support
  - MiniMap for navigation and Controls for zoom
  - Dynamic grid layout that adapts to mod count (4-10 columns)
- **Node Search (Ctrl+K)** - Quick search dialog to find mods and nodes
  - Keyboard navigation with arrow keys
  - Press Enter to focus on selected node with smooth animation
  - Search by mod name or instance
- **Monaco Code Editor** - Professional code editor for mod config files
  - Syntax highlighting for TOML, JSON, YAML, and properties files
  - Custom themes (kaizen-dark, kaizen-light) following app theme
  - TOML language registration for proper highlighting

### Fixed
- **NeoForge 1.20.1 Support** - Fixed NeoForge not showing versions for Minecraft 1.20.1
  - Added support for the legacy NeoForge API (`net/neoforged/forge`) which is a fork of Forge
  - The legacy API uses a different Maven repository than versions 1.20.2+ (`net/neoforged/neoforge`)
  - Legacy versions follow the format `1.20.1-47.1.X` instead of `20.X.Y`
  - Different installer URLs for legacy vs modern versions

### Changed
- **Compact Playground Console** - Redesigned console for sidebar integration
  - Minimal toolbar with line count, pause/resume, and clear buttons
  - Smaller font (10px) and reduced padding for compact display
  - Supports ANSI and Minecraft color codes
  - Server command input for server instances
- **Auto-open Config Files** - First config file automatically opens when selecting a mod
  - No manual click required - instant config loading
  - Relevant files filtered by mod name
- **Resizable Right Panel** - Drag to resize the context panel
  - Width range: 280px to 600px
  - Grip handle for intuitive resizing
- **Toolbar Layout** - Converted left sidebar to compact horizontal toolbar
  - Instance selector, status badges, and quick actions in header
  - Edge-to-edge layout with negative margins

### Technical
- New `src/components/playground/PlaygroundConsole.tsx` - Compact console component
- New `src/components/playground/PlaygroundSearch.tsx` - Search dialog with keyboard navigation
- New `src/components/ui/code-editor.tsx` - Monaco Editor wrapper with custom themes
- Modified `src/stores/playgroundStore.ts` - Added search state, focusNode action
- Modified `src/components/playground/PlaygroundCanvas.tsx` - Added ReactFlowProvider, focus handling
- Modified `src/components/playground/PlaygroundContextPanel.tsx` - Auto-load config, resizable panel
- New translation keys for search functionality in all locales

## [0.6.7] - 2025-12-19

### Added
- **Kaizen Permissions System** - New permission-based access control for launcher features
  - Four launcher permissions: `launcher.beta`, `launcher.dev`, `launcher.early_access`, `launcher.exclusive`
  - Permissions synced from Kaizen account tags
  - New Zustand store (`kaizenStore.ts`) for managing account state and permissions
  - `usePermission`, `useAnyPermission`, `useAllPermissions` hooks for easy permission checks
  - `RequirePermission`, `PermissionBadge`, `PermissionGate` components for conditional rendering
- **Playground Page (Beta)** - New experimental page for upcoming features
  - Requires `launcher.beta` permission to access
  - Currently displays "Coming Soon" placeholder for Instance Builder
  - Hidden from sidebar for users without beta permission

### Changed
- **DevTools Access Control** - DevTools now require `launcher.dev` permission
  - DevTools tab hidden from Settings if user lacks permission
  - Keyboard shortcuts (Ctrl+Shift+D/B/L) disabled without permission
  - DevMonitor and BugReportDialog components conditionally rendered
  - New "Feature Permissions" section showing all 4 launcher permissions with visual status
- **React StrictMode Disabled** - Removed StrictMode wrapper to prevent double API calls in development

### Technical
- New `src/stores/kaizenStore.ts` - Zustand store for Kaizen account and permissions
- New `src/hooks/usePermission.ts` - Permission checking hooks
- New `src/components/permissions/RequirePermission.tsx` - Permission UI components
- New `src/pages/Playground.tsx` - Playground page component
- Modified `src/App.tsx` - Added permission checks for DevTools, loads Kaizen account on startup
- Modified `src/pages/Settings.tsx` - DevTools tab conditionally rendered based on permission
- Modified `src/components/layout/Sidebar.tsx` - Added Playground nav item
- Modified `src/main.tsx` - Removed React.StrictMode wrapper
- New translation keys for permissions and playground in all locales

## [0.6.6] - 2025-12-18

### Added
- **Kaizen Account OAuth Integration** - Connect your Kaizen account via OAuth Device Code flow
  - New "Kaizen Accounts" section in Accounts page (below Minecraft accounts)
  - Device Code authentication flow (similar to Microsoft)
  - Secure token storage with AES-256-GCM encryption
  - Auto-refresh tokens when expired (5-minute buffer)
  - Sync user info (tags, badges, permissions) at app startup
  - Manual refresh command available
- **User Badges & Permissions Display** - Show your Kaizen badges and permissions
  - Badges fetched from `/api/v1/user/badges` with custom styling
  - Badge colors (background, text, border) from API
  - Patron badge with Crown icon
  - Permissions displayed below email with clear formatting
  - Tags parsed and permissions extracted
- **System Requirements Check** - New startup verification system
  - Checks for required dependencies (Java) and recommended tools (Cloudflare Tunnel) at every launch
  - Runs silently if all dependencies are present
  - Modal only appears if something is missing
  - Java is mandatory (must install to continue)
  - Cloudflare is recommended but can be skipped (persisted in localStorage)
  - Priority overlay (z-60) displays before onboarding
- **Splash Screen** - Beautiful loading screen at app startup
  - Displays Kaizen logo with animated pulse effect
  - Progress bar with staged animations (Loading → Checking system → Ready)
  - Hides the white flash during initial page load
  - Smooth fade-out animation when ready
  - z-[100] priority (highest, shows first)
- **Home Page Footer** - New footer on the home page with useful links
  - GitHub repository link with Open Source badge
  - Report a bug link to GitHub issues
  - "Made with love by Kaizen Team" message
  - Current version display (v0.6.6)
  - Responsive design: stacked on mobile, inline on desktop
  - Footer sticks to the bottom of the page
- **Backup World Icons** - Backups now display the world icon
  - World icons (icon.png) are saved alongside backup files when creating backups
  - Icons appear in the Backups page list instead of generic server/client icons
  - Icons are stored as PNG files next to the backup ZIP (e.g., world_2024-01-15.png)
  - Works for both client saves and server worlds

### Fixed
- **Kaizen OAuth Scope** - Fixed authentication error caused by incorrect OAuth scope (`user:profile` → `user:read`)

### Changed
- Accounts page subtitle changed from "Manage your Microsoft accounts" to "Manage your accounts"
- Accounts page now shows Minecraft accounts first, Kaizen accounts below

### Technical
- New `src-tauri/src/auth/kaizen.rs` - Kaizen OAuth logic (device code, token refresh, user info, badges)
- New `src-tauri/src/db/kaizen_accounts.rs` - CRUD operations for kaizen_accounts table
- New `kaizen_accounts` SQLite table with encrypted token storage
- New Tauri commands: `login_kaizen_start`, `login_kaizen_complete`, `get_kaizen_accounts`, `get_active_kaizen_account`, `set_active_kaizen_account`, `delete_kaizen_account`, `refresh_kaizen_account`, `sync_kaizen_accounts`
- Added `kaizencore.tech` to CSP (img-src + connect-src)
- Build-time env vars: `KAIZEN_OAUTH_CLIENT_ID` (required), `KAIZEN_OAUTH_BASE_URL` (optional)
- New `src/components/dialogs/AddKaizenAccountDialog.tsx` - Device code flow UI
- New `src/stores/systemCheckStore.ts` - Zustand store for dependency state management
- New `src/components/system-check/SystemCheck.tsx` - Main modal component
- New `src/components/system-check/DependencyCard.tsx` - Reusable dependency status card
- New `src/components/splash/SplashScreen.tsx` - Splash screen with framer-motion animations
- Modified `src/App.tsx` - Integrated SystemCheck, SplashScreen, and Kaizen sync
- New translation keys in all locales for kaizen and systemCheck sections

## [0.6.5] - 2025-12-18

### Added
- **Extended Browse Page** - 4 new tabs for comprehensive Modrinth content browsing
  - **Plugins Tab** - Browse and install plugins for server instances (Paper, Spigot, Purpur, etc.)
  - **Resource Packs Tab** - Browse and install resource packs for client instances
  - **Shaders Tab** - Browse and install shaders for client instances with mod loaders
  - **Datapacks Tab** - Browse and install datapacks for any instance
- **Global Instance Selector** - Single instance selector shared across all Browse tabs
  - Select once, all tabs adapt automatically
  - Shows compatibility warnings when content doesn't match instance type
  - Displays server/client icons, version, and loader badges
- **Smart Compatibility System** - Install buttons disabled for incompatible instances
  - Mods: Work on clients AND modded servers (Fabric, Forge, NeoForge, Quilt)
  - Plugins: Server instances with plugin loaders only
  - Resource Packs: Client instances only
  - Shaders: Client instances with mod loaders only
  - Datapacks: Any instance
- **Cape Refresh Button** - New refresh button in the Capes section to reload capes from all sources
- **Cape Source Badges** - Badges showing cape count per source (Mojang, OptiFine, LabyMod, etc.)
- **Third-Party Cape Preview** - Click on third-party capes to preview them in the 3D viewer
- **Browse Cache System** - New caching layer for Browse page API calls
  - Search results, project versions, and installed IDs cached for 5 minutes
  - Reduces API calls when switching tabs or returning to search
  - Automatic cache invalidation after installs

### Fixed
- **Sidebar Account Sync** - The sidebar now updates instantly when switching accounts
  - Previously required waiting up to 30 seconds or switching windows for the avatar to refresh
  - Backend now emits `active-account-changed` event when account is set or deleted
  - Sidebar listens to the event for real-time updates
- **OptiFine Cape URL** - Fixed HTTP to HTTPS to prevent mixed content issues
- **Browse Page Re-renders** - Fixed excessive re-renders (42+ reduced to 1-2)
  - Zustand store subscriptions now use stable selectors for functions
  - Prevents cascading updates when cache data changes
  - Added ref guard to prevent duplicate instance loading

### Improved
- **Cape Selector Redesign** - Complete overhaul of the cape selection UI
  - Official Mojang capes shown in main section (can be activated via API)
  - Third-party capes (OptiFine, LabyMod, MinecraftCapes, 5zig) shown in separate preview section
  - Better duplicate detection: Mojang API capes prioritized over Capes.dev
  - Tooltips explain that third-party capes are preview-only

### Technical
- New browser components: `PluginBrowser.tsx`, `ResourcePackBrowser.tsx`, `ShaderBrowser.tsx`, `DatapackBrowser.tsx`
- Refactored all browsers to accept `selectedInstance` prop from parent `Browse.tsx`
- Compatibility helper functions exported from `Browse.tsx`: `isModCompatible`, `isPluginCompatible`, etc.
- Each browser imports its compatibility function to disable install buttons when incompatible
- New translation keys for search placeholders: `searchPlugins`, `searchResourcePacks`, `searchShaders`, `searchDatapacks`
- New translation keys for compatibility warnings: `modsNotForServers`, `pluginsOnlyForServers`, etc.
- Added `AppHandle` and `Emitter` to `set_active_account` and `delete_account` commands
- Added Tauri event listener in `Sidebar.tsx` for `active-account-changed` event
- New `browseCacheStore.ts` Zustand store with TTL-based cache (5 min) and max entries (100)
- New `useBrowseCache.ts` hook with stable selectors for cache functions
- Individual Zustand selectors prevent re-renders when unrelated cache data changes

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
