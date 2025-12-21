# Kaizen Launcher v0.7.1

**Release Date:** December 21, 2025

## Summary

Performance and stability improvements with a new caching system for the Skin Viewer and bug fixes for the Playground feature.

## New Features

### Skin Viewer Cache
New `skinStore` with intelligent caching for faster page loads:
- **5-Minute Cache** - Skin profiles and favorites cached for instant page loads when returning to Skins
- **Smart Invalidation** - Cache automatically clears when account changes
- **Force Refresh** - Automatic refresh after skin uploads/applies to show new data
- **Optimistic UI** - Favorites update instantly without waiting for backend confirmation

## Bug Fixes

### Playground Panel Error Fix
Fixed "Group not found" error when navigating away and back to Playground:
- **Try-Catch Protection** - Panel expand/collapse operations now wrapped in try-catch
- **Stale Ref Handling** - Gracefully handles panel refs that become invalid during component remounting
- **No More Crashes** - Prevents React error boundary from triggering on navigation

### Console Log Cleanup
Removed excessive "[App] Kaizen Launcher initializing..." logs:
- **Removed from Body** - Log was in component body, causing spam on every re-render
- **Cleaner Output** - Console is now cleaner for debugging actual issues

## Technical Changes

### New Files

**Frontend:**
- `src/stores/skinStore.ts` - Zustand store for skin profile and favorites caching
  - `loadProfile(forceRefresh?)` - Loads profile with optional cache bypass
  - `loadFavorites(forceRefresh?)` - Loads favorites with optional cache bypass
  - `addFavorite()` / `removeFavorite()` - Optimistic updates for favorites
  - 5-minute cache duration with automatic invalidation

### Modified Files

**Frontend:**
- `src/pages/Skins.tsx`
  - Migrated to use `skinStore` for profile and favorites state
  - Removed local `loadProfile()` and `loadFavorites()` functions
  - Added type annotations for store compatibility
- `src/components/playground/PlaygroundLayout.tsx`
  - Added try-catch blocks around `panel.collapse()` and `panel.expand()` calls
  - Catches "Group not found" error when panel refs are stale
- `src/App.tsx`
  - Removed `console.log("[App] Kaizen Launcher initializing...")` from component body

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.7.0...v0.7.1
