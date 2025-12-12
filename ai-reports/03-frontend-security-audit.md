# Frontend Security & Optimization Audit Report

**Date:** 2024-12-12
**Auditor:** Claude (frontend-ui-expert agent)
**Scope:** React/TypeScript frontend, bundle optimization, XSS prevention

---

## Executive Summary

The Kaizen Launcher React/TypeScript frontend generally follows good practices but has **critical XSS vulnerabilities** that need immediate attention. The codebase also has optimization opportunities related to large component files and memoization.

---

## Security Findings

### 1. XSS Vulnerability via dangerouslySetInnerHTML (Modpack Description)

| Severity | CRITICAL |
|----------|----------|
| Location | `src/pages/ModpackDetails.tsx:463` |

**Description:** The modpack description (`project.body`) is rendered directly from the Modrinth API without sanitization.

```tsx
<div
  className="prose prose-sm dark:prose-invert max-w-none"
  dangerouslySetInnerHTML={{ __html: project.body }}
/>
```

**Risk:** Malicious modpack authors could inject JavaScript via their description field. In a Tauri app, XSS can potentially access Tauri's IPC and execute system commands.

**Recommended Fix:**
```tsx
import DOMPurify from 'dompurify';

<div
  className="prose prose-sm dark:prose-invert max-w-none"
  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(project.body) }}
/>
```

**Action Required:** Install `dompurify` and `@types/dompurify`:
```bash
npm install dompurify @types/dompurify
```

---

### 2. XSS Vulnerability via Log Search Highlighting

| Severity | HIGH |
|----------|------|
| Location | `src/pages/InstanceDetails.tsx:2023-2034` |

**Description:** Log search term highlighting uses dangerouslySetInnerHTML without HTML-escaping the log content first.

```tsx
const regex = new RegExp(`(${logSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
displayLine = line.replace(regex, '<mark class="bg-yellow-500/50">$1</mark>')
// ...
dangerouslySetInnerHTML={{ __html: displayLine }}
```

**Risk:** Malicious mods or servers could inject HTML/JavaScript through log output.

**Recommended Fix:**
```tsx
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let displayLine = escapeHtml(line);
if (logSearch.trim()) {
  const escapedSearch = logSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedSearch})`, 'gi');
  displayLine = displayLine.replace(regex, '<mark class="bg-yellow-500/50 text-white rounded px-0.5">$1</mark>');
}
```

---

### 3. External URL Handling Without Validation

| Severity | MEDIUM |
|----------|--------|
| Location | Multiple files |

**Files:**
- `src/pages/Settings.tsx:960,969`
- `src/components/dialogs/AddAccountDialog.tsx:68,248`
- `src/components/onboarding/Onboarding.tsx:231,550`

**Description:** URLs from OAuth responses are opened without validation.

```tsx
openUrl(codeInfo.verification_uri)
```

**Recommended Fix:**
```tsx
const ALLOWED_DOMAINS = [
  'login.microsoftonline.com',
  'login.live.com',
  'microsoft.com',
  'github.com',
  'discord.gg'
];

function safeOpenUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (ALLOWED_DOMAINS.some(domain => parsed.hostname.endsWith(domain))) {
      openUrl(url);
    } else {
      console.error('Blocked potentially malicious URL:', url);
    }
  } catch {
    console.error('Invalid URL:', url);
  }
}
```

---

### 4. External Image Loading

| Severity | LOW |
|----------|-----|
| Location | Multiple files |

**Description:** Images loaded from external sources (mc-heads.net, Modrinth CDN) without proxying.

**Assessment:** Lower risk in Tauri app but worth noting for privacy.

---

### 5. localStorage Usage

| Severity | LOW (Informational) |
|----------|---------------------|
| Location | Multiple files |

**Assessment:** localStorage is used appropriately for UI preferences only. Sensitive data (tokens, credentials) is properly handled by the Rust backend with encryption.

---

## Optimization Findings

### 1. Large Component Files

| Impact | HIGH (Maintainability) |
|--------|------------------------|
| Location | Multiple files |

| File | Lines | Size |
|------|-------|------|
| InstanceDetails.tsx | 2,110 | 84KB |
| ConfigEditor.tsx | 1,436 | - |
| ModrinthBrowser.tsx | 1,202 | - |
| Instances.tsx | 1,149 | 44KB |
| Skins.tsx | 1,118 | 40KB |
| Settings.tsx | 1,004 | 44KB |

**Recommendation for InstanceDetails.tsx:** Split into:
- `InstanceHeader.tsx` - Instance info and actions
- `InstanceModsTab.tsx` - Mods management
- `InstanceLogsTab.tsx` - Log viewing
- `InstanceSettingsTab.tsx` - Instance settings

---

### 2. Missing Memoization for Log Processing

| Impact | MEDIUM |
|--------|--------|
| Location | `src/pages/InstanceDetails.tsx:1988-2018` |

**Description:** Log filtering computation happens on every render.

**Recommended Fix:**
```tsx
const processedLogLines = useMemo(() => {
  if (!logContent) return [];
  return logContent.split('\n')
    .filter(line => {
      if (!line.trim()) return false;
      if (logLevelFilter !== "ALL") {
        const level = extractLogLevel(line);
        if (level !== logLevelFilter) return false;
      }
      if (logSearch.trim()) {
        return line.toLowerCase().includes(logSearch.toLowerCase());
      }
      return true;
    });
}, [logContent, logLevelFilter, logSearch]);
```

---

### 3. Node Polyfills for WebTorrent

| Impact | MEDIUM |
|--------|--------|
| Location | `vite.config.ts:14-22` |

**Description:** WebTorrent requires substantial Node.js polyfills increasing bundle size.

```tsx
nodePolyfills({
  include: ["buffer", "stream", "events", "util", "process", "path", "crypto", "os"],
}),
```

**Recommendation:** Consider moving WebTorrent functionality to Rust backend to eliminate polyfills.

---

### 4. Missing useCallback for Event Handlers

| Impact | LOW |
|--------|-----|
| Location | Various pages |

**Description:** Many event handlers defined inline without useCallback, causing unnecessary child re-renders.

**Recommendation:** Wrap frequently-used callbacks in useCallback.

---

## Positive Practices Observed

| Practice | Status |
|----------|--------|
| React.lazy for route code splitting | OK |
| React.memo for list items (InstanceCard) | OK |
| Strict TypeScript configuration | OK |
| ESLint properly configured | OK |
| No eval() or Function() usage | OK |
| Zustand persist for UI state only | OK |
| Credentials handled in Rust backend | OK |

---

## Summary Table

| Issue | Severity | Category |
|-------|----------|----------|
| XSS in ModpackDetails (unsanitized HTML) | CRITICAL | Security |
| XSS in log highlighting | HIGH | Security |
| External URL handling | MEDIUM | Security |
| Large component files | HIGH | Maintainability |
| Missing log memoization | MEDIUM | Performance |
| Node polyfills for WebTorrent | MEDIUM | Bundle Size |
| Missing useCallback | LOW | Performance |
| External image loading | LOW | Privacy |

---

## Recommended Priority for Fixes

1. **CRITICAL: Sanitize Modrinth HTML with DOMPurify** (XSS)
2. **HIGH: HTML-escape log content before highlighting** (XSS)
3. **HIGH: Split InstanceDetails.tsx** (Maintainability)
4. **MEDIUM: Add URL validation for external links** (Security)
5. **MEDIUM: Memoize log processing** (Performance)
6. **MEDIUM: Consider moving WebTorrent to Rust** (Bundle size)
