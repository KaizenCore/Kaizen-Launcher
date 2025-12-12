//! Import functionality for instance sharing

use crate::db::instances::{CreateInstance, Instance};
use crate::error::{AppError, AppResult};
use crate::sharing::manifest::*;
use sqlx::SqlitePool;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use uuid::Uuid;
use zip::ZipArchive;

/// Validate an import package and return its manifest
pub async fn validate_import_package(package_path: &Path) -> AppResult<SharingManifest> {
    if !package_path.exists() {
        return Err(AppError::Io(format!(
            "Package not found: {}",
            package_path.display()
        )));
    }

    // Read manifest from ZIP (blocking operation)
    let package_path_clone = package_path.to_path_buf();
    let manifest = tokio::task::spawn_blocking(move || read_manifest_from_zip(&package_path_clone))
        .await
        .map_err(|e| AppError::Io(format!("Task failed: {}", e)))??;

    // Validate manifest version
    if manifest.version != MANIFEST_VERSION {
        return Err(AppError::Instance(format!(
            "Unsupported manifest version: {}. Expected: {}",
            manifest.version, MANIFEST_VERSION
        )));
    }

    Ok(manifest)
}

/// Read manifest from ZIP file
fn read_manifest_from_zip(package_path: &Path) -> AppResult<SharingManifest> {
    let file = File::open(package_path)
        .map_err(|e| AppError::Io(format!("Failed to open package: {}", e)))?;

    let mut archive =
        ZipArchive::new(file).map_err(|e| AppError::Io(format!("Invalid ZIP archive: {}", e)))?;

    // Find and read manifest
    let mut manifest_file = archive
        .by_name("kaizen-manifest.json")
        .map_err(|_| AppError::Instance("Missing kaizen-manifest.json in package".to_string()))?;

    let mut manifest_json = String::new();
    manifest_file
        .read_to_string(&mut manifest_json)
        .map_err(|e| AppError::Io(format!("Failed to read manifest: {}", e)))?;

    let manifest: SharingManifest = serde_json::from_str(&manifest_json).map_err(AppError::Json)?;

    Ok(manifest)
}

/// Import an instance from a package
pub async fn import_instance(
    app: &AppHandle,
    db: &SqlitePool,
    instances_dir: &Path,
    package_path: &Path,
    new_name: Option<String>,
) -> AppResult<Instance> {
    let import_id = Uuid::new_v4().to_string();

    emit_progress(app, &import_id, "validating", 0, "Validating package...");

    // Validate and get manifest
    let manifest = validate_import_package(package_path).await?;

    // Determine instance name
    let instance_name = new_name.unwrap_or_else(|| manifest.instance.name.clone());

    // Check for name conflicts and generate unique name
    let unique_name = generate_unique_name(db, &instance_name).await?;

    emit_progress(app, &import_id, "extracting", 20, "Extracting package...");

    // Generate game_dir from name
    let game_dir = sanitize_game_dir(&unique_name);
    let instance_dir = instances_dir.join(&game_dir);

    // Create instance directory
    fs::create_dir_all(&instance_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create instance dir: {}", e)))?;

    // Extract package (blocking operation)
    let package_path_clone = package_path.to_path_buf();
    let instance_dir_clone = instance_dir.clone();
    let import_id_clone = import_id.clone();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        extract_package(
            &app_clone,
            &import_id_clone,
            &package_path_clone,
            &instance_dir_clone,
        )
    })
    .await
    .map_err(|e| AppError::Io(format!("Extract task failed: {}", e)))??;

    emit_progress(app, &import_id, "installing", 80, "Creating instance...");

    // Create instance in database using CreateInstance
    let create_data = CreateInstance {
        name: unique_name,
        mc_version: manifest.instance.mc_version,
        loader: manifest.instance.loader,
        loader_version: manifest.instance.loader_version,
        is_server: manifest.instance.is_server,
        is_proxy: manifest.instance.is_proxy,
        server_port: 25565,
        modrinth_project_id: None,
    };

    let instance = Instance::create(db, create_data)
        .await
        .map_err(AppError::Database)?;

    emit_progress(app, &import_id, "complete", 100, "Import complete!");

    Ok(instance)
}

