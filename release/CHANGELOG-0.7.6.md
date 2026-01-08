# Kaizen Launcher v0.7.6

**Release Date:** December 30, 2025

## Highlights

- ✨ **Easy Mode / Advanced Mode** - Simplified interface for novice players
- ⚡ **Quick Play** - One-click Minecraft experience with Fabulously Optimized
- 📖 **Documentation Window** - In-app documentation with 8 comprehensive sections
- 🎨 **Instance Color Customization** - Choose custom colors for your instances

---

## Added

### Easy Mode / Advanced Mode
New toggle in the title bar to switch between modes:
- **Easy Mode**: Simplified interface hiding complex settings
- **Advanced Mode**: Full control over all settings (original experience)
- **Default for new users**: Easy Mode is enabled by default
- **Persistent**: Setting saved in database across sessions

### Quick Play
Available in both Easy and Advanced modes via tabbed interface:
- **Unified Interface**: Combined with "Last Played" in a single card with tabs
- **Default Modpack**: Fabulously Optimized (optimized vanilla experience)
- **Smart Version Selector**: Shows only unique Minecraft versions (latest modpack version per MC version)
- **One-Click Launch**: Click play to install and launch automatically
- **Change Modpack**: Search Modrinth for alternative modpacks
- **Preference Saved**: Your chosen modpack is remembered
- **Smart Caching**: Prevents reload flashing when switching tabs:
  - Version cache (10 minutes)
  - Instance check cache (2 minutes)
  - Account state persistence
  - Install state persistence between tabs

### Auto-Optimization (Easy Mode Performance)
Simple performance settings in Easy Mode:
- **Single Button**: "Optimize Now" replaces complex JVM settings
- **Profile Detection**: Automatically detects mod count and selects optimal profile:
  - Vanilla (0 mods): Minimal settings
  - Light (<30 mods): Balanced settings
  - Heavy (<100 mods): Increased resources
  - Performance (100+ mods): Maximum optimization
- **Loader Awareness**: Adjusts for Forge/NeoForge (more resource intensive)
- **Server Support**: Uses Aikar's flags for server instances

### Simplified Instance Views (Easy Mode)
Streamlined interface throughout:
- **General Tab**: Shows only name, version, loader, playtime, and folder button
- **Performance Tab**: Shows Auto-Optimization instead of RAM/Java/JVM settings
- **Backups Tab**: Shows only auto-backup toggle (hides full instance backup)
- **Server Tab**: Hidden completely in Easy Mode
- **Backups Relocated**: Moved to main navigation tabs (not sub-tab of Settings)

### Instance Color Customization
Personalize your instances with custom colors:
- **12-Color Palette**: Amber, red, orange, lime, green, emerald, teal, cyan, blue, violet, purple, pink
- **Database Persistence**: Colors are saved and synced across sessions
- **Easy Access**: Right-click context menu on instance cards
- **Settings Integration**: Also available in instance settings (General tab)
- **Smart Display**: Only shown for instances without custom icons

### InstanceColorPicker Component
New reusable color picker UI component:
- **Popover Design**: Clean popover with color grid
- **Reset Option**: "Reset to auto" returns to hash-based color
- **Inline Variant**: Compact version for context menus

### Documentation Window
In-app documentation system accessible from the title bar:
- **BookOpen Icon**: New icon in the header next to easy/advanced toggle
- **Separate Window**: Opens a dedicated Tauri window for documentation
- **8 Sections**: Home, Instances, Accounts, Skins, Browse, Backups, Sharing, Settings
- **Sidebar Navigation**: Easy navigation with search functionality
- **Custom Title Bar**: Draggable window with minimize/close buttons
- **French Content**: Complete documentation in French covering all launcher features

---

## Improved

### Stacked Bar Storage Visualization
Visual upgrade to the Settings storage tab:
- **Colorful Stacked Bar**: Each instance displayed as a segment with unique color from 12-color palette
- **Interactive Tooltips**: Hover to see instance name, size in bytes, and percentage
- **Compact Legend**: Shows top 5 instances by size with colored indicators
- **Integrated Design**: Replaces old list view, now part of the main storage overview section

### Modernized Instance Cards
Better visual design for instances without icons:
- **Gradient Backgrounds**: Beautiful gradients based on instance color
- **Auto-Generated Colors**: Hash-based color from instance name when no custom color set
- **Colored Initials**: Instance letter matches the background color
- **Consistent Styling**: Same look on Instances page and Homepage

### Compact Instances Header
Redesigned page header with space efficiency:
- **Two-Line Layout**: Title + actions on line 1, tabs + filters on line 2
- **Unified Toolbar**: Replaces previous three-row layout
- **Reduced Padding**: Less vertical space consumed by the header

### Homepage Color Support
Instance colors now display everywhere:
- **Hero Section**: Selected instance shows colored icon
- **Dropdown Selector**: Instance list shows colored icons
- **Recent Instances Grid**: All cards display their colors

### Compact Home Page Layout
Redesigned home page with better spacing and proportions:
- **Reduced Section Gaps**: gap-6 → gap-4 for tighter layout
- **Compact Stats Cards**: Smaller text (text-2xl), reduced padding, smaller icons
- **Hover Effects**: Recent instances show ring on hover instead of static selection badge
- **Default Tab**: "Last Played" is now always the default tab

