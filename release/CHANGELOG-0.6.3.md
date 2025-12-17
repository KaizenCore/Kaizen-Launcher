# Kaizen Launcher v0.6.3

**Release Date:** December 17, 2025

## Summary

This release brings a complete redesign of the mods list with infinite scroll and new display options, plus a powerful mod sync feature to identify mods from imported modpacks on Modrinth. Also includes critical fixes for settings persistence.

## New Features

### Mods List Refactor

Complete redesign of the mods tab in instance details:

- **Infinite Scroll**: Replaces pagination for smoother browsing with lazy loading
- **View Modes**: Switch between List and Grid layouts
- **Sorting Options**: Name (A-Z, Z-A), Enabled first, Disabled first, Updates first
- **Filter Options**: All, Enabled only, Disabled only, With updates
- **Improved Performance**: Uses IntersectionObserver for efficient rendering

### Mod Sync from Modrinth

Identify and restore mod metadata for imported modpacks where mods may lack icons and descriptions:

- **Multi-technique Identification**:
  - SHA-512 hash lookup (primary, most accurate)
  - SHA-1 hash lookup (fallback)
  - Filename parsing + Modrinth search with similarity scoring
- **Smart Matching**: Similarity algorithm combines name matching, version compatibility, and popularity
- **Progress Indicator**: Real-time progress during sync operation
- **Batch Operations**: Efficient batch hash lookups for large modpacks

Click the "Sync Mods" button next to "Check Updates" to identify mods on Modrinth.

## Bug Fixes

### Schematics Copy to Instance

Fixed "missing required key instanceIds" error when copying schematics to instances from the library. The frontend was passing the wrong parameter name to the backend command.

### Settings Persistence Fix

Fixed appearance settings not persisting after app restart:

- **Language**: Selected language no longer resets to English on every app restart
- **Theme**: Light/Dark/System theme preference now correctly saved
- **Custom Colors**: Custom theme colors and presets persist across sessions

**Root Cause**: The Tauri webview's localStorage was not persistent between app sessions on some systems.

**Solution**: Migrated all appearance settings from browser localStorage (Zustand persist middleware) to the SQLite database via Tauri backend commands.

## Technical Changes

### Backend (Rust)

- New `sync_mods_metadata` Tauri command with comprehensive mod identification
- Added `get_versions_by_hashes` method to Modrinth client for batch hash lookups
- Progress events via `mod-sync-progress` Tauri event
- Helper functions: `parse_mod_filename`, `calculate_similarity`, `find_best_match`
- Added `get_appearance_settings`, `save_appearance_setting`, and `save_custom_theme_settings` commands
- All settings stored in the existing `settings` SQLite table with `appearance_` prefix

### Frontend (TypeScript)

- New `ModsList.tsx` component with IntersectionObserver-based infinite scroll
- View mode, sort, and filter state management
- Sync progress display with real-time updates
- Modified `customThemeStore.ts` to use backend storage instead of Zustand persist
- Modified `ThemeProvider.tsx` to load/save theme via Tauri invoke
- Modified `i18n/index.ts` to use backend storage for locale preference

## Files Changed

- `src/components/instances/ModsList.tsx` - New mods list component
- `src-tauri/src/modrinth/mod.rs` - Batch hash lookup methods
- `src-tauri/src/modrinth/commands.rs` - Sync mods metadata command
- `src-tauri/src/lib.rs` - Command registration
- `src-tauri/src/db/settings.rs` - Appearance settings commands
- `src/pages/InstanceDetails.tsx` - Integration of ModsList component
- `src/pages/Schematics.tsx` - Fixed instanceIds parameter for copy command
- `src/stores/customThemeStore.ts` - Backend storage migration
- `src/components/layout/ThemeProvider.tsx` - Backend storage migration
- `src/i18n/index.ts` - Backend storage migration
- `src/i18n/locales/*.json` - New translation keys for mod sync and schematics fix

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.6.2...v0.6.3