/// Extract package to instance directory
fn extract_package(
    app: &AppHandle,
    import_id: &str,
    package_path: &Path,
    instance_dir: &Path,
) -> AppResult<()> {
    let file = File::open(package_path)
        .map_err(|e| AppError::Io(format!("Failed to open package: {}", e)))?;

    let mut archive =
        ZipArchive::new(file).map_err(|e| AppError::Io(format!("Invalid ZIP archive: {}", e)))?;

    let total_files = archive.len();

    for i in 0..total_files {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::Io(format!("Failed to read archive entry: {}", e)))?;

        let name = file.name().to_string();

        // Skip manifest (we've already processed it)
        if name == "kaizen-manifest.json" {
            continue;
        }

        // Security: robust path traversal prevention
        // 1. Reject paths containing ".." anywhere
        if name.contains("..") {
            tracing::warn!("[SECURITY] Blocked path with '..': {}", name);
            continue;
        }

        // 2. Reject absolute paths
        if name.starts_with('/') || name.starts_with('\\') {
            tracing::warn!("[SECURITY] Blocked absolute path: {}", name);
            continue;
        }

        // 3. Reject Windows-style paths (C:\, etc)
        if name.len() >= 2 && name.chars().nth(1) == Some(':') {
            tracing::warn!("[SECURITY] Blocked Windows absolute path: {}", name);
            continue;
        }

        // 4. Build the output path and verify it stays within instance_dir
        let outpath = instance_dir.join(&name);

        // 5. Canonicalize and verify the path is still under instance_dir
        // Note: We can't canonicalize yet if it doesn't exist, so we check components
        let normalized: PathBuf = outpath
            .components()
            .filter(|c| !matches!(c, std::path::Component::ParentDir))
            .collect();

        if !normalized.starts_with(instance_dir) {
            tracing::warn!(
                "[SECURITY] Path escape attempt blocked: {} -> {}",
                name,
                normalized.display()
            );
            continue;
        }

        let outpath = normalized;

        // Update progress periodically
        if i % 20 == 0 {
            let progress = 20 + ((i as u32 * 60) / total_files.max(1) as u32);
            let _ = app.emit(
                "sharing-progress",
                SharingProgressEvent {
                    operation_id: import_id.to_string(),
                    stage: "extracting".to_string(),
                    progress,
                    message: format!("Extracting {} of {} files...", i, total_files),
                },
            );
        }

        if file.is_dir() {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| AppError::Io(format!("Failed to create dir: {}", e)))?;
        } else {
            // Ensure parent directory exists
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Io(format!("Failed to create parent dir: {}", e)))?;
            }

            let mut outfile = File::create(&outpath).map_err(|e| {
                AppError::Io(format!("Failed to create {}: {}", outpath.display(), e))
            })?;

            std::io::copy(&mut file, &mut outfile).map_err(|e| {
                AppError::Io(format!("Failed to write {}: {}", outpath.display(), e))
            })?;
        }
    }

    Ok(())
}

/// Generate a unique instance name
async fn generate_unique_name(db: &SqlitePool, base_name: &str) -> AppResult<String> {
    let instances = Instance::get_all(db).await.map_err(AppError::Database)?;
    let existing_names: Vec<String> = instances.iter().map(|i| i.name.clone()).collect();

    if !existing_names.contains(&base_name.to_string()) {
        return Ok(base_name.to_string());
    }

    // Append number until we find a unique name
    for i in 1..100 {
        let name = format!("{} ({})", base_name, i);
        if !existing_names.contains(&name) {
            return Ok(name);
        }
    }

    // Fallback with UUID
    Ok(format!(
        "{}-{}",
        base_name,
        &Uuid::new_v4().to_string()[..8]
    ))
}

/// Sanitize instance name to game_dir
fn sanitize_game_dir(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | ' ' => '-',
            c => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// Emit progress event
fn emit_progress(app: &AppHandle, import_id: &str, stage: &str, progress: u32, message: &str) {
    let _ = app.emit(
        "sharing-progress",
        SharingProgressEvent {
            operation_id: import_id.to_string(),
            stage: stage.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}
