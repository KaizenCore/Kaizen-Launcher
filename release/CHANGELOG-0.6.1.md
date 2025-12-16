# Kaizen Launcher v0.6.1

## Release Notes

This is a maintenance release focusing on bug fixes and code quality improvements.

## Fixed

### Forge 1.18+ Launch Fix
Fixed the `Missing required option(s) [fml.mcpVersion]` error when launching Forge modpacks (1.18+). This was caused by incorrect FML arguments being passed to the Forge BootstrapLauncher.

**What was wrong:**
- The launcher was using `--fml.neoFormVersion` for Forge (this is only for NeoForge)
- The `--fml.forgeGroup` argument was missing
- MCP version wasn't being extracted and saved during installation

**The fix:**
- Changed to use `--fml.mcpVersion` for Forge instances
- Added `--fml.forgeGroup=net.minecraftforge` argument
- MCP version is now extracted from `install_profile.json` and saved to `forge_meta.json`

**Note:** Users with existing Forge instances may need to reinstall them, or manually create a `forge_meta.json` file in the instance directory with the correct `mcp_version`.

### Schematics Instance List Truncation
Instance names in the "By Instance" view now properly truncate with ellipsis when too long, preventing layout overflow and improving the user experience.

### Rust Compiler Warnings
Fixed 22 compiler warnings across the Rust codebase:
- Removed unused imports (`std::os::windows::process::CommandExt`) in 7 files
- Prefixed intentionally unused variables with underscore
- Added `#[allow(dead_code)]` for future-use functions in schematics module

## Technical Changes

### Files Modified
- `src-tauri/src/launcher/runner.rs` - Fixed Forge FML arguments, added `read_mcp_version()`, fixed `bore_servers` field
- `src-tauri/src/modloader/installer.rs` - Added `extract_forge_mcp_version()`, save `forge_meta.json`
- `src/pages/Schematics.tsx` - Fixed CSS truncation with `w-0 flex-1` pattern
- `src-tauri/src/launcher/commands.rs` - Removed unused imports
- `src-tauri/src/modloader/neoforge_processor.rs` - Removed unused imports
- `src-tauri/src/sharing/server.rs` - Removed unused imports
- `src-tauri/src/tunnel/*.rs` - Removed unused imports (bore, cloudflare, ngrok, playit)
- `src-tauri/src/tunnel/agent.rs` - Prefixed unused variables
- `src-tauri/src/modrinth/mod.rs` - Added dead_code allow
- `src-tauri/src/schematics/*.rs` - Added dead_code allows for future-use functions

## Upgrading

This is a drop-in replacement for v0.6.0. For Forge instances that fail to launch, reinstall the instance or the modpack.

## Full Changelog

See [CHANGELOG.md](../CHANGELOG.md) for the complete changelog.
