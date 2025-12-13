use crate::error::AppResult;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;
use tracing::{debug, warn};

use super::{DetectedSchematic, SchematicFormat};

/// Schematic folder paths for different mods - client
pub const CLIENT_SCHEMATIC_PATHS: &[&str] = &[
    "config/worldedit/schematics",    // WorldEdit client mod (Forge/Fabric)
    "worldedit/schematics",           // WorldEdit alternative location
    "schematics",                      // Litematica default, Create mod, also some WorldEdit configs
    "config/litematica/schematics",   // Alternative Litematica location
    "config/axiom/schematics",        // Axiom mod
    "schematics/uploaded",            // Create mod uploaded schematics
];

/// Schematic folder paths for different mods - server
pub const SERVER_SCHEMATIC_PATHS: &[&str] = &[
    "plugins/WorldEdit/schematics",         // WorldEdit plugin
    "plugins/FastAsyncWorldEdit/schematics", // FAWE
    "plugins/FAWE/schematics",              // Alternative FAWE location
    "schematics",                            // Some servers use root schematics folder
    "config/worldedit/schematics",          // Modded servers with WE mod
    "world/schematics",                      // Create mod (modded servers)
    "schematics/uploaded",                   // Create mod uploaded schematics
];

/// Valid schematic file extensions
const SCHEMATIC_EXTENSIONS: &[&str] = &["schem", "schematic", "litematic", "nbt"];

/// Scan an instance directory for schematics
pub async fn scan_instance(
    instance_dir: &Path,
    is_server: bool,
) -> AppResult<Vec<DetectedSchematic>> {
    let paths = if is_server {
        SERVER_SCHEMATIC_PATHS
    } else {
        CLIENT_SCHEMATIC_PATHS
    };

    let mut schematics = Vec::new();

    for relative_path in paths {
        let full_path = instance_dir.join(relative_path);
        if full_path.exists() && full_path.is_dir() {
            debug!("Scanning schematic folder: {:?}", full_path);
            match scan_folder(&full_path, relative_path).await {
                Ok(found) => {
                    if !found.is_empty() {
                        debug!("Found {} schematics in {:?}", found.len(), full_path);
                    }
                    schematics.extend(found);
                }
                Err(e) => {
                    warn!("Failed to scan folder {:?}: {}", full_path, e);
                }
            }
        }
    }

    // Deduplicate by hash (same file in multiple locations)
    let mut seen_hashes = std::collections::HashSet::new();
    schematics.retain(|s| seen_hashes.insert(s.file_hash.clone()));

    Ok(schematics)
}

/// Scan a folder for schematic files
async fn scan_folder(folder: &Path, base_path: &str) -> AppResult<Vec<DetectedSchematic>> {
    let mut schematics = Vec::new();

    let mut entries = fs::read_dir(folder).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();

        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if SCHEMATIC_EXTENSIONS.contains(&ext_lower.as_str()) {
                    debug!("Found schematic file: {:?}", path);
                    match process_schematic_file(&path, base_path).await {
                        Ok(schematic) => {
                            debug!("Processed schematic: {}", schematic.filename);
                            schematics.push(schematic);
                        }
                        Err(e) => {
                            warn!("Failed to process schematic {:?}: {}", path, e);
                        }
                    }
                }
            }
        } else if path.is_dir() {
            // Recursively scan subdirectories
            let sub_base = format!("{}/{}", base_path, path.file_name().unwrap_or_default().to_string_lossy());
            if let Ok(sub_schematics) = Box::pin(scan_folder(&path, &sub_base)).await {
                schematics.extend(sub_schematics);
            }
        }
    }

    Ok(schematics)
}

/// Process a single schematic file
async fn process_schematic_file(path: &Path, base_path: &str) -> AppResult<DetectedSchematic> {
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let format = SchematicFormat::from_extension(ext)
        .unwrap_or(SchematicFormat::Schem);

    // Get file metadata
    let metadata = fs::metadata(path).await?;
    let file_size = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    // Calculate SHA256 hash
    let file_hash = calculate_file_hash(path).await?;

    // Build relative path
    let relative_path = format!("{}/{}", base_path, filename);

    Ok(DetectedSchematic {
        path: relative_path,
        filename,
        format,
        file_hash,
        file_size_bytes: file_size,
        modified_at: modified,
        in_library: false, // Will be set by caller
    })
}

/// Calculate SHA256 hash of a file using streaming (memory-efficient for large files)
pub async fn calculate_file_hash(path: &Path) -> AppResult<String> {
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();

    // Stream in 64KB chunks instead of loading entire file into memory
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let result = hasher.finalize();
    Ok(hex::encode(result))
}

/// Scan all instances for schematics (parallelized for performance)
pub async fn scan_all_instances(
    instances_dir: &Path,
    instances: &[(String, String, bool)], // (id, game_dir, is_server)
) -> AppResult<HashMap<String, Vec<DetectedSchematic>>> {
    // Build list of spawn handles for parallel execution
    let handles: Vec<_> = instances
        .iter()
        .filter_map(|(instance_id, game_dir, is_server)| {
            let instance_path = instances_dir.join(game_dir);
            if instance_path.exists() {
                let id = instance_id.clone();
                let is_server = *is_server;
                Some(tokio::spawn(async move {
                    match scan_instance(&instance_path, is_server).await {
                        Ok(schematics) => {
                            if !schematics.is_empty() {
                                debug!(
                                    "Found {} schematics in instance {}",
                                    schematics.len(),
                                    id
                                );
                                Some((id, schematics))
                            } else {
                                None
                            }
                        }
                        Err(e) => {
                            warn!("Failed to scan instance {}: {}", id, e);
                            None
                        }
                    }
                }))
            } else {
                None
            }
        })
        .collect();

    // Execute all scans in parallel and collect results
    let mut results = HashMap::new();
    for handle in handles {
        if let Ok(Some((id, schematics))) = handle.await {
            results.insert(id, schematics);
        }
    }

    Ok(results)
}

/// Scan the central library folder
pub async fn scan_library(library_dir: &Path) -> AppResult<Vec<DetectedSchematic>> {
    if !library_dir.exists() {
        return Ok(Vec::new());
    }

    scan_folder(library_dir, "").await
}

/// Get the appropriate schematic folder for an instance based on target mod
pub fn get_schematic_folder(is_server: bool, target: &str) -> &'static str {
    match (is_server, target.to_lowercase().as_str()) {
        // Server targets
        (true, "worldedit") => "plugins/WorldEdit/schematics",
        (true, "fawe") => "plugins/FastAsyncWorldEdit/schematics",
        (true, "create") => "world/schematics",
        (true, _) => "schematics",
        // Client targets
        (false, "worldedit") => "config/worldedit/schematics",
        (false, "litematica") => "schematics",
        (false, "axiom") => "config/axiom/schematics",
        (false, "create") => "schematics",
        (false, _) => "schematics",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_schematic_folder() {
        assert_eq!(
            get_schematic_folder(false, "worldedit"),
            "config/worldedit/schematics"
        );
        assert_eq!(
            get_schematic_folder(true, "worldedit"),
            "plugins/WorldEdit/schematics"
        );
        assert_eq!(get_schematic_folder(false, "litematica"), "schematics");
        assert_eq!(get_schematic_folder(true, "create"), "world/schematics");
        assert_eq!(get_schematic_folder(false, "create"), "schematics");
    }
}
