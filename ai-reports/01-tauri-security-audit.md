# Tauri Security & Optimization Audit Report

**Date:** 2024-12-12
**Auditor:** Claude (tauri-expert agent)
**Scope:** Tauri configuration, IPC security, capabilities, CSP

---

## Executive Summary

The Kaizen Launcher Tauri 2.x application demonstrates **good security practices** overall, including encrypted token storage, proper CSP configuration, and path validation. However, several areas require attention.

---

## Security Findings

### 1. Decrypted Tokens Returned to Frontend

| Severity | HIGH |
|----------|------|
| Location | `src-tauri/src/auth/commands.rs:21-48, 52-72, 180-193, 299-312` |

**Description:** The `get_accounts`, `get_active_account`, `login_microsoft_complete`, and `refresh_account_token` commands decrypt sensitive access and refresh tokens and return them directly to the frontend via IPC.

```rust
// Tokens are decrypted and sent to frontend
let decrypted_accounts: Vec<Account> = accounts
    .into_iter()
    .map(|mut account| {
        if crypto::is_encrypted(&account.access_token) {
            if let Ok(decrypted) = crypto::decrypt(&state.encryption_key, &account.access_token) {
                account.access_token = decrypted;
            }
        }
        // ...
    })
    .collect();
Ok(decrypted_accounts)
```

**Risk:** If the frontend is compromised via XSS, tokens become accessible to attackers.

**Recommendation:** Consider keeping tokens server-side and having the backend make authenticated requests on behalf of the frontend.

---

### 2. Encryption Key Stored in Plain Text File

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/crypto.rs:11-50` |

**Description:** The encryption key is stored as a hex-encoded file (`.encryption_key`) in the data directory. While Unix permissions are set to 0o600, this offers limited protection.

**Risk:** Any process running as the same user can read this file.

**Recommendation:** Consider using OS-native secure storage:
- macOS: Keychain
- Windows: Credential Manager / DPAPI
- Linux: Secret Service API (libsecret)

---

### 3. Microsoft OAuth Client ID Hardcoded

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/auth/microsoft.rs:6` |

**Description:** The Microsoft Azure OAuth Client ID is hardcoded:
```rust
const CLIENT_ID: &str = "46e2883f-6711-4c42-b5fd-763e7e6930f0";
```

**Assessment:** Acceptable for public native app OAuth flows using device code flow. Other credentials (Google/Dropbox) correctly use `option_env!`.

---

### 4. Tunnel Secrets Not Encrypted in Database

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/tunnel/commands.rs:88-115` |

**Description:** `playit_secret_key` and `ngrok_authtoken` are stored in plain text in the database.

**Recommendation:** Encrypt using the same pattern as cloud storage tokens.

---

### 5. Sharing Server Security Concerns

| Severity | MEDIUM |
|----------|--------|
| Location | `src-tauri/src/sharing/server.rs` |

**Issues:**
1. Auth tokens logged at info level (line 964)
2. No rate limiting against brute-force attacks
3. No connection timeout

**Recommendation:** Remove token logging, implement rate limiting, add timeouts.

---

### 6. File System Plugin Permissions Too Broad

| Severity | LOW |
|----------|-----|
| Location | `src-tauri/capabilities/default.json:17-19` |

**Description:** Capabilities grant recursive read access to appdata:
```json
"fs:allow-appdata-read-recursive",
"fs:scope-appdata-recursive"
```

**Recommendation:** Consider scoping to specific subdirectories.

---

### 7. No Command-Level Authentication

| Severity | LOW |
|----------|-----|
| Location | Multiple command files |

**Description:** All Tauri commands are accessible to the webview context regardless of user authentication state.

**Risk:** If XSS is achieved, an attacker could invoke any command including `delete_account`, `delete_instance`, etc.

---

### 8. Instance Icon Download - SSRF Risk

| Severity | LOW |
|----------|-----|
| Location | `src-tauri/src/instance/commands.rs:1306-1352` |

**Description:** `update_instance_icon` downloads files from user-provided URLs without blocking private IP ranges.

**Recommendation:** Implement URL validation to block private IP ranges and localhost.

---

### 9. CSP Missing Some Hardening

| Severity | LOW |
|----------|-----|
| Location | `src-tauri/tauri.conf.json:27` |

**Description:** `style-src 'self' 'unsafe-inline'` - unsafe-inline is present.

**Recommendation:** If possible, remove `'unsafe-inline'` and use nonces/hashes.

---

## Positive Security Practices Observed

1. Token Encryption at Rest (AES-256-GCM)
2. Unix File Permissions (0o600 for key file)
3. Path Validation in config file operations
4. CSP Properly configured with restricted sources
5. Tauri 2.x Capability System in use
6. Constant-Time Token Comparison for sharing
7. Password Hashing (SHA-256 with salt)
8. Windows Console Hidden in process creation
9. Error types don't leak sensitive internal details

---

## Optimization Findings

### HTTP Client User-Agent Outdated

| Impact | TRIVIAL |
|--------|---------|
| Location | `src-tauri/src/state.rs:88-89` |

**Description:** User agent hardcoded to version 0.1.0, current version is 0.5.4.

---

## Summary Table

| Issue | Severity | Status |
|-------|----------|--------|
| Tokens returned to frontend | HIGH | Needs Review |
| Encryption key in file | MEDIUM | Consider OS Keychain |
| Tunnel secrets unencrypted | MEDIUM | Needs Fix |
| Sharing server improvements | MEDIUM | Needs Review |
| Microsoft Client ID hardcoded | MEDIUM | Acceptable |
| FS permissions broad | LOW | Consider scoping |
| No command auth layer | LOW | Consider for sensitive ops |
| SSRF in icon download | LOW | Add URL validation |
| CSP unsafe-inline | LOW | Consider removal |

---

## Recommended Priority Order

1. Encrypt tunnel secrets (same pattern as cloud storage)
2. Sharing server hardening (remove token logging, add rate limiting)
3. Reconsider token handling architecture
4. Add URL validation for icon downloads
5. Consider OS-native key storage migration
