# Kaizen Launcher v0.6.2

## Release Notes

This release brings **60% faster modpack installation** with parallel downloads, a new installation progress footer, the official Kaizen branding theme, and bundle size optimization.

## Added

### Kaizen Branding Theme

The launcher now uses the official Kaizen brand colors as the default theme:

- **Light mode**: Warm beige background (#E8D3AA) with dark brown text (#312E21)
- **Dark mode**: Dark brown background (#312E21) with warm beige text (#E8D3AA)
- Replaces the previous blue default theme
- All UI elements (buttons, accents, borders) follow the new color scheme

### Butler Icon in TitleBar

Added the Kaizen butler mascot icon next to the app name in the title bar for better brand recognition.

### Installation Progress Footer

New minimizable footer that appears during installations:

- **Slides up from the bottom** - Non-intrusive design
- **Multiple installations** - Track several downloads at once
- **Real-time file counter** - Shows progress like "420/483 files"
- **Minimizable** - Click to collapse, click again to expand
- **Quick navigation** - Click the arrow to jump to instance details

## Changed

### Parallel Modpack Downloads (~60% Faster)

Modpack installation has been completely overhauled for speed:

| Before | After |
|--------|-------|
| Sequential downloads | 8 parallel downloads |
| ~2 minutes | ~44 seconds |
| No file counter | Real-time file counter |

**What changed:**
- Mod files now download 8 at a time instead of one by one
- Metadata fetching runs in parallel with semaphore-limited concurrency
- Progress updates every file instead of every stage

### Installation Queue System

Prevents accidental duplicate installations:

- Install button disables while a modpack is already installing
- Shows loading spinner during active installation
- Tracks installations by project ID to prevent duplicates

### WebTorrent Removal

Removed the unused WebTorrent P2P sharing system. The launcher now exclusively uses HTTP tunnels for instance sharing, which provides:

- **Better reliability** - No NAT traversal issues
- **Firewall friendly** - Works through corporate/school firewalls
- **Simpler codebase** - No complex P2P logic to maintain

**What was removed:**
- `webtorrent` dependency
- `vite-plugin-node-polyfills` dependency (was only needed for WebTorrent)
- `bittorrent-dht` stub file (`src/lib/stubs/bittorrent-dht.ts`)
- Node.js polyfills in Vite config (buffer, stream, events, util, process, path, crypto, os)

**Impact:**
- 122 packages removed from `node_modules`
- Faster npm install times
- Smaller development footprint
- No change to user-facing functionality (HTTP tunnel sharing works the same)

## Technical Changes

### Backend (Rust)
- `src-tauri/src/modrinth/commands.rs` - Parallel downloads using `download_files_parallel_with_progress()`
- Semaphore-limited parallel metadata fetching with `FuturesUnordered`
- Progress events now include `project_id` and `current/total` file counts

### Frontend (React/TypeScript)
- `src/components/notifications/InstallationFooter.tsx` - New installation progress footer
- `src/stores/installationStore.ts` - Added `isProjectInstalling()`, `projectId` tracking, queue management
- `src/pages/ModpackDetails.tsx` - Install button disabled during installation
- `src/components/browse/ModpackBrowser.tsx` - Install button disabled during installation
- Deleted `src/components/notifications/InstallationNotification.tsx` (replaced by footer)

### Files Modified
- `src/index.css` - Updated CSS variables with new Kaizen brand colors
- `src/lib/customTheme.ts` - Updated default color values (hue 40, saturation 55)
- `src/components/layout/TitleBar.tsx` - Added butler icon
- `vite.config.ts` - Removed nodePolyfills plugin, bittorrent-dht alias, and optimizeDeps.include for webtorrent
- `package.json` - Removed vite-plugin-node-polyfills dependency

### Files Added
- `public/kaizen.png` - Butler mascot icon
- `src/components/notifications/InstallationFooter.tsx` - New progress footer

### Files Deleted
- `src/lib/stubs/bittorrent-dht.ts`
- `src/components/notifications/InstallationNotification.tsx`

## Upgrading

This is a drop-in replacement for v0.6.1. No user action required. Existing users may need to reset their theme to "default" in Settings > Appearance to see the new Kaizen branding colors.

## Full Changelog

See [CHANGELOG.md](../CHANGELOG.md) for the complete changelog.
