# Kaizen Launcher v0.6.7

**Release Date:** December 19, 2025

## Summary

This release introduces a permission-based access control system for launcher features. Users with Kaizen accounts can now have specific permissions that unlock features like beta access, developer tools, early access, and exclusive content. A new Playground page (beta) serves as a placeholder for upcoming features like the Instance Builder, while the DevTools section now includes a Feature Permissions viewer.

## New Features

### Kaizen Permissions System
Complete permission-based access control for launcher features:
- **Four Permission Types**:
  - `launcher.beta` - Access to beta features
  - `launcher.dev` - Developer tools and debugging utilities
  - `launcher.early_access` - Early access to new versions
  - `launcher.exclusive` - Exclusive content for supporters
- **Automatic Sync** - Permissions are synced from your Kaizen account tags at startup
- **Flexible API** - Hooks (`usePermission`, `useAnyPermission`, `useAllPermissions`) for easy permission checks
- **UI Components** - `RequirePermission`, `PermissionBadge`, and `PermissionGate` for conditional rendering

### Playground Page (Beta)
New experimental page for upcoming features:
- **Beta Access Required** - Requires `launcher.beta` permission to view
- **Coming Soon** - Currently displays a placeholder for the upcoming Instance Builder feature
- **Hidden Navigation** - Sidebar item only visible to users with beta permission

## Changes

### DevTools Access Control
DevTools now require the `launcher.dev` permission:
- **Settings Tab Hidden** - The DevTools tab in Settings is only visible to users with the permission
- **Keyboard Shortcuts Disabled** - Ctrl+Shift+D (DevMonitor), Ctrl+Shift+B (Bug Report), and Ctrl+Shift+L (Log Viewer) only work with permission
- **Components Not Rendered** - DevMonitor and BugReportDialog are not mounted without permission
- **Feature Permissions Section** - New section in DevTools showing all 4 launcher permissions with visual granted/denied status and preview cards

### React StrictMode Disabled
Removed React StrictMode to improve development experience:
- **No More Double Requests** - API calls are no longer duplicated in development
- **Cleaner Logs** - Console output is more readable without double-mounting noise
- **Note**: StrictMode only affected development mode, production was never impacted

## Technical Changes

### New Files

**Frontend:**
- `src/stores/kaizenStore.ts` - Zustand store for Kaizen account state
  - Stores active account, parsed permissions, tags, and badges
  - `loadActiveAccount()` - Fetches and parses account from backend
  - `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()` - Permission checks
  - `clear()` - Resets store state
- `src/hooks/usePermission.ts` - React hooks for permission checks
  - `usePermission(permission)` - Check single permission
  - `useAnyPermission(permissions)` - Check if user has any of the permissions
  - `useAllPermissions(permissions)` - Check if user has all permissions
  - `useKaizenPermissions()` - Full access to permissions and account info
- `src/components/permissions/RequirePermission.tsx` - Permission UI components
  - `RequirePermission` - Conditionally render children based on permission
  - `PermissionBadge` - Show permission status as a badge
  - `PermissionGate` - Show content with locked overlay if permission denied
- `src/pages/Playground.tsx` - Playground page component

**Translations:**
- New keys in all locales (en, fr, de, nl):
  - `permissions.*` - Permission-related strings
  - `playground.*` - Playground page strings
  - `nav.playground` - Navigation label

### Modified Files

- `src/App.tsx`
  - Imports and uses `useKaizenStore`
  - Loads Kaizen account after sync at startup
  - Conditionally renders DevMonitor and BugReportDialog based on permission
  - Keyboard shortcuts check `hasDevPermission` before executing
- `src/pages/Settings.tsx`
  - Imports `usePermission` hook
  - DevTools tab and content conditionally rendered
  - TabsList grid columns adjust based on permission (7 vs 6)
- `src/components/layout/Sidebar.tsx`
  - Added FlaskConical icon import
  - Added Playground NavItem to navigation
- `src/main.tsx`
  - Removed `React.StrictMode` wrapper
  - Removed unused `React` import

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.6.6...v0.6.7
