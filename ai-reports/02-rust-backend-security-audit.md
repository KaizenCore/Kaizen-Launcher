# Rust Backend Security & Optimization Audit Report

**Date:** 2024-12-12
**Auditor:** Claude (rust-minecraft-backend agent)
**Scope:** Rust backend code, database operations, authentication, file handling

---

## Executive Summary

The codebase demonstrates **good security practices** including:
- Parameterized SQL queries (no SQL injection risk)
- Proper AES-256-GCM encryption for token storage
- Hash verification on downloads
- Path traversal protection in the import module
- No command injection in game launcher (proper argument separation)

---

## Security Findings

### 1. Path Traversal in open_instance_folder

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/instance/commands.rs:851-853` |

**Description:** The `subfolder` parameter can contain `../../../` to escape the instance directory.

```rust
if let Some(ref sub) = subfolder {
    target_dir = target_dir.join(sub);  // No validation!
}
```

**Risk:** A malicious frontend could open arbitrary directories on the system.

**Recommended Fix:**
```rust
if let Some(ref sub) = subfolder {
    let new_target = target_dir.join(sub);
    let canonical = new_target.canonicalize()
        .map_err(|_| AppError::Instance("Invalid subfolder".to_string()))?;
    if !canonical.starts_with(&target_dir) {
        return Err(AppError::Instance("Invalid subfolder path".to_string()));
    }
    target_dir = canonical;
}
```

---

### 2. Missing Download URL Domain Validation

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/modrinth/mod.rs:341` |

**Description:** Download URLs from Modrinth API are used without validation.

**Risk:** If Modrinth API is compromised or returns unexpected data, could download from malicious sources.

**Recommended Fix:**
```rust
const ALLOWED_DOWNLOAD_DOMAINS: &[&str] = &[
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "mediafilez.forgecdn.net",
];

fn validate_download_url(url: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|_| AppError::Download("Invalid URL".to_string()))?;
    let host = parsed.host_str()
        .ok_or_else(|| AppError::Download("No host in URL".to_string()))?;
    if !ALLOWED_DOWNLOAD_DOMAINS.iter().any(|d| host.ends_with(d)) {
        return Err(AppError::Download(format!("Untrusted download domain: {}", host)));
    }
    Ok(())
}
```

---

### 3. Unsafe unwrap() After None Checks

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/discord/hooks.rs:41,70,106,145,181` |

**Description:** Multiple `unwrap()` calls that could panic if logic changes.

**Recommended Fix:** Replace with proper error handling using `?` or `ok_or_else()`.

---

### 4. Poisoned Mutex unwrap

| Severity | LOW |
|----------|-----|
| Location | `src-tauri/src/devtools/mod.rs:37` |

**Description:** Mutex lock unwrap could panic if another thread panicked while holding the lock.

```rust
let mut sys = SYSTEM.lock().unwrap();  // Could panic
```

**Recommended Fix:**
```rust
let mut sys = SYSTEM.lock().map_err(|_| AppError::Internal("System lock poisoned".to_string()))?;
```

---

### 5. Missing Input Length Validation

| Severity | LOW |
|----------|-----|
| Location | `src-tauri/src/instance/commands.rs:164` |

**Description:** Instance names are not validated for length.

**Recommendation:** Add maximum length validation (e.g., 64 characters) to prevent database/filesystem issues.

---

### 6. External tar Command for Extraction

| Severity | LOW |
|----------|-----|
| Location | `src-tauri/src/tunnel/agent.rs:327` |

**Description:** Uses external `tar` command for extraction.

**Recommendation:** Consider using `tar` crate for better control and cross-platform consistency.

---

## Optimization Findings

### 1. N+1 API Queries for Mod Updates

| Impact | MEDIUM |
|--------|--------|
| Location | `src-tauri/src/modrinth/commands.rs:1376-1425` |

**Description:** When checking for mod updates, each mod triggers a separate API call.

**Recommendation:** Use Modrinth's bulk version lookup API to check multiple mods in a single request.

---

### 2. Slow Recursive Async Directory Walking

| Impact | MEDIUM |
|--------|--------|
| Location | `src-tauri/src/instance/commands.rs:1603-1621` |

**Description:** Directory size calculation uses recursive async walking which is slow.

**Recommendation:** Use `walkdir` crate in `spawn_blocking` for better performance:
```rust
let size = tokio::task::spawn_blocking(move || {
    walkdir::WalkDir::new(&path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum::<u64>()
}).await?;
```

---

### 3. Blocking IO in Async Context

| Impact | LOW |
|--------|-----|
| Location | `src-tauri/src/devtools/mod.rs:37` |

**Description:** `sysinfo` operations are synchronous and block the async runtime.

**Recommendation:** Wrap in `spawn_blocking`.

---

### 4. Missing HTTP Client Timeouts

| Impact | LOW |
|--------|-----|
| Location | `src-tauri/src/state.rs` |

**Description:** HTTP client doesn't have explicit timeouts configured.

**Recommendation:**
```rust
let http_client = reqwest::Client::builder()
    .user_agent("KaizenLauncher/0.5.4")
    .timeout(Duration::from_secs(30))
    .connect_timeout(Duration::from_secs(10))
    .build()?;
```

---

## Positive Security Practices

| Practice | Status |
|----------|--------|
| Parameterized SQL queries (sqlx) | OK |
| AES-256-GCM encryption for tokens | OK |
| SHA1/SHA256 hash verification on downloads | OK |
| Path traversal prevention in import module | OK |
| No command injection (proper Command args) | OK |
| Parallel downloads properly concurrent | OK |
| Proper error types without info leaks | OK |

---

## Summary Table

| Issue | Severity | Category |
|-------|----------|----------|
| Path traversal in open_instance_folder | MEDIUM | Security |
| Missing download URL validation | MEDIUM | Security |
| Unsafe unwrap() calls | MEDIUM | Stability |
| Poisoned mutex unwrap | LOW | Stability |
| Missing input length validation | LOW | Security |
| External tar command | LOW | Security |
| N+1 API queries for mods | MEDIUM | Performance |
| Slow directory walking | MEDIUM | Performance |
| Blocking IO in async | LOW | Performance |
| Missing HTTP timeouts | LOW | Reliability |

---

## Recommended Priority for Fixes

1. **Add URL domain validation for downloads** (security)
2. **Fix path traversal in open_instance_folder** (security)
3. **Replace unwrap() calls with proper error handling** (stability)
4. **Implement bulk API calls for mod updates** (performance)
5. **Optimize directory size calculations** (performance)
