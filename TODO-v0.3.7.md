# TODO v0.3.7 - Fixes & Security Improvements

## Summary
- **Rust warnings**: 38 (Windows) / 23 (macOS)
- **ESLint errors**: 2
- **ESLint warnings**: 21
- **Known bugs**: 2

---

## RUST - Dead Code (Remove or Implement)

### Cloud Storage Module (`src-tauri/src/cloud_storage/`)
- [ ] `db.rs`: Remove or use `update_google_tokens()`
- [ ] `db.rs`: Remove or use `update_dropbox_tokens()`
- [ ] `db.rs`: Remove or use `update_sync_status()`
- [ ] `google_drive.rs`: Remove or use `refresh_token()`
- [ ] `google_drive.rs`: Remove or use `delete_file()`
- [ ] `google_drive.rs`: Remove or use `download_file()`
- [ ] `google_drive.rs`: Remove unused field `mime_type` from struct
- [ ] `dropbox.rs`: Remove or use `refresh_token()`
- [ ] `dropbox.rs`: Remove or use `delete_file()`
- [ ] `webdav.rs`: Remove or use `delete_file()`
- [ ] `webdav.rs`: Remove or use `download_file()`
- [ ] `s3.rs`: Remove or use `delete_file()`
- [ ] `s3.rs`: Remove or use `download_file()`
- [ ] `mod.rs`: Remove or use `DeviceAuthResponse` struct
- [ ] `mod.rs`: Remove or use `TokenErrorResponse` struct

### Discord Module (`src-tauri/src/discord/`)
- [ ] `hooks.rs`: Remove or use `on_backup_created()`
- [ ] `hooks.rs`: Remove or use `set_hosting_activity()`
- [ ] `rpc.rs`: Remove or use `disconnect()`
- [ ] `rpc.rs`: Remove or use `clear_activity()`
- [ ] `rpc.rs` (Windows): Remove or use `DISCORD_APP_ID` constant
- [ ] `rpc.rs` (Windows): Remove or use `RpcPayload` struct

---

## RUST - Unused Imports & Variables

### Unused Imports
- [ ] Remove `CloudBackupSync` and `db` imports (location TBD)
- [ ] Remove `Read` and `Write` imports (Windows only)
- [ ] Remove 8x `std::os::windows::process::CommandExt` imports (Windows only, in runner/modloader files)

### Unused Variables
- [ ] Fix unused `client` variable
- [ ] Fix unused `base_path` variable
- [ ] Fix unused `file` variable (Windows)
- [ ] Fix unused `archive_path` variable (Windows)
- [ ] Fix unused `dest_dir` variable (Windows)
- [ ] Fix `unused_mut` warning - remove unnecessary mutable

### Unreachable Code
- [ ] Fix unreachable expression warning (Windows)

---

## RUST - Deprecation & Security

### Deprecated APIs
- [ ] Replace `libc::mach_task_self` with `mach2` crate (macOS)

### Security Improvements
- [ ] Implement Windows Discord RPC (currently stubbed - returns error)
- [ ] Review and sanitize user inputs in commands
- [ ] Audit token storage encryption

---

## RUST - Known Bugs

### Critical
- [ ] **bore.rs:140** - Panic: "Cannot block the current thread from within a runtime"
  - Happens when tunnel auto-starts after server launch
  - Need to spawn blocking in separate task

### Non-Critical
- [ ] Tauri event listener cleanup issue (JS error: `listeners[eventId].handlerId`)
  - Need to investigate frontend event handling

---

## FRONTEND - ESLint Errors (Must Fix)

- [ ] `DiscordConfig.tsx:136` - Remove unused `error` variable in testRpc
- [ ] `DiscordConfig.tsx:155` - Remove unused `error` variable in testWebhook

---

## FRONTEND - ESLint Warnings (Should Fix)

### Missing Dependencies in useEffect/useCallback
- [ ] `CloudStorageConfig.tsx:260` - Add `saveConfig` to deps
- [ ] `ConfigEditor.tsx:911` - Add `t` to deps
- [ ] `ModpackBrowser.tsx:198` - Add missing deps or refactor
- [ ] `WorldsTab.tsx:156` - Add `loadCloudConfig` to deps
- [ ] `Onboarding.tsx:149` - Add `fetchVersions` and `versions.length` to deps
- [ ] `Onboarding.tsx:159` - Add `fetchLoaderVersions` to deps
- [ ] `Accounts.tsx:48` - Add `loadAccounts` to deps
- [ ] `Home.tsx:232` - Add `t` to deps
- [ ] `Instances.tsx:718` - Add `loadInstances` to deps
- [ ] `Settings.tsx:143` - Add `t` to deps
- [ ] `Settings.tsx:162` - Add `t` to deps

### Unnecessary Dependencies
- [ ] `ModrinthBrowser.tsx:481` - Remove `ITEMS_PER_PAGE` from deps
- [ ] `Instances.tsx:876` - Remove `installations` from deps

### Console Statements (Replace with proper logging)
- [ ] `TunnelConfig.tsx:155` - Remove/replace console.log
- [ ] `TunnelConfig.tsx:161` - Remove/replace console.log
- [ ] `TunnelConfig.tsx:166` - Remove/replace console.log
- [ ] `InstanceDetails.tsx:739` - Remove/replace console.log
- [ ] `InstanceDetails.tsx:741` - Remove/replace console.log
- [ ] `InstanceDetails.tsx:744` - Remove/replace console.log
- [ ] `InstanceDetails.tsx:809` - Remove/replace console.log

### Ref Cleanup Issue
- [ ] `AddAccountDialog.tsx:52` - Copy `timeoutRefs.current` to variable in effect

---

## FEATURE COMPLETENESS (from v0.3.6 review)

### Discord Module
- [ ] Implement per-instance webhook config (DB ready, hooks don't use it)
- [ ] Use `rpc_show_playtime` setting (toggle exists but is ignored)
- [ ] Implement `set_hosting_activity()` call in server launch
- [ ] Implement player count in hosting activity

---

## CLEANUP

### Debug Logging
- [ ] Replace `eprintln!()` with proper tracing/logging in `discord/hooks.rs`
- [ ] Remove debug `[DISCORD]` prefix logs or make them configurable

### Code Quality
- [ ] Run `cargo fix --lib -p kaizen-launcher` to auto-fix some warnings
- [ ] Run `cargo clippy` for additional lints
- [ ] Consider enabling `#![deny(warnings)]` in CI

---

## Priority Order

1. **HIGH** - ESLint errors (2) - Blocks lint CI
2. **HIGH** - bore.rs panic - Affects tunnel stability
3. **MEDIUM** - Unused code removal - Reduces binary size
4. **MEDIUM** - useEffect deps - Prevents React bugs
5. **LOW** - Console statements - Code cleanliness
6. **LOW** - Windows-only warnings - Platform specific

---

## Commands

```bash
# Run Rust checks
cd src-tauri && cargo check 2>&1 | grep -E "warning:|error"
cargo clippy 2>&1 | grep -E "warning:|error"
cargo fix --lib -p kaizen-launcher

# Run Frontend checks
npm run lint
npm run lint:fix  # Auto-fix some issues
npm run type-check
```
