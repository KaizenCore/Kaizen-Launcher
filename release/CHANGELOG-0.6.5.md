# Kaizen Launcher v0.6.5

**Release Date:** December 18, 2025

## Summary

This release brings a major expansion to the Browse page with 4 new content tabs, a smart global instance selector, and a complete overhaul of the cape system.

## New Features

### Extended Browse Page
The Browse page now includes 4 new tabs for comprehensive Modrinth content browsing:
- **Plugins** - Browse and install plugins for server instances (Paper, Spigot, Purpur, Folia, Velocity, BungeeCord, Waterfall)
- **Resource Packs** - Browse and install resource packs for client instances
- **Shaders** - Browse and install shaders for client instances with mod loaders
- **Datapacks** - Browse and install datapacks for any instance

Each tab has its own search, filters, categories, and view modes (grid, list, compact).

### Global Instance Selector
A single instance selector shared across all Browse tabs (except Modpacks):
- Select your instance once, all tabs adapt automatically
- Shows server/client icons with version and loader badges
- Instance names truncated with full name in tooltip
- Compact design on the same line as tabs to maximize content space

### Smart Compatibility System
Install buttons are now intelligently disabled based on instance compatibility:
- **Mods**: Work on clients AND modded servers (Fabric, Forge, NeoForge, Quilt)
- **Plugins**: Server instances with plugin loaders only (Paper, Spigot, etc.)
- **Resource Packs**: Client instances only
- **Shaders**: Client instances with mod loaders only
- **Datapacks**: Any instance

Warning messages explain why content is incompatible with the selected instance.

### Cape Refresh Button
New refresh button in the Capes section to manually reload capes from all sources (Mojang API, OptiFine, LabyMod, MinecraftCapes, 5zig).

### Cape Source Badges
Visual badges showing the number of capes detected from each source, making it easy to see at a glance what capes are available.

### Third-Party Cape Preview
Click on third-party capes (OptiFine, LabyMod, etc.) to preview them in the 3D skin viewer. These capes cannot be activated via the Mojang API but can be viewed.

### Browse Cache System
New caching layer for Browse page API calls:
- Search results, project versions, and installed mod IDs are cached for 5 minutes
- Reduces API calls when switching tabs or returning to previous searches
- Automatic cache invalidation after installing content
- Maximum 100 cache entries with LRU eviction

## Bug Fixes

### Sidebar Account Sync
The sidebar now updates immediately when you change your active account. Previously, you had to wait up to 30 seconds or switch focus away from the app for the sidebar to reflect the account change.

### OptiFine Cape URL
Fixed OptiFine cape URLs from HTTP to HTTPS to prevent mixed content security issues.

### Browse Page Performance
Fixed excessive re-renders in the Browse page:
- Reduced from 42+ re-renders to just 1-2 when navigating
- Zustand store now uses stable selectors for cache functions
- Prevents cascading updates when cache data changes
- Added ref guard to prevent duplicate instance loading calls

## Improvements

### Cape Selector Redesign
Complete overhaul of the cape selection interface:
- **Main Section**: Official Mojang capes (Minecon, Migrator, Twitch, etc.) that can be activated via API
- **Preview Section**: Third-party capes with eye icon indicating they're preview-only
- **Tooltips**: Hover over third-party capes to see explanation
- **Source Badges**: See cape count per source at a glance

## Technical Changes

### Frontend (TypeScript/React)

**New Browser Components:**
- `src/components/browse/PluginBrowser.tsx`
- `src/components/browse/ResourcePackBrowser.tsx`
- `src/components/browse/ShaderBrowser.tsx`
- `src/components/browse/DatapackBrowser.tsx`

**Browse Page Refactor (`src/pages/Browse.tsx`):**
- Global instance selector with compatibility checking
- Exports `BrowseInstance` type and compatibility functions
- `isModCompatible()`, `isPluginCompatible()`, `isResourcePackCompatible()`, `isShaderCompatible()`, `isDatapackCompatible()`

**All Browsers Refactored:**
- Accept `selectedInstance` prop instead of managing own state
- Import compatibility function from `Browse.tsx`
- Disable install buttons when `!isCompatible`

**Sidebar (`src/components/layout/Sidebar.tsx`):**
- Added listener for `active-account-changed` event
- Immediate refresh when account changes

### Backend (Rust)

**Account Events (`src-tauri/src/auth/commands.rs`):**
- Added `AppHandle` parameter to `set_active_account` and `delete_account`
- Both commands now emit `active-account-changed` event

**OptiFine (`src-tauri/src/skins/optifine.rs`):**
- Changed URL from `http://s.optifine.net/capes` to `https://optifine.net/capes`

### Translations

New keys added to all 4 locales (en, fr, de, nl):
- `browse.searchPlugins`, `browse.searchResourcePacks`, `browse.searchShaders`, `browse.searchDatapacks`
- `browse.noInstances`, `browse.modsNotForServers`, `browse.modsRequireLoader`
- `browse.pluginsOnlyForServers`, `browse.pluginsRequireServerType`
- `browse.resourcePacksOnlyForClients`, `browse.shadersNotForServers`, `browse.shadersRequireLoader`
- `settings.whatsNewBrowseTabs`, `settings.whatsNewInstanceSelector`

## Files Changed

### New Files
- `src/components/browse/PluginBrowser.tsx`
- `src/components/browse/ResourcePackBrowser.tsx`
- `src/components/browse/ShaderBrowser.tsx`
- `src/components/browse/DatapackBrowser.tsx`

### Modified Files
- `src/pages/Browse.tsx` - Global instance selector, compatibility system, ref guard
- `src/components/browse/ModBrowser.tsx` - Accept selectedInstance prop, use cache
- `src/components/browse/CapeSelector.tsx` - Complete redesign
- `src/components/layout/Sidebar.tsx` - Account change listener
- `src/pages/Skins.tsx` - Refresh button, preview mode
- `src/pages/Settings.tsx` - What's New section
- `src/pages/Changelog.tsx` - New changelog entries
- `src-tauri/src/auth/commands.rs` - Account event emission
- `src-tauri/src/skins/optifine.rs` - HTTPS URL fix
- `src/i18n/locales/*.json` - New translation keys
- `src/stores/browseCacheStore.ts` - New cache store
- `src/hooks/useBrowseCache.ts` - New cache hook with stable selectors

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.6.4...v0.6.5
