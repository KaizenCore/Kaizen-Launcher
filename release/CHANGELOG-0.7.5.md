# Kaizen Launcher v0.7.5

**Release Date:** December 26, 2025

## Highlights

- 📦 **Full Instance Backups** - Create complete backups of instances with cloud upload support
- 🔄 **Change Minecraft Version** - Modify the version of existing instances with mod compatibility checking
- ☁️ **Cloud Backup Support** - Upload instance backups to Google Drive, Dropbox, Nextcloud, or S3
- 📑 **Backups Page Redesign** - New tab-based interface separating world and instance backups

---

## Added

### Full Instance Backups
Create complete backups of your Minecraft instances:
- **Complete Backup**: Includes mods, configs, saves, libraries, assets, and client files
- **100% Autonomous**: Backups can be restored anywhere, even on a fresh installation
- **Easy Access**: New "Create Full Backup" button in instance details → Backups tab
- **Organized Storage**: Stored in `{data_dir}/backups/instances/{instance_id}/`

### Instance Backup Cloud Upload
Upload instance backups to your configured cloud storage:
- **All Providers Supported**: Google Drive, Dropbox, Nextcloud, S3
- **Separate Folder**: Uses "Kaizen Instance Backups/{instance_id}/" path
- **No Extra Setup**: Uses same configuration as world backups
- **Sync Status**: Shows badge on uploaded backups

### Instance Backup Restore
Restore instance backups with flexible options:
- **Replace Existing**: Overwrites all files in the original instance
- **Create New**: Creates a new instance from backup with custom name
- **Progress Tracking**: Real-time progress during restore operation

### Backups Page Redesign
Completely redesigned backup management:
- **Tab-Based Interface**: Separate tabs for World Backups and Instance Backups
- **Individual Statistics**: Each tab shows its own backup count and size
- **Filtering & Sorting**: Filter by instance, sort by date/size/name

### Change Instance Minecraft Version
Complete system for changing the Minecraft version of existing instances:
- **New Button**: "Change Version" button next to the Minecraft version in instance settings
- **Multi-Step Dialog**: Select version → Compatibility check → Progress → Complete
- **Client & Server Support**: Works for both client and server instances
- **Data Preservation**: Keeps mods, configs, worlds, resource packs, shader packs
- **Clean Installation**: Removes outdated files (client/, libraries/, assets/, natives/)

### Mod Compatibility Checking
Automatic mod compatibility verification before changing versions:
- Checks all mods with `.meta.json` files against the target Minecraft version
- **Three Compatibility States**:
  - ✅ Compatible: Update available on Modrinth
  - ⚠️ Incompatible: No compatible version found
  - ❓ Unknown: No Modrinth link (manually added mods)
- Grouped display with icons and version info

### Auto-Update Compatible Mods
Automatic mod updates when changing versions:
- Fetches latest compatible version from Modrinth for each mod
- Downloads and replaces mod files automatically
- SHA-512 verification for all downloaded files
- Incompatible mods are preserved (user can manually remove if needed)

---

## Fixed

- **World Backups Display**: World Backups tab no longer shows instance backups as "Unknown (instance)"
- **Backup Statistics**: Stats now correctly exclude instance backups from world backup counts

---

## Technical Changes

### Backend (Rust)

New instance backup module `src-tauri/src/instance/instance_backup.rs`:
- `create_instance_backup()` - Creates ZIP with manifest
- `restore_instance_backup_replace()` - Restores by replacing existing instance
- `restore_instance_backup_new()` - Creates new instance from backup
- `list_all_instance_backups()` - Lists all instance backups
- `delete_instance_backup()` - Deletes a backup
- `get_instance_backup_stats()` - Returns backup statistics

New Tauri commands for instance backups:
- `create_instance_backup`
- `restore_instance_backup`
- `get_all_instance_backups`
- `get_instance_backup_stats`
- `delete_instance_backup`
- `get_instance_backup_manifest`
- `upload_instance_backup_to_cloud`
- `get_instance_backup_cloud_syncs`

New cloud storage function in `src-tauri/src/cloud_storage/manager.rs`:
```rust
pub async fn upload_instance_backup(
    http_client: &reqwest::Client,
    config: &CloudStorageConfig,
    encryption_key: &[u8; 32],
    local_path: &Path,
    instance_id: &str,
    backup_filename: &str,
    app: Option<&AppHandle>,
) -> AppResult<String>
```

Bug fix in `src-tauri/src/instance/worlds.rs`:
- `list_all_backups()` now skips "instances" folder
- `get_backup_storage_stats()` now skips "instances" folder

### Frontend (React/TypeScript)

New components:
- `src/components/backups/WorldBackupsTab.tsx` - Extracted world backup logic
- `src/components/backups/InstanceBackupsTab.tsx` - New instance backup management
- `src/types/backups.ts` - TypeScript interfaces for backup types

Refactored `src/pages/Backups.tsx`:
- Tab-based layout with World Backups and Instance Backups tabs
- Simplified parent component delegating to tab components

Updated `src/pages/InstanceDetails.tsx`:
- New "Full Instance Backup" card in Backups sub-tab
- "Create Full Backup" button with loading state

New translation keys in all 4 locales:
- `backups.worldBackups`, `backups.instanceBackupsTab`
- `backups.instanceBackups.*` (backupCount, noBackups, restore options, cloud sync)
- `instanceDetails.fullInstanceBackup`, `instanceDetails.createFullBackup`
- `changeVersion.*` (version change dialog)

---

## Upgrade Notes

- **Existing Backups**: Your world backups remain unchanged and accessible in the World Backups tab
- **Instance Backups**: Create your first instance backup from instance details → Backups tab
- **Cloud Setup**: Instance backups use your existing cloud configuration - no additional setup needed
- **Version Changes**: Instance must not be running to change version
- **Mod Preservation**: Incompatible mods are NOT deleted during version change
