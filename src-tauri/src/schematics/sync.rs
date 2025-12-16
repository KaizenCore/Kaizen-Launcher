use crate::error::{AppError, AppResult};
use sqlx::SqlitePool;
use std::path::Path;
use tokio::fs;
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::{
    db, nbt, scanner, ConflictResolution, Schematic, SchematicConflict, SchematicFormat,
    SchematicInstanceLink, SchematicSource, SyncStatus,
};

/// Copy a schematic from library to an instance
pub async fn copy_to_instance(
    library_dir: &Path,
    instance_dir: &Path,
    schematic: &Schematic,
    target_folder: &str,
    is_server: bool,
) -> AppResult<String> {
    let library_path = schematic
        .library_path
        .as_ref()
        .ok_or_else(|| AppError::Schematic("Schematic has no library path".to_string()))?;

    let source_path = library_dir.join(library_path);
    if !source_path.exists() {
        return Err(AppError::Schematic(format!(
            "Library file not found: {:?}",
            source_path
        )));
    }

    // Determine target folder
    let target_base = scanner::get_schematic_folder(is_server, target_folder);
    let target_dir = instance_dir.join(target_base);

    // Create target directory if needed
    fs::create_dir_all(&target_dir).await?;

    let target_path = target_dir.join(&schematic.filename);

    // Copy file
    fs::copy(&source_path, &target_path).await?;

    info!(
        "Copied schematic {} to {:?}",
        schematic.filename, target_path
    );

    Ok(format!("{}/{}", target_base, schematic.filename))
}

/// Import a schematic from an instance to the library
pub async fn import_to_library(
    instance_dir: &Path,
    library_dir: &Path,
    instance_path: &str,
    db: &SqlitePool,
) -> AppResult<Schematic> {
    let source_path = instance_dir.join(instance_path);
    if !source_path.exists() {
        return Err(AppError::Schematic(format!(
            "Instance file not found: {:?}",
            source_path
        )));
    }

    // Extract filename
    let filename = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Schematic("Invalid filename".to_string()))?
        .to_string();

    // Calculate hash
    let file_hash = scanner::calculate_file_hash(&source_path).await?;

    // Check if already exists in library by hash
    if let Some(existing) = db::get_schematic_by_hash(db, &file_hash).await? {
        debug!("Schematic already exists in library with hash {}", file_hash);
        return Ok(existing);
    }

    // Create library directory if needed
    fs::create_dir_all(library_dir).await?;

    // Determine library path (use filename, handle conflicts)
    let library_filename = get_unique_filename(library_dir, &filename).await?;
    let library_path = library_dir.join(&library_filename);

    // Copy to library
    fs::copy(&source_path, &library_path).await?;

    // Get file metadata
    let file_metadata = fs::metadata(&source_path).await?;
    let file_size = file_metadata.len();

    // Extract NBT metadata
    let nbt_metadata = nbt::extract_metadata(&source_path).unwrap_or_default();

    // Determine format
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let format = SchematicFormat::from_extension(ext).unwrap_or(SchematicFormat::Schem);

    // Create schematic record
    let now = chrono::Utc::now().to_rfc3339();
    let name = filename
        .rsplit_once('.')
        .map(|(n, _)| n.to_string())
        .unwrap_or_else(|| filename.clone());

    // Author is locked if extracted from file (protects original creator)
    let author_locked = nbt_metadata.author.is_some();

    let schematic = Schematic {
        id: Uuid::new_v4().to_string(),
        name,
        filename: library_filename.clone(),
        format,
        file_hash,
        file_size_bytes: file_size,
        library_path: Some(library_filename),
        dimensions: nbt_metadata.dimensions,
        author: nbt_metadata.author,
        author_locked,
        description: None,
        mc_version: nbt_metadata.mc_version,
        is_favorite: false,
        tags: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    };

    // Save to database
    db::insert_schematic(db, &schematic).await?;

    info!("Imported schematic {} to library", schematic.filename);

    Ok(schematic)
}

/// Get a unique filename in a directory (add _1, _2, etc. if exists)
async fn get_unique_filename(dir: &Path, filename: &str) -> AppResult<String> {
    let target = dir.join(filename);
    if !target.exists() {
        return Ok(filename.to_string());
    }

    // Split name and extension
    let (base, ext) = filename
        .rsplit_once('.')
        .map(|(b, e)| (b.to_string(), format!(".{}", e)))
        .unwrap_or_else(|| (filename.to_string(), String::new()));

    for i in 1..100 {
        let new_name = format!("{}_{}{}", base, i, ext);
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return Ok(new_name);
        }
    }

    Err(AppError::Schematic(
        "Could not find unique filename after 100 attempts".to_string(),
    ))
}

