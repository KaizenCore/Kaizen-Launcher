# Kaizen Launcher v0.6.6

**Release Date:** December 18, 2025

## Summary

This release introduces Kaizen Account OAuth integration, allowing users to connect their Kaizen accounts and display badges/permissions. Also includes a system requirements check at startup, splash screen, and backup world icons.

## New Features

### Kaizen Account OAuth Integration
Connect your Kaizen account using the OAuth Device Code flow:
- **New Accounts Section** - "Kaizen Accounts" section added below Minecraft accounts
- **Device Code Flow** - Same authentication pattern as Microsoft (enter code on website)
- **Secure Storage** - Tokens encrypted with AES-256-GCM before storing in database
- **Auto-Refresh** - Tokens automatically refresh when expired (5-minute buffer before expiration)
- **Startup Sync** - User info (tags, badges, permissions) synced from server at each app launch
- **Manual Refresh** - `refresh_kaizen_account` command available if needed

### User Badges & Permissions Display
Show your Kaizen badges and permissions in the Accounts page:
- **API Badges** - Fetched from `/api/v1/user/badges` with full styling info
- **Custom Colors** - Background, text, and border colors from API (e.g., violet for "Official Developer")
- **Patron Badge** - Crown icon with amber color for patron users
- **Permissions List** - Displayed below email with underscore-to-space formatting
- **Tags Parsing** - Tags extracted and permissions deduplicated

### System Requirements Check
New startup verification system that ensures your system is ready to run Minecraft:
- **Runs at every startup** - Silently checks for dependencies each time you launch
- **Java detection** - Checks if Java is installed (required to continue)
- **Cloudflare Tunnel** - Checks if Cloudflare tunnel agent is installed (recommended, can be skipped)
- **Smart display** - Modal only appears if something is missing
- **Persistent preferences** - If you skip Cloudflare, it won't ask again
- **Priority overlay** - Displays before onboarding (z-60)

### Splash Screen
Beautiful loading screen that appears at app startup:
- **Kaizen logo** - Displays the app logo with an animated pulse effect
- **Progress bar** - Smooth animations through loading stages
- **No more white flash** - Hides the jarring white screen during initial page load
- **Smooth transition** - Fade-out animation when the app is ready

### Backup World Icons
Backups now display the Minecraft world icon for easy identification:
- **World icons saved** - When creating a backup, the world's icon.png is saved alongside the backup ZIP
- **Icons displayed in Backups page** - Shows world icons instead of generic server/client icons
- **Fallback icons** - If no world icon exists, shows server or client icon based on instance type

## Bug Fixes

- **Kaizen OAuth Scope** - Fixed authentication error caused by incorrect OAuth scope (`user:profile` → `user:read`)

## Changes

- Accounts page subtitle changed from "Manage your Microsoft accounts" to "Manage your accounts"
- Accounts page now shows Minecraft accounts first, Kaizen accounts section below

## Technical Changes

### Backend (Rust/Tauri)

**New Files:**
- `src-tauri/src/auth/kaizen.rs` - Kaizen OAuth logic
  - `request_device_code()` - Get device code and user code
  - `poll_for_token()` - Poll until user approves
  - `get_user_info()` - Fetch user profile from API
  - `get_user_badges()` - Fetch badges with styling
  - `refresh_token()` - Refresh expired tokens
  - `revoke_token()` - Revoke access token
  - `extract_permissions()` - Extract permissions from tags
  - `is_patron()` - Check patron status
- `src-tauri/src/db/kaizen_accounts.rs` - Database operations
  - `KaizenAccount` struct with encrypted token fields
  - CRUD operations: `get_all`, `get_by_id`, `get_active`, `insert`, `set_active`, `delete`
  - `update_tokens()` - Update tokens after refresh
  - `update_user_info()` - Update user info after sync
  - `is_token_expired()` - Check expiration with 5-min buffer

**New Tauri Commands:**
- `login_kaizen_start` - Start device code flow
- `login_kaizen_complete` - Complete authentication
- `get_kaizen_accounts` - Get all Kaizen accounts
- `get_active_kaizen_account` - Get active account (auto-refreshes if expired)
- `set_active_kaizen_account` - Set active account
- `delete_kaizen_account` - Delete and revoke token
- `refresh_kaizen_account` - Manually refresh token
- `sync_kaizen_accounts` - Sync all accounts from API

**Database Schema:**
```sql
CREATE TABLE IF NOT EXISTS kaizen_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    username TEXT,
    email TEXT,
    access_token TEXT NOT NULL,        -- AES-256-GCM encrypted
    refresh_token TEXT,                 -- AES-256-GCM encrypted
    expires_at TEXT NOT NULL,
    permissions TEXT NOT NULL,          -- JSON array
    tags TEXT NOT NULL,                 -- JSON array
    badges TEXT NOT NULL,               -- JSON array with styling
    is_patron INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Environment Variables:**
- `KAIZEN_OAUTH_CLIENT_ID` (required) - OAuth client ID, set at build time
- `KAIZEN_OAUTH_BASE_URL` (optional) - Base URL, defaults to `https://kaizencore.tech`

### Frontend (TypeScript/React)

**New Files:**
- `src/components/dialogs/AddKaizenAccountDialog.tsx` - Device code flow UI
  - Auto-starts login on open
  - Displays user code prominently
  - Opens browser to verification URL
  - Shows loading/success/error states

**Modified Files:**
- `src/pages/Accounts.tsx`
  - Added `KaizenAccount` interface with badges field
  - Added `KaizenBadge` interface with camelCase styling
  - `getKaizenBadges()` and `getKaizenPermissions()` helper functions
  - Kaizen section moved below Minecraft section
  - Badge display with inline styles from API
  - Permissions displayed as outline badges
- `src/App.tsx` - Added `sync_kaizen_accounts` call at startup

### Translations

New keys added to all 4 locales (en, fr, de, nl):
- `accounts.kaizenAccounts` - "Kaizen Accounts"
- `accounts.noKaizenAccounts` - Empty state message
- `accounts.connectKaizen` - Connect prompt
- `accounts.loginKaizen` - Login button
- `kaizen.account` - "Kaizen Account"
- `kaizen.patron` - "Patron"
- `kaizen.permissions` - "Permissions"
- `kaizen.disconnect` - "Disconnect"
- And more...

### CSP Updates

Added `kaizencore.tech` to:
- `connect-src` - For API calls
- `img-src` - For potential future avatar images

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.6.5...v0.6.6
