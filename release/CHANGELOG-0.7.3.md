# Kaizen Launcher v0.7.3

**Release Date:** December 26, 2025

## Highlights

- 🔒 **Security Hardening** - Offline account permission gate + SSRF protection
- 🛠️ **Code Quality** - TunnelProvider trait, structured error codes, 123 unit tests
- ✨ **UI/UX Polish** - Framer Motion animations, accessibility, React optimizations

---

## Security

### Offline Account Permission Gate
Offline accounts are now restricted to users with the `launcher.dev` permission. The option is completely hidden from the account creation dialog for regular users, preventing unauthorized access to development-only features.

### Server-Side Permission Validation
The backend now validates the `launcher.dev` permission directly with the Kaizen API server. This prevents any bypass attempts through direct Tauri command invocation or frontend manipulation. Even if someone modifies the UI to show the offline option, the server will reject the request.

### Kaizen Account Requirement
Creating offline accounts now requires an active, authenticated Kaizen account. This ensures:
- Proper permission verification
- Audit trail for dev features
- Token validation against the Kaizen API

### Enhanced SSRF Protection
Comprehensive IP range blocking for URL validation:
- Blocks all private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 127.x)
- Blocks AWS metadata service (169.254.169.254)
- Blocks carrier-grade NAT (100.64.0.0/10)
- Blocks IPv6 private ranges (::1, fe80::, fc00::, fd00::)
- 18 new unit tests for IP validation

---

## Added

### TunnelProvider Trait
New unified trait interface for tunnel providers:
- Methods: `start()`, `stop()`, `name()`, `requires_auth()`, `is_configured()`
- Implemented for Playit, Cloudflare, Ngrok, and Bore providers
- Factory function `get_provider()` for provider instantiation
- Reduces code duplication across tunnel implementations

### Structured Error Codes
AppError now includes categorized error codes for better debugging:
- 60+ error codes across 15 categories
- Categories: AUTH, INST, DL, LAUNCH, CRYPTO, CLOUD, DISCORD, SHARE, SKIN, SEC, DEV, SCHEM, GEN
- `code()` method returns error code (e.g., "AUTH_001", "INST_002")
- `category()` method returns human-readable category
- Frontend receives structured JSON with code, category, and message

### 59 New Unit Tests
Comprehensive test coverage for critical functions:
- LoaderType parsing and validation (12 tests)
- NeoForge version utilities (9 tests)
- Forge installer URL generation (5 tests)
- Java version detection and vendor parsing (15 tests)
- URL/IP validation for SSRF protection (18 tests)
- **Total: 123 tests (up from 64)**

---

## Improved

### UI/UX Enhancements
- **Framer Motion Dialogs** - All dialogs use smooth fade + scale animations
  - New `AnimatedDialog` and `AnimatedDialogContent` components
  - Proper exit animations with `AnimatePresence`
- **Accessibility** - Comprehensive aria-labels for screen readers
  - New accessibility section in i18n locales (en.json, fr.json)
  - 20+ new translation keys for interactive elements
- **Dismiss Buttons** - Error states now have dismiss buttons across all pages
- **Responsive Mobile** - Improved mobile layout for dialogs and tabs

### React Performance
- `React.memo` and `useCallback` optimizations for:
  - SkinCard component
  - ModsList with memoized list items (ModListItemRow, ModGridItem)
  - PlaygroundModList
  - Accounts page
- Prevents unnecessary re-renders for better performance

### Type Safety
- skinStore.ts now fully typed (removed all `any`)
- New interfaces: `Skin`, `Cape`, `SkinProfile`, `StoreFavoriteSkin`
- New union types: `SkinVariant`, `SkinSource`, `CapeSource`

---

## Technical Changes

### Backend (Rust)
- New `src-tauri/src/tunnel/mod.rs` - TunnelProviderTrait and implementations
- Enhanced `src-tauri/src/error.rs` - ErrorCode enum with serialization
- New tests in `modloader/mod.rs`, `modloader/neoforge.rs`, `modloader/forge.rs`
- New tests in `launcher/java.rs`, `utils/url_validation.rs`

### Frontend (React/TypeScript)
- Modified `src/components/ui/dialog.tsx` - AnimatedDialog components with Framer Motion
- Modified `src/components/dialogs/AddAccountDialog.tsx` - Permission-gated offline accounts
- Modified `src/stores/skinStore.ts` - Full TypeScript typing
- Added accessibility section to `src/i18n/locales/en.json` and `fr.json`
- Modified multiple components with React.memo and aria-labels

### Auth (Security)
- Modified `src-tauri/src/auth/commands.rs`:
  - Added `PERMISSION_LAUNCHER_DEV` constant
  - Enhanced `create_offline_account` command with server-side validation
  - Kaizen account requirement check
  - Token decryption for API validation

---

## Upgrade Notes

- Users without `launcher.dev` permission will no longer see the offline account option
- Existing offline accounts are not affected
- Users must have an active Kaizen account to create new offline accounts
- All 123 unit tests pass (`cargo test`)
- TypeScript compiles without errors (`npm run type-check`)