/// Synchronize library with instances - full scan
#[allow(dead_code)]
pub async fn sync_library_with_instances(
    db: &SqlitePool,
    library_dir: &Path,
    instances_dir: &Path,
    instances: &[(String, String, bool)], // (id, game_dir, is_server)
) -> AppResult<SyncResult> {
    let mut result = SyncResult::default();

    // 1. Scan library
    let library_schematics = scanner::scan_library(library_dir).await?;
    let library_hashes: std::collections::HashSet<_> = library_schematics
        .iter()
        .map(|s| s.file_hash.clone())
        .collect();

    // 2. Scan all instances
    let instance_schematics = scanner::scan_all_instances(instances_dir, instances).await?;

    // 3. Process each instance
    for (instance_id, _game_dir, _is_server) in instances {
        if let Some(schematics) = instance_schematics.get(instance_id) {
            for detected in schematics {
                let in_library = library_hashes.contains(&detected.file_hash);

                // Check if schematic exists in DB
                let existing = db::get_schematic_by_hash(db, &detected.file_hash).await?;

                if let Some(schematic) = existing {
                    // Schematic exists, check/update link
                    let link_status = if in_library {
                        SyncStatus::Synced
                    } else {
                        SyncStatus::PendingToLibrary
                    };

                    let link = SchematicInstanceLink {
                        id: Uuid::new_v4().to_string(),
                        schematic_id: schematic.id.clone(),
                        instance_id: instance_id.clone(),
                        instance_path: detected.path.clone(),
                        source: if in_library {
                            SchematicSource::Both
                        } else {
                            SchematicSource::Instance
                        },
                        sync_status: link_status,
                        last_synced_at: Some(chrono::Utc::now().to_rfc3339()),
                        created_at: chrono::Utc::now().to_rfc3339(),
                    };

                    db::insert_link(db, &link).await?;
                    result.updated += 1;
                } else {
                    // New schematic found in instance
                    result.new_in_instances += 1;
                }
            }
        }
    }

    // 4. Check for schematics in library not in any instance
    for lib_schem in &library_schematics {
        let existing = db::get_schematic_by_hash(db, &lib_schem.file_hash).await?;
        if existing.is_none() {
            // New in library, not tracked yet
            result.new_in_library += 1;
        }
    }

    Ok(result)
}

/// Result of sync operation
#[allow(dead_code)]
#[derive(Debug, Default)]
pub struct SyncResult {
    pub new_in_library: u32,
    pub new_in_instances: u32,
    pub updated: u32,
    pub conflicts: u32,
}

/// Check for conflicts between library and instance versions
pub async fn check_conflicts(
    db: &SqlitePool,
    library_dir: &Path,
    instances_dir: &Path,
    instances: &[(String, String, String, bool)], // (id, name, game_dir, is_server)
) -> AppResult<Vec<SchematicConflict>> {
    let mut conflicts = Vec::new();

    // Get all conflict links
    let conflict_links = db::get_conflicts(db).await?;

    for link in conflict_links {
        // Get schematic info
        let schematic = match db::get_schematic_by_id(db, &link.schematic_id).await? {
            Some(s) => s,
            None => continue,
        };

        // Get instance info
        let instance = instances
            .iter()
            .find(|(id, _, _, _)| id == &link.instance_id);

        let (instance_name, game_dir, _is_server) = match instance {
            Some((_, name, dir, server)) => (name.clone(), dir.clone(), *server),
            None => continue,
        };

        // Get file info from both locations
        let library_path = match &schematic.library_path {
            Some(p) => library_dir.join(p),
            None => continue,
        };

        let instance_path = instances_dir.join(&game_dir).join(&link.instance_path);

        if !library_path.exists() || !instance_path.exists() {
            continue;
        }

        let library_hash = scanner::calculate_file_hash(&library_path).await?;
        let instance_hash = scanner::calculate_file_hash(&instance_path).await?;

        if library_hash != instance_hash {
            let lib_meta = fs::metadata(&library_path).await?;
            let inst_meta = fs::metadata(&instance_path).await?;

            let lib_modified = lib_meta
                .modified()
                .ok()
                .and_then(|t| chrono::DateTime::<chrono::Utc>::from(t).into())
                .map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339())
                .unwrap_or_default();

            let inst_modified = inst_meta
                .modified()
                .ok()
                .and_then(|t| chrono::DateTime::<chrono::Utc>::from(t).into())
                .map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339())
                .unwrap_or_default();

            conflicts.push(SchematicConflict {
                schematic_id: schematic.id.clone(),
                schematic_name: schematic.name.clone(),
                instance_id: link.instance_id.clone(),
                instance_name,
                library_hash,
                instance_hash,
                library_modified: lib_modified,
                instance_modified: inst_modified,
                library_size: lib_meta.len(),
                instance_size: inst_meta.len(),
            });
        }
    }

    Ok(conflicts)
}

