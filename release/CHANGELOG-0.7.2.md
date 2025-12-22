# Kaizen Launcher v0.7.2

**Release Date:** December 22, 2025

## Summary

Major Forge modloader support release. This version adds complete Forge installation support for Minecraft 1.18+ and fixes the critical launch issue that was preventing Forge instances from starting.

## New Features

### Forge Modloader Installation
Complete Forge support for Minecraft 1.18+:
- **Headless Installer** - New `forge_processor.rs` module runs Forge installer without GUI
- **Patched Client** - Properly copies `forge-{version}-client.jar` to instance
- **Library Installation** - All Forge libraries including processor artifacts installed correctly
- **Module System** - Java module system configured for BootstrapLauncher compatibility

## Bug Fixes

### Forge Launch Target Fix (Critical)
Fixed `Missing LaunchHandler forgeclient` error when launching Forge:
- **Root Cause** - The `--launchTarget` argument was using `forgeclient` instead of `forge_client`
- **The Fix** - Changed to `forge_client` (with underscore) to match Forge's version.json
- **Impact** - This was the root cause of all Forge 1.18+ launch failures

## Improvements

### Forge Bootstrap Cleanup
Added bootstrap version conflict resolution:
- **Version Detection** - Detects when multiple bootstrap versions exist in libraries folder
- **Automatic Cleanup** - Keeps only the highest version to prevent module conflicts
- **Background** - Forge installer may download processor libraries that conflict with runtime libraries

### Enhanced Forge Logging
Comprehensive logging for troubleshooting:
- **Structured Logs** - Uses `tracing::info!` and `tracing::debug!` throughout
- **Installation Tracking** - Track installer progress, library copies, and bootstrap operations
- **Easy Debugging** - Logs available in `{data_dir}/logs/kaizen.log`

## Technical Changes

### New Files

**Backend:**
- `src-tauri/src/modloader/forge_processor.rs` - Forge installer processor module
  - `run_processors()` - Main function to run Forge installer headlessly
  - `copy_directory_contents()` - Recursive directory copy with overwrite
  - Bootstrap version cleanup logic

### Modified Files

**Backend:**
- `src-tauri/src/launcher/runner.rs`
  - Line 154: Changed `forgeclient` to `forge_client` for `--launchTarget` argument
- `src-tauri/src/modloader/installer.rs`
  - Added `forge_version` parameter to `run_processors` call
- `src-tauri/src/modloader/mod.rs`
  - Added `pub mod forge_processor;` export

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.7.1...v0.7.2
