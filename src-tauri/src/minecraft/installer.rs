use crate::download::client::{download_file, download_files_parallel_with_progress};
use crate::error::{AppError, AppResult};
use crate::minecraft::versions::{Library, VersionDetails};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use zip::ZipArchive;

const RESOURCES_URL: &str = "https://resources.download.minecraft.net";
const LIBRARIES_URL: &str = "https://libraries.minecraft.net";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndex {
    pub objects: std::collections::HashMap<String, AssetObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Clone, serde::Serialize)]
pub struct InstallProgress {
    pub stage: String,
    pub current: u32,
    pub total: u32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

/// Emit progress event (legacy - without instance_id)
fn emit_progress(app: &AppHandle, stage: &str, current: u32, total: u32, message: &str) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            stage: stage.to_string(),
            current,
            total,
            message: message.to_string(),
            instance_id: None,
        },
    );
}

/// Emit progress event with instance_id
pub fn emit_progress_for_instance(
    app: &AppHandle,
    instance_id: &str,
    stage: &str,
    current: u32,
    total: u32,
    message: &str,
) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            stage: stage.to_string(),
            current,
            total,
            message: message.to_string(),
            instance_id: Some(instance_id.to_string()),
        },
    );
}

/// Install a Minecraft version into a specific instance directory
pub async fn install_instance(
    client: &reqwest::Client,
    instance_dir: &Path,
    version: &VersionDetails,
    app: &AppHandle,
) -> AppResult<()> {
    println!(
        "[INSTALLER] Starting installation for version: {} in {:?}",
        version.id, instance_dir
    );

    // Create instance subdirectories
    let client_dir = instance_dir.join("client");
    let libraries_dir = instance_dir.join("libraries");
    let assets_dir = instance_dir.join("assets");

    fs::create_dir_all(&client_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create client directory: {}", e)))?;

    // 1. Download client JAR (5% of total)
    emit_progress(
        app,
        "installing",
        0,
        100,
        "Telechargement du client Minecraft...",
    );
    println!("[INSTALLER] Step 1/3: Downloading client JAR...");
    download_client_to_instance(client, &client_dir, version).await?;
    emit_progress(app, "installing", 5, 100, "Client telecharge!");
    println!("[INSTALLER] Step 1/3: Client JAR downloaded!");

    // 2. Download libraries (5% - 30% of total)
    emit_progress(
        app,
        "installing",
        5,
        100,
        "Telechargement des bibliotheques...",
    );
    println!("[INSTALLER] Step 2/4: Downloading libraries...");
    download_libraries_to_instance_with_progress(client, &libraries_dir, version, app).await?;
    emit_progress(app, "installing", 30, 100, "Bibliotheques telechargees!");
    println!("[INSTALLER] Step 2/4: Libraries downloaded!");

    // 3. Extract natives (30% - 35% of total)
    let natives_dir = instance_dir.join("natives");
    emit_progress(
        app,
        "installing",
        30,
        100,
        "Extraction des natives...",
    );
    println!("[INSTALLER] Step 3/4: Extracting natives...");
    extract_natives(&libraries_dir, &natives_dir, version).await?;
    emit_progress(app, "installing", 35, 100, "Natives extraites!");
    println!("[INSTALLER] Step 3/4: Natives extracted!");

    // 4. Download assets (35% - 100% of total)
    emit_progress(app, "installing", 35, 100, "Telechargement des assets...");
    println!("[INSTALLER] Step 3/3: Downloading assets...");
    download_assets_to_instance_with_progress(client, &assets_dir, version, app).await?;
    emit_progress(app, "installing", 100, 100, "Installation terminee!");
    println!("[INSTALLER] Step 3/3: Assets downloaded!");

    // Mark as installed
    let installed_marker = instance_dir.join(".installed");
    fs::write(&installed_marker, &version.id)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write installed marker: {}", e)))?;

    println!(
        "[INSTALLER] Installation complete for version: {}",
        version.id
    );
    Ok(())
}

/// Check if an instance is fully installed
pub async fn is_instance_installed(instance_dir: &Path) -> bool {
    let installed_marker = instance_dir.join(".installed");

    if !installed_marker.exists() {
        println!("[IS_INSTALLED] {:?}: marker not found", instance_dir);
        return false;
    }

    // Read marker content to determine instance type
    let marker_content = tokio::fs::read_to_string(&installed_marker)
        .await
        .unwrap_or_default();

    let is_server = marker_content.trim() == "server";

    let is_installed = if is_server {
        // For servers, check for server.jar OR modern Forge/NeoForge markers
        let has_server_jar = instance_dir.join("server.jar").exists();
        let has_forge_modern = instance_dir.join(".forge_modern").exists();
        let has_neoforge_modern = instance_dir.join(".neoforge_modern").exists();

        // For modern Forge/NeoForge, check for run scripts or args files
        let has_run_script = instance_dir.join("run.sh").exists()
            || instance_dir.join("run.bat").exists()
            || instance_dir.join("unix_args.txt").exists()
            || instance_dir.join("win_args.txt").exists();

        has_server_jar || ((has_forge_modern || has_neoforge_modern) && has_run_script)
    } else {
        // For clients, check for client/client.jar
        instance_dir.join("client").join("client.jar").exists()
    };

    println!(
        "[IS_INSTALLED] {:?}: type={}, installed={}",
        instance_dir,
        if is_server { "server" } else { "client" },
        is_installed
    );

    is_installed
}

/// Download the client JAR to instance directory
async fn download_client_to_instance(
    client: &reqwest::Client,
    client_dir: &Path,
    version: &VersionDetails,
) -> AppResult<()> {
    let client_jar = client_dir.join("client.jar");
    let download = &version.downloads.client;

    download_file(client, &download.url, &client_jar, Some(&download.sha1)).await?;

    // Also save version info
    let version_file = client_dir.join("version.json");
    let version_json = serde_json::to_string_pretty(version)
        .map_err(|e| AppError::Io(format!("Failed to serialize version: {}", e)))?;
    fs::write(&version_file, version_json)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write version file: {}", e)))?;

    Ok(())
}

/// Download all required libraries to instance directory with progress
async fn download_libraries_to_instance_with_progress(
    client: &reqwest::Client,
    libraries_dir: &Path,
    version: &VersionDetails,
    app: &AppHandle,
) -> AppResult<()> {
    let mut downloads = Vec::new();

    println!(
        "[INSTALLER] Processing {} libraries...",
        version.libraries.len()
    );

    for lib in &version.libraries {
        // Check if library should be included based on rules
        if !should_include_library(lib) {
            continue;
        }

        if let Some(ref lib_downloads) = lib.downloads {
            if let Some(ref artifact) = lib_downloads.artifact {
                let dest = libraries_dir.join(&artifact.path);
                downloads.push((artifact.url.clone(), dest, Some(artifact.sha1.clone())));
            }

            // Handle natives if present
            if let Some(ref classifiers) = lib_downloads.classifiers {
                if let Some(native_key) = get_native_key() {
                    if let Some(native) = classifiers.get(&native_key) {
                        if let Some(native_obj) = native.as_object() {
                            if let (Some(url), Some(path), Some(sha1)) = (
                                native_obj.get("url").and_then(|v| v.as_str()),
                                native_obj.get("path").and_then(|v| v.as_str()),
                                native_obj.get("sha1").and_then(|v| v.as_str()),
                            ) {
                                let dest = libraries_dir.join(path);
                                downloads.push((url.to_string(), dest, Some(sha1.to_string())));
                            }
                        }
                    }
                }
            }
        } else {
            // Fallback: construct URL from library name
            let path = library_name_to_path(&lib.name);
            let url = format!("{}/{}", LIBRARIES_URL, path);
            let dest = libraries_dir.join(&path);
            downloads.push((url, dest, None));
        }
    }

    // Download libraries in parallel with progress
    let total_libs = downloads.len();
    println!("[INSTALLER] Downloading {} library files...", total_libs);

    let app_clone = app.clone();
    download_files_parallel_with_progress(client, downloads, 10, move |current, total| {
        // Libraries are 5% - 35% of total (30% range)
        let percent = 5 + ((current as u32 * 30) / total.max(1) as u32);
        emit_progress(
            &app_clone,
            "installing",
            percent,
            100,
            &format!("Bibliotheques: {}/{}", current, total),
        );
    })
    .await?;

    Ok(())
}

/// Download game assets to instance directory with progress
async fn download_assets_to_instance_with_progress(
    client: &reqwest::Client,
    assets_dir: &Path,
    version: &VersionDetails,
    app: &AppHandle,
) -> AppResult<()> {
    let indexes_dir = assets_dir.join("indexes");
    let objects_dir = assets_dir.join("objects");

    fs::create_dir_all(&indexes_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create indexes directory: {}", e)))?;

    // Download asset index
    let asset_index = &version.asset_index;
    let index_path = indexes_dir.join(format!("{}.json", asset_index.id));

    download_file(
        client,
        &asset_index.url,
        &index_path,
        Some(&asset_index.sha1),
    )
    .await?;

    // Parse asset index
    let index_content = fs::read_to_string(&index_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read asset index: {}", e)))?;

    let asset_index: AssetIndex = serde_json::from_str(&index_content)
        .map_err(|e| AppError::Io(format!("Failed to parse asset index: {}", e)))?;

    // Prepare downloads
    let mut downloads = Vec::new();
    println!(
        "[INSTALLER] Processing {} assets...",
        asset_index.objects.len()
    );

    for object in asset_index.objects.values() {
        let hash_prefix = &object.hash[..2];
        let object_path = objects_dir.join(hash_prefix).join(&object.hash);
        let url = format!("{}/{}/{}", RESOURCES_URL, hash_prefix, object.hash);

        downloads.push((url, object_path, Some(object.hash.clone())));
    }

    // Download assets in parallel with progress
    let total_assets = downloads.len();
    println!("[INSTALLER] Downloading {} asset files...", total_assets);

    let app_clone = app.clone();
    download_files_parallel_with_progress(client, downloads, 20, move |current, total| {
        // Assets are 35% - 100% of total (65% range)
        let percent = 35 + ((current as u32 * 65) / total.max(1) as u32);
        emit_progress(
            &app_clone,
            "installing",
            percent,
            100,
            &format!("Assets: {}/{}", current, total),
        );
    })
    .await?;

    Ok(())
}

/// Check if a library should be included based on rules
fn should_include_library(lib: &Library) -> bool {
    let rules = match &lib.rules {
        Some(rules) => rules,
        None => return true,
    };

    let mut allowed = false;

    for rule in rules {
        let action_allow = rule.action == "allow";

        // Check OS rule
        if let Some(ref os) = rule.os {
            let os_matches = match os.name.as_deref() {
                Some("osx") | Some("macos") => cfg!(target_os = "macos"),
                Some("windows") => cfg!(target_os = "windows"),
                Some("linux") => cfg!(target_os = "linux"),
                _ => true,
            };

            if os_matches {
                allowed = action_allow;
            }
        } else {
            // No OS restriction, applies to all
            allowed = action_allow;
        }
    }

    allowed
}

/// Get the native library key for the current OS
fn get_native_key() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        Some("natives-osx".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Some("natives-windows".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        Some("natives-linux".to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

/// Extract native libraries from JARs to the natives directory
/// This extracts .dll (Windows), .so (Linux), and .dylib (macOS) files
async fn extract_natives(
    libraries_dir: &Path,
    natives_dir: &Path,
    version: &VersionDetails,
) -> AppResult<()> {
    // Create natives directory
    fs::create_dir_all(natives_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create natives directory: {}", e)))?;

    let native_key = match get_native_key() {
        Some(key) => key,
        None => return Ok(()), // No natives for this OS
    };

    println!("[INSTALLER] Extracting natives with key: {}", native_key);

    for lib in &version.libraries {
        // Check if library should be included
        if !should_include_library(lib) {
            continue;
        }

        // Check if this library has natives for our OS
        if let Some(ref lib_downloads) = lib.downloads {
            if let Some(ref classifiers) = lib_downloads.classifiers {
                if let Some(native) = classifiers.get(&native_key) {
                    if let Some(native_obj) = native.as_object() {
                        if let Some(path) = native_obj.get("path").and_then(|v| v.as_str()) {
                            let native_jar = libraries_dir.join(path);
                            if native_jar.exists() {
                                if let Err(e) = extract_native_jar(&native_jar, natives_dir).await {
                                    println!(
                                        "[INSTALLER] Warning: Failed to extract natives from {}: {}",
                                        path, e
                                    );
                                } else {
                                    println!("[INSTALLER] Extracted natives from: {}", path);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Also check for natives specified in the library name (e.g., lwjgl:lwjgl:3.3.3:natives-windows)
        if lib.name.contains(&native_key) || lib.name.contains("natives") {
            let path = library_name_to_path(&lib.name);
            let native_jar = libraries_dir.join(&path);
            if native_jar.exists() {
                if let Err(e) = extract_native_jar(&native_jar, natives_dir).await {
                    println!(
                        "[INSTALLER] Warning: Failed to extract natives from {}: {}",
                        path, e
                    );
                } else {
                    println!("[INSTALLER] Extracted natives from: {}", path);
                }
            }
        }
    }

    Ok(())
}

/// Extract native files (.dll, .so, .dylib) from a JAR file
async fn extract_native_jar(jar_path: &Path, natives_dir: &Path) -> AppResult<()> {
    let jar_data = fs::read(jar_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read native JAR: {}", e)))?;

    let cursor = Cursor::new(jar_data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Failed to open native JAR as zip: {}", e)))?;

    let natives_dir = natives_dir.to_path_buf();

    // Extract in blocking context since zip crate is sync
    tokio::task::spawn_blocking(move || {
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| {
                AppError::Io(format!("Failed to read zip entry: {}", e))
            })?;

            let name = file.name().to_string();

            // Only extract native library files, skip META-INF and other files
            let is_native = name.ends_with(".dll")
                || name.ends_with(".so")
                || name.ends_with(".dylib")
                || name.ends_with(".jnilib");

            if !is_native || name.contains("META-INF") {
                continue;
            }

            // Get just the filename (strip any directory prefix)
            let filename = Path::new(&name)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or(name.clone());

            let dest_path = natives_dir.join(&filename);

            // Create file and copy contents
            let mut dest_file = std::fs::File::create(&dest_path).map_err(|e| {
                AppError::Io(format!("Failed to create native file {}: {}", filename, e))
            })?;

            std::io::copy(&mut file, &mut dest_file).map_err(|e| {
                AppError::Io(format!("Failed to extract native file {}: {}", filename, e))
            })?;
        }

        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Io(format!("Native extraction task failed: {}", e)))??;

    Ok(())
}

/// Convert library name to path (e.g., "com.mojang:text:1.0" -> "com/mojang/text/1.0/text-1.0.jar")
/// Also handles classifiers: "group:artifact:version:classifier" -> "group/artifact/version/artifact-version-classifier.jar"
/// Strips @extension suffixes (e.g., "@jar") from version/classifier
fn library_name_to_path(name: &str) -> String {
    // Strip @extension suffix if present (e.g., "3.13.0@jar" -> "3.13.0")
    let name = name.split('@').next().unwrap_or(name);

    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return name.replace(':', "/") + ".jar";
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    if parts.len() >= 4 {
        // Has classifier (e.g., net.neoforged:mergetool:2.0.0:api)
        let classifier = parts[3];
        format!(
            "{}/{}/{}/{}-{}-{}.jar",
            group, artifact, version, artifact, version, classifier
        )
    } else {
        format!(
            "{}/{}/{}/{}-{}.jar",
            group, artifact, version, artifact, version
        )
    }
}

/// Extract artifact key from library name for deduplication
/// Format: group:artifact for regular libs, group:artifact:classifier for natives
/// This prevents natives from being deduplicated against their base library
/// Strips @extension suffixes (e.g., "@jar") before processing
fn get_artifact_key(name: &str) -> String {
    // Strip @extension suffix if present (e.g., "3.13.0@jar" -> "3.13.0")
    let name = name.split('@').next().unwrap_or(name);

    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() >= 4 {
        // Has classifier (e.g., org.lwjgl:lwjgl:3.3.3:natives-macos)
        format!("{}:{}:{}", parts[0], parts[1], parts[3])
    } else if parts.len() >= 2 {
        // Regular library (e.g., org.ow2.asm:asm:9.6)
        format!("{}:{}", parts[0], parts[1])
    } else {
        name.to_string()
    }
}

/// Get the classpath for an instance
/// For NeoForge/Forge, the vanilla client.jar is replaced by the patched client, so we skip it
pub fn get_instance_classpath(
    instance_dir: &Path,
    version: &VersionDetails,
    loader: Option<&str>,
) -> Vec<PathBuf> {
    let libraries_dir = instance_dir.join("libraries");
    let is_neoforge_or_forge = loader
        .map(|l| l == "neoforge" || l == "forge")
        .unwrap_or(false);
    let mut classpath = Vec::new();
    let mut seen_artifacts: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut found = 0;
    let mut missing = 0;
    let mut skipped = 0;
    let mut deduplicated = 0;

    println!(
        "[CLASSPATH] Building classpath from {} libraries",
        version.libraries.len()
    );

    for lib in &version.libraries {
        if !should_include_library(lib) {
            skipped += 1;
            continue;
        }

        // Deduplicate by artifact key (group:artifact)
        // Loader libraries are inserted first, so they take precedence
        let artifact_key = get_artifact_key(&lib.name);
        if seen_artifacts.contains(&artifact_key) {
            println!(
                "[CLASSPATH] Skipping duplicate artifact: {} (keeping earlier version)",
                lib.name
            );
            deduplicated += 1;
            continue;
        }
        seen_artifacts.insert(artifact_key);

        if let Some(ref downloads) = lib.downloads {
            if let Some(ref artifact) = downloads.artifact {
                let path = libraries_dir.join(&artifact.path);
                if path.exists() {
                    classpath.push(path);
                    found += 1;
                } else {
                    println!(
                        "[CLASSPATH] MISSING (downloads): {} -> {:?}",
                        lib.name, path
                    );
                    missing += 1;
                }
            }
        } else {
            let lib_path = library_name_to_path(&lib.name);
            let path = libraries_dir.join(&lib_path);
            if path.exists() {
                classpath.push(path);
                found += 1;
            } else {
                println!("[CLASSPATH] MISSING (name): {} -> {:?}", lib.name, path);
                missing += 1;
            }
        }
    }

    // Add client JAR (skip for NeoForge/Forge as they use a patched client)
    if !is_neoforge_or_forge {
        let client_jar = instance_dir.join("client").join("client.jar");
        if client_jar.exists() {
            println!("[CLASSPATH] Client JAR: {:?}", client_jar);
        } else {
            println!("[CLASSPATH] MISSING CLIENT JAR: {:?}", client_jar);
        }
        classpath.push(client_jar);
    } else {
        println!("[CLASSPATH] Skipping vanilla client.jar (NeoForge/Forge uses patched client)");
    }

    println!(
        "[CLASSPATH] Summary: {} found, {} missing, {} skipped (rules), {} deduplicated",
        found, missing, skipped, deduplicated
    );

    classpath
}