/// Resolve a conflict
pub async fn resolve_conflict(
    db: &SqlitePool,
    library_dir: &Path,
    instances_dir: &Path,
    schematic_id: &str,
    instance_id: &str,
    instance_game_dir: &str,
    resolution: ConflictResolution,
) -> AppResult<()> {
    let schematic = db::get_schematic_by_id(db, schematic_id)
        .await?
        .ok_or_else(|| AppError::Schematic("Schematic not found".to_string()))?;

    let links = db::get_schematic_links(db, schematic_id).await?;
    let link = links
        .iter()
        .find(|l| l.instance_id == instance_id)
        .ok_or_else(|| AppError::Schematic("Link not found".to_string()))?;

    let library_path = schematic
        .library_path
        .as_ref()
        .map(|p| library_dir.join(p))
        .ok_or_else(|| AppError::Schematic("No library path".to_string()))?;

    let instance_path = instances_dir
        .join(instance_game_dir)
        .join(&link.instance_path);

    match resolution {
        ConflictResolution::KeepLibrary => {
            // Overwrite instance with library version
            fs::copy(&library_path, &instance_path).await?;
            db::update_link_status(db, schematic_id, instance_id, SyncStatus::Synced).await?;
            info!("Resolved conflict: kept library version for {}", schematic.name);
        }
        ConflictResolution::KeepInstance => {
            // Overwrite library with instance version
            fs::copy(&instance_path, &library_path).await?;

            // Update hash in database
            let new_hash = scanner::calculate_file_hash(&instance_path).await?;
            let file_size = fs::metadata(&instance_path).await?.len();

            let mut updated_schematic = schematic.clone();
            updated_schematic.file_hash = new_hash;
            updated_schematic.file_size_bytes = file_size;
            updated_schematic.updated_at = chrono::Utc::now().to_rfc3339();

            db::update_schematic(db, &updated_schematic).await?;
            db::update_link_status(db, schematic_id, instance_id, SyncStatus::Synced).await?;
            info!("Resolved conflict: kept instance version for {}", schematic.name);
        }
        ConflictResolution::KeepBoth => {
            // Rename library version and import instance version as new
            let new_lib_filename =
                get_unique_filename(library_dir, &schematic.filename).await?;
            let new_lib_path = library_dir.join(&new_lib_filename);

            // Rename existing library file
            fs::rename(&library_path, &new_lib_path).await?;

            // Update existing schematic
            let mut updated_schematic = schematic.clone();
            updated_schematic.filename = new_lib_filename.clone();
            updated_schematic.library_path = Some(new_lib_filename);
            updated_schematic.updated_at = chrono::Utc::now().to_rfc3339();
            db::update_schematic(db, &updated_schematic).await?;

            // Import instance version as new schematic
            let instance_dir = instances_dir.join(instance_game_dir);
            let _new_schematic =
                import_to_library(&instance_dir, library_dir, &link.instance_path, db).await?;

            db::update_link_status(db, schematic_id, instance_id, SyncStatus::Synced).await?;
            info!(
                "Resolved conflict: kept both versions for {}",
                schematic.name
            );
        }
    }

    Ok(())
}

/// Delete schematic files from instances
pub async fn delete_from_instances(
    db: &SqlitePool,
    instances_dir: &Path,
    schematic_id: &str,
    instances: &[(String, String)], // (instance_id, game_dir)
) -> AppResult<u32> {
    let links = db::get_schematic_links(db, schematic_id).await?;
    let mut deleted = 0;

    for link in links {
        if let Some((_, game_dir)) = instances.iter().find(|(id, _)| id == &link.instance_id) {
            let file_path = instances_dir.join(game_dir).join(&link.instance_path);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path).await {
                    warn!("Failed to delete {:?}: {}", file_path, e);
                } else {
                    deleted += 1;
                }
            }
        }
    }

    // Delete all links
    db::delete_all_links_for_schematic(db, schematic_id).await?;

    Ok(deleted)
}
