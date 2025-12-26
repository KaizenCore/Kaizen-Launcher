# Kaizen Launcher v0.7.4

**Release Date:** December 26, 2025

## Highlights

- 📦 **External Launcher Import** - Import instances from Modrinth App, CurseForge, Prism, MultiMC
- 🗄️ **SQLite Database Parsing** - Read Modrinth App profile metadata directly
- 🔄 **Smart File Handling** - Automatic retry for locked files on Windows
- ✨ **Modern Import UI** - Launcher cards with colored badges and batch selection

---

## Added

### External Launcher Import
Complete system for importing Minecraft instances from other launchers:
- **Supported Launchers**: Modrinth App, CurseForge, Prism Launcher, MultiMC, Minecraft Official Launcher
- **4-Step Wizard**: Detection → Selection → Options → Progress
- **Auto-Detection**: Scans default installation paths on Windows, macOS, and Linux
- **Content Selection**: Choose what to import (mods, configs, resource packs, shader packs, worlds)

### Modrinth App SQLite Parsing
Direct database access for accurate profile metadata:
- Reads `app.db` SQLite database from Modrinth App data folder
- Extracts game version, mod loader type, and loader version
- Correctly identifies Fabric, NeoForge, Forge, and Quilt profiles
- Falls back to folder structure inference if database is unavailable

### Modpack File Support
Import modpack files directly:
- **Modrinth (.mrpack)**: Extracts `modrinth.index.json` for dependencies
- **CurseForge (.zip)**: Parses manifest.json for mod list
- Handles `overrides/` folders for configs and resources
- Extracts Minecraft version and loader requirements from manifests

### Content Preview
Detailed preview before importing:
- Shows mod count, config files, resource packs, shader packs, and worlds
- Displays estimated size for each content type
- Individual world selection for partial imports
- Re-download from Modrinth option for mods with known hashes

---

## Improved

### Smart File Copy with Retry
Better handling of file locking issues on Windows:
- Automatic retry for Windows error 32 (file in use) and 33 (process cannot access)
- Retries up to 3 times with increasing delays (100ms, 200ms, 300ms)
- Fallback to manual read/write if direct copy fails
- Clear error messages suggesting to close the source launcher

### Import UI Redesign
Modern card-based interface for the import wizard:
- Expandable launcher cards showing instance list
- Select all / Deselect all buttons per launcher
- Colored badges for mod loaders:
  - Fabric: Amber
  - Forge: Blue
  - NeoForge: Orange
  - Quilt: Purple
- Mod count and last played date display
- Visual selection indicator with checkboxes

---

## Technical Changes

### Backend (Rust)

New module structure for external imports:
```
src-tauri/src/external_import/
├── mod.rs              # Types, traits, exports
├── commands.rs         # Tauri commands
├── detection.rs        # Launcher path detection
├── importer.rs         # Copy and import logic
├── mod_resolver.rs     # Modrinth hash lookup
└── parsers/
    ├── mod.rs          # LauncherParser trait
    ├── minecraft.rs    # Official launcher parser
    ├── modrinth.rs     # Modrinth App + .mrpack parser
    ├── prism.rs        # Prism/MultiMC parser
    └── curseforge.rs   # CurseForge parser
```

Key implementations:
- `LauncherParser` trait with `detect()`, `parse_instances()`, `scan_mods()` methods
- `copy_file_with_retry()` function with Windows error code handling
- SQLite connection to Modrinth's `app.db` using read-only mode
- Column mapping: `mod_loader`, `mod_loader_version`, `modified` timestamp

### Frontend (React/TypeScript)

New components in `src/components/import/`:
- `ExternalLauncherImportDialog.tsx` - Main wizard container
- `LauncherCard` - Expandable card with instance list
- `InstanceRow` - Instance item with loader badges
- `types.ts` - TypeScript interfaces for import system

Store integration:
- New `externalImportStore.ts` for state management
- Progress tracking with `ImportProgress` events
- Launcher detection with `ParsedLauncher` type

---

## Upgrade Notes

- Modrinth App must be closed before importing to avoid file locking
- Import creates new instances - original launcher data is not modified
- Mods can optionally be re-downloaded from Modrinth for metadata enrichment
- World imports copy the entire save folder including player data