---

## Technical Changes

### Backend (Rust)

New Easy Mode commands in `src-tauri/src/db/settings.rs`:
```rust
#[tauri::command]
pub async fn get_easy_mode_enabled(state: State<'_, SharedState>) -> AppResult<bool>
#[tauri::command]
pub async fn set_easy_mode_enabled(state: State<'_, SharedState>, enabled: bool) -> AppResult<()>
```

Generic settings commands for Quick Play preferences:
```rust
#[tauri::command]
pub async fn get_setting_value(state: State<'_, SharedState>, key: String) -> AppResult<Option<String>>
#[tauri::command]
pub async fn set_setting_value(state: State<'_, SharedState>, key: String, value: String) -> AppResult<()>
```

### Frontend (React/TypeScript) - Easy Mode

New stores:
- `src/stores/easyModeStore.ts` - Zustand store for Easy Mode state
- `src/stores/quickPlayStore.ts` - Zustand store for Quick Play with comprehensive caching:
  - Version cache with 10-minute TTL
  - Instance check cache with 2-minute TTL
  - Account state persistence
  - Current instance and install stage (persists between tab switches)

New components:
- `src/components/home/QuickPlay.tsx` - Quick Play component with `embedded` prop for tab integration
- `src/components/instances/EasyModeOptimizer.tsx` - Auto-optimization component

Updated files:
- `src/components/layout/TitleBar.tsx` - Easy/Advanced toggle
- `src/pages/Home.tsx` - Redesigned with tabbed "Last Played" / "Quick Play" card
- `src/pages/InstanceDetails.tsx` - Conditional rendering for simplified views

New translation keys in `en.json` and `fr.json`:
- `quickPlay.*` - Quick Play translations
- `easyMode.*` - Easy Mode translations
- `home.lastPlayed` - Last Played tab label

### Backend (Rust) - Instance Colors

Database migration in `src-tauri/src/state.rs`:
```rust
let _ = sqlx::query("ALTER TABLE instances ADD COLUMN color TEXT")
    .execute(db)
    .await;
```

New method in `src-tauri/src/db/instances.rs`:
```rust
pub async fn update_color(
    db: &SqlitePool,
    id: &str,
    color: Option<&str>,
) -> sqlx::Result<()>
```

New Tauri command in `src-tauri/src/instance/commands.rs`:
```rust
#[tauri::command]
pub async fn update_instance_color(
    state: State<'_, SharedState>,
    instance_id: String,
    color: Option<String>,
) -> AppResult<()>
```
- Validates hex color format (#rrggbb)
- Returns error for invalid format

### Frontend (React/TypeScript)

New component `src/components/instances/InstanceColorPicker.tsx`:
- `InstanceColorPicker` - Popover-based color selector
- `InlineColorPicker` - Compact version for context menus
- `COLOR_PALETTE` - Array of 12 hex colors

Updated interfaces in `src/pages/Instances.tsx` and `src/pages/Home.tsx`:
```typescript
interface Instance {
  // ... existing fields
  color: string | null
}
```

Color mapping system:
```typescript
const colorMap: Record<string, { bg: string; text: string }> = {
  "#f59e0b": { bg: "from-amber-500/30 to-amber-600/10", text: "text-amber-300" },
  // ... 11 more colors
}

const getInstanceColor = (instance: Instance) => {
  // Returns persisted color or hash-based fallback
}
```

Updated `src/components/layout/MainLayout.tsx`:
- Reduced top padding from `p-6` to `px-6 pt-4`

New translation keys in `en.json` and `fr.json`:
- `selectColor`, `changeColor`, `resetColor`
- `colorUpdated`, `colorUpdateError`
- `settings.whatsNewInstanceColors`, etc.

### Documentation Window

New `src/pages/Documentation.tsx` component:
- 8 section components for comprehensive documentation
- Sidebar navigation with search
- Custom title bar handlers for window operations

New Tauri commands in `src-tauri/src/devtools/commands.rs`:
```rust
#[tauri::command]
pub async fn open_documentation_window(app: AppHandle) -> AppResult<()>
#[tauri::command]
pub async fn close_documentation_window(app: AppHandle) -> AppResult<()>
```

Updated `src-tauri/capabilities/default.json`:
- Added "documentation" to windows array for permissions

New route in `src/App.tsx`:
- `/documentation` route outside MainLayout for separate window

New translation keys for documentation:
- `documentation.title`, `documentation.openTooltip`, `documentation.comingSoon`

---

## Color Palette Reference

| Color | Hex Code |
|-------|----------|
| Amber | #f59e0b |
| Red | #ef4444 |
| Orange | #f97316 |
| Lime | #84cc16 |
| Green | #22c55e |
| Emerald | #10b981 |
| Teal | #14b8a6 |
| Cyan | #06b6d4 |
| Blue | #3b82f6 |
| Violet | #8b5cf6 |
| Purple | #a855f7 |
| Pink | #ec4899 |

---

## Upgrade Notes

- **Existing Instances**: All instances will use auto-generated colors based on their name until you set a custom color
- **No Action Required**: The feature works automatically with sensible defaults
- **Icons Take Priority**: Instances with custom icons will not show the color background
- **Color Persistence**: Custom colors are saved in the database and sync across sessions
