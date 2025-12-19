# Kaizen Launcher v0.6.8

**Release Date:** December 19, 2025

## Summary

This release brings a complete visual canvas for the Playground feature (requires beta access), allowing users to visualize their modpacks as interconnected nodes. A new search function (Ctrl+K) enables quick navigation to any mod, and the integrated Monaco code editor provides professional-grade config file editing with syntax highlighting.

## New Features

### Playground Visual Canvas (Beta Access Required)
Complete visual workspace for modpack and server management:
- **Node-based Display** - Instance and mods shown as interconnected nodes with dependency edges
- **React Flow Canvas** - Pan, zoom, and drag support for exploring your mod setup
- **MiniMap & Controls** - Navigation aids for large modpacks
- **Dynamic Grid Layout** - Automatically adapts from 4 to 10 columns based on mod count
- **Dependency Edges** - Visual lines connecting mods to their dependencies (green for required, yellow for optional)

### Node Search (Ctrl+K)
Quick search dialog to find mods and focus on them:
- **Keyboard Shortcut** - Press Ctrl+K (or Cmd+K on Mac) to open search
- **Arrow Navigation** - Use up/down arrows to browse results
- **Instant Focus** - Press Enter to center the canvas on the selected node with smooth animation
- **Search Scope** - Find mods by name or focus on the instance node

### Monaco Code Editor
Professional code editor for mod configuration files:
- **Syntax Highlighting** - Full support for TOML, JSON, YAML, and properties files
- **Custom Themes** - kaizen-dark and kaizen-light themes that match your app theme
- **TOML Support** - Custom language registration for proper TOML highlighting
- **Line Numbers** - Clear line reference for config editing

## Bug Fixes

### NeoForge 1.20.1 Support
Fixed NeoForge not showing versions for Minecraft 1.20.1:
- **Legacy API Support** - Added support for the legacy NeoForge API (`net/neoforged/forge`)
- **Different Repository** - 1.20.1 versions use `net/neoforged/forge` (Forge fork), 1.20.2+ uses `net/neoforged/neoforge`
- **Version Format** - Legacy versions are `1.20.1-47.1.X`, modern versions are `20.X.Y`
- **Installer URLs** - Correctly generates installer URLs for both legacy and modern versions
- **Cache Clear** - If you still don't see 1.20.1 versions, clear the API cache in `%APPDATA%/com.kaizen.launcher/cache/api/`

## Changes

### Compact Playground Console
Redesigned console optimized for sidebar display:
- **Minimal Toolbar** - Line count, pause/resume, and clear buttons in 24px height
- **Smaller Font** - 10px monospace font for maximum content visibility
- **Color Code Support** - ANSI escape sequences and Minecraft color codes (§) rendered correctly
- **Server Commands** - Input field for sending commands to running servers

### Auto-open Config Files
Improved workflow for mod configuration:
- **Instant Loading** - First config file opens automatically when selecting a mod
- **Smart Filtering** - Only shows config files relevant to the selected mod
- **No Extra Clicks** - Eliminates the need to manually select a config file

### Resizable Right Panel
Flexible panel sizing for your workflow:
- **Drag to Resize** - Grab the left edge to adjust panel width
- **Width Range** - 280px minimum to 600px maximum
- **Visual Feedback** - Grip handle appears on hover for intuitive interaction

### Toolbar Layout
Converted sidebar to compact horizontal toolbar:
- **Instance Selector** - Dropdown in the header for quick instance switching
- **Status Badges** - Running/stopped indicator, mod count, version info
- **Quick Actions** - Refresh, open folder, and dependency toggle buttons
- **Edge-to-Edge** - Full-width layout using negative margins

## Technical Changes

### New Files

**Frontend:**
- `src/components/playground/PlaygroundConsole.tsx` - Compact console component
  - ANSI and Minecraft color code parsing
  - Pause/resume log streaming
  - Server command input with stdin injection
- `src/components/playground/PlaygroundSearch.tsx` - Search dialog
  - Keyboard navigation (arrows, Enter, Escape)
  - Fuzzy matching on mod names
  - Focus animation with React Flow's setCenter
- `src/components/ui/code-editor.tsx` - Monaco Editor wrapper
  - Custom theme definitions matching app colors
  - TOML language registration
  - Theme switching based on resolved theme

### Modified Files

- `src/stores/playgroundStore.ts`
  - Added `isSearchOpen` state for search dialog visibility
  - Added `focusNodeId` state for triggering focus animation
  - Added `setSearchOpen()`, `focusNode()`, `clearFocusNode()` actions
- `src/components/playground/PlaygroundCanvas.tsx`
  - Wrapped with `ReactFlowProvider` for `useReactFlow` hook access
  - Added focus effect using `setCenter()` with animation
- `src/components/playground/PlaygroundContextPanel.tsx`
  - Auto-load first config file when mod is selected
  - Resizable panel with mouse drag handling
  - Integrated PlaygroundConsole instead of lazy-loaded InstanceConsole
- `src/pages/Playground.tsx`
  - Added Ctrl+K keyboard shortcut listener
  - Integrated PlaygroundSearch component

### Translations
New keys added to all locales (en, fr, de, nl):
- `playground.searchNodes` - Search dialog title
- `playground.searchPlaceholder` - Search input placeholder
- `playground.instance` - Instance type label
- `playground.mod` - Mod type label
- `playground.noResults` - No search results message
- `playground.navigate` - Navigation hint
- `playground.select` - Selection hint
- `playground.close` - Close hint

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.6.7...v0.6.8
