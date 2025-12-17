# Kaizen Launcher v0.6.4

**Release Date:** December 17, 2025

## Summary

This release adds background customization options to the 3D skin viewer, allowing users to personalize their skin preview experience with theme colors, custom colors, or background images.

## New Features

### Skin Viewer Background Customization

The 3D skin viewer in the Skin Manager now supports customizable backgrounds with three modes:

- **Theme Mode** (Default): Uses your current theme's card color. Automatically updates when switching between light and dark themes.
- **Color Mode**: Pick any custom color using the color picker or hex input. Includes preset colors for quick selection.
- **Image Mode**: Upload your own background image (PNG, JPG, WebP, GIF). Perfect for showcasing skins in custom environments.

Access background settings via the paintbrush icon in the skin viewer controls.

### Theme-Aware Background

The default skin viewer background is now dynamically derived from your theme's CSS custom properties instead of using a hardcoded blue color. This ensures the viewer always matches your current theme, whether you're using the default Kaizen theme or a custom color scheme.

## Technical Changes

### Frontend (TypeScript/React)

- Added `backgroundImage` prop to `SkinViewer3D` component
- New `getThemeColor()` function converts HSL CSS variables to hex for Three.js compatibility
- Background preferences stored in localStorage (`kaizen-skin-viewer-background`)
- New Popover-based UI for background settings with mode selection tabs

### Component Changes

- `src/components/skins/SkinViewer3D.tsx` - Added backgroundImage support with CSS background fallback
- `src/pages/Skins.tsx` - Added background customization state, UI controls, and file upload handler

### Localization

New translation keys added to all 4 locales (en, fr, de, nl):
- `skins.background` - Tooltip for background button
- `skins.backgroundSettings` - Popover title
- `skins.bgTheme`, `skins.bgColor`, `skins.bgImage` - Mode labels
- `skins.selectColor`, `skins.selectImage` - Section labels
- `skins.uploadImage`, `skins.changeImage` - Button labels
- `skins.backgroundImageError` - Error message

## Files Changed

- `src/components/skins/SkinViewer3D.tsx` - Background image support
- `src/pages/Skins.tsx` - Background customization UI and logic
- `src/i18n/locales/en.json` - English translations
- `src/i18n/locales/fr.json` - French translations
- `src/i18n/locales/de.json` - German translations
- `src/i18n/locales/nl.json` - Dutch translations

---

**Full Changelog**: https://github.com/KaizenCore/Kaizen-Launcher/compare/v0.6.3...v0.6.4
