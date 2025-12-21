//! NeoForge installer processor execution
//! Uses the NeoForge installer JAR directly via a Java wrapper for simpler installation

use crate::download::client::download_file;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use zip::ZipArchive;

// Windows-specific: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
#[allow(dead_code)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases";
const MC_LIBRARIES: &str = "https://libraries.minecraft.net";

/// NeoForge install profile structure
#[derive(Debug, Deserialize)]
pub struct InstallProfile {
    #[allow(dead_code)]
    pub minecraft: String,
    pub data: HashMap<String, DataEntry>,
    pub processors: Vec<Processor>,
    pub libraries: Vec<ProfileLibrary>,
}

#[derive(Debug, Deserialize)]
pub struct DataEntry {
    pub client: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub server: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Processor {
    #[serde(default)]
    pub sides: Vec<String>,
    pub jar: String,
    pub classpath: Vec<String>,
    pub args: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProfileLibrary {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
}

#[derive(Debug, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<LibraryArtifact>,
}

#[derive(Debug, Deserialize)]
pub struct LibraryArtifact {
    #[allow(dead_code)]
    pub path: String,
    pub url: String,
    pub sha1: Option<String>,
}

/// Information extracted from install_profile.json
#[derive(Debug, Clone, Serialize)]
pub struct NeoForgeInstallInfo {
    pub neoform_version: String,
    pub mc_version: String,
}

/// Extract install_profile.json from NeoForge installer
pub fn extract_install_profile(installer_bytes: &[u8]) -> AppResult<InstallProfile> {
    let cursor = Cursor::new(installer_bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

    let mut file = archive
        .by_name("install_profile.json")
        .map_err(|e| AppError::Io(format!("install_profile.json not found: {}", e)))?;

    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| AppError::Io(format!("Failed to read install_profile.json: {}", e)))?;

    serde_json::from_str(&contents)
        .map_err(|e| AppError::Io(format!("Failed to parse install_profile.json: {}", e)))
}

/// Extract neoform version from install profile
pub fn get_neoform_version(profile: &InstallProfile) -> Option<String> {
    if let Some(mcp_version) = profile.data.get("MCP_VERSION") {
        // The version is in format "'1.21.10-20251010.172816'" - remove quotes
        let version = mcp_version.client.trim_matches('\'').to_string();
        // Extract just the timestamp part (after the dash)
        if let Some(pos) = version.rfind('-') {
            return Some(version[pos + 1..].to_string());
        }
        return Some(version);
    }
    None
}

/// Run NeoForge installer using the simplified wrapper approach
pub async fn run_processors(
    client: &reqwest::Client,
    installer_bytes: &[u8],
    instance_dir: &Path,
    _data_dir: &Path,
    mc_version: &str,
    java_path: &str,
    app: &AppHandle,
) -> AppResult<NeoForgeInstallInfo> {
    let profile = extract_install_profile(installer_bytes)?;
    let libraries_dir = instance_dir.join("libraries");

    let neoform_version = get_neoform_version(&profile).unwrap_or_else(|| mc_version.to_string());

    println!("[NEOFORGE] NeoForm version: {}", neoform_version);
    println!("[NEOFORGE] Using simplified installer approach");

    emit_progress(
        app,
        "processor",
        0,
        100,
        "Préparation de l'installation NeoForge...",
    );

    // Create a temporary directory for the installer to work in
    let install_dir = instance_dir.join(".neoforge_install");
    tokio::fs::create_dir_all(&install_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create install directory: {}", e)))?;

    // Save the installer JAR
    let installer_path = install_dir.join("installer.jar");
    tokio::fs::write(&installer_path, installer_bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to save installer: {}", e)))?;

    // Create required launcher_profiles.json (needed by NeoForge installer)
    let launcher_profiles = install_dir.join("launcher_profiles.json");
    let profiles_content = serde_json::json!({
        "profiles": {},
        "selectedProfile": "",
        "clientToken": "kaizen-launcher",
        "authenticationDatabase": {},
        "launcherVersion": {
            "name": "Kaizen",
            "format": 21,
            "profilesFormat": 1
        }
    });
    let profiles_json = serde_json::to_string_pretty(&profiles_content)
        .map_err(|e| AppError::Io(format!("Failed to serialize launcher_profiles.json: {}", e)))?;
    tokio::fs::write(&launcher_profiles, profiles_json)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create launcher_profiles.json: {}", e)))?;

    // Create versions directory (where the installer will put version JSON)
    let versions_dir = install_dir.join("versions");
    tokio::fs::create_dir_all(&versions_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create versions directory: {}", e)))?;

    // Create libraries directory in the install dir
    let install_libraries_dir = install_dir.join("libraries");
    tokio::fs::create_dir_all(&install_libraries_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create libraries directory: {}", e)))?;

    // First, try the simple headless approach with --installClient if supported
    emit_progress(
        app,
        "processor",
        10,
        100,
        "Exécution de l'installeur NeoForge...",
    );

    // Try running installer with headless property
    let result =
        run_neoforge_installer_headless(java_path, &installer_path, &install_dir, app).await;

    match result {
        Ok(_) => {
            println!("[NEOFORGE] Installer completed successfully");
        }
        Err(e) => {
            println!(
                "[NEOFORGE] Headless installer failed: {}, falling back to manual method",
                e
            );

            // Fall back to downloading libraries manually
            emit_progress(
                app,
                "processor",
                20,
                100,
                "Téléchargement des bibliothèques (méthode alternative)...",
            );

            // Download all data files and libraries
            download_all_neoforge_files(client, &libraries_dir, &profile, installer_bytes, app)
                .await?;

            // Run processors manually
            emit_progress(app, "processor", 50, 100, "Exécution des processeurs...");

            run_processors_manual(
                &profile,
                instance_dir,
                &libraries_dir,
                installer_bytes,
                mc_version,
                java_path,
                app,
            )
            .await?;
        }
    }

    // Copy libraries from install directory to instance if they exist
    if install_libraries_dir.exists() {
        emit_progress(app, "processor", 90, 100, "Copie des fichiers...");
        copy_directory_contents(&install_libraries_dir, &libraries_dir).await?;
    }

    // Clean up install directory
    let _ = tokio::fs::remove_dir_all(&install_dir).await;

    emit_progress(
        app,
        "processor",
        100,
        100,
        "Installation NeoForge terminée!",
    );

    Ok(NeoForgeInstallInfo {
        neoform_version,
        mc_version: mc_version.to_string(),
    })
}

/// Run the NeoForge installer in headless mode
async fn run_neoforge_installer_headless(
    java_path: &str,
    installer_path: &Path,
    install_dir: &Path,
    _app: &AppHandle,
) -> AppResult<()> {
    println!(
        "[NEOFORGE] Running installer in headless mode from: {:?}",
        install_dir
    );

    // Run with java.awt.headless and try to install client
    let mut cmd = Command::new(java_path);
    cmd.current_dir(install_dir)
        .arg("-Djava.awt.headless=true")
        .arg("-jar")
        .arg(installer_path)
        .arg("--installClient")
        .arg(install_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Launcher(format!("Failed to run installer: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    println!("[NEOFORGE] Installer stdout: {}", stdout);
    println!("[NEOFORGE] Installer stderr: {}", stderr);

    if !output.status.success() {
        // Check if it's just a "no GUI" error - we might still be able to proceed
        if stderr.contains("HeadlessException") || stderr.contains("no X11") {
            return Err(AppError::Launcher(
                "Installer requires GUI, falling back".to_string(),
            ));
        }
        return Err(AppError::Launcher(format!(
            "Installer failed with status {}: {}",
            output.status, stderr
        )));
    }

    Ok(())
}

/// Download all NeoForge files (data files + processor libraries)
async fn download_all_neoforge_files(
    client: &reqwest::Client,
    libraries_dir: &Path,
    profile: &InstallProfile,
    installer_bytes: &[u8],
    app: &AppHandle,
) -> AppResult<()> {
    // Download data files (mappings, etc.)
    download_data_files(client, libraries_dir, &profile.data, installer_bytes).await?;

    emit_progress(
        app,
        "processor",
        35,
        100,
        "Téléchargement des outils de traitement...",
    );

    // Download processor libraries
    download_processor_libraries(client, libraries_dir, &profile.libraries, installer_bytes)
        .await?;

    Ok(())
}

/// Run processors manually (fallback method)
async fn run_processors_manual(
    profile: &InstallProfile,
    instance_dir: &Path,
    libraries_dir: &Path,
    installer_bytes: &[u8],
    mc_version: &str,
    java_path: &str,
    app: &AppHandle,
) -> AppResult<()> {
    // Save installer JAR temporarily for processor access
    let installer_path = instance_dir.join("installer.jar");
    tokio::fs::write(&installer_path, installer_bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to save installer: {}", e)))?;

    // Get client JAR path
    let client_jar = instance_dir.join("client").join("client.jar");

    // Build data variables
    let data_vars = build_data_variables(
        profile,
        instance_dir,
        &client_jar,
        &installer_path,
        mc_version,
    );

    // Run each processor (client side only)
    let client_processors: Vec<_> = profile
        .processors
        .iter()
        .filter(|p| p.sides.is_empty() || p.sides.contains(&"client".to_string()))
        .collect();

    let total = client_processors.len();
    for (i, processor) in client_processors.iter().enumerate() {
        let percent = 50 + ((i as u32 * 40) / total.max(1) as u32);
        let task_name = extract_task_name(&processor.args);
        emit_progress(
            app,
            "processor",
            percent,
            100,
            &format!("Processeur: {}", task_name),
        );

        if let Err(e) = run_single_processor(processor, libraries_dir, &data_vars, java_path).await
        {
            println!("[NEOFORGE] Processor {} failed: {}", processor.jar, e);
            // Continue with other processors instead of failing immediately
        }
    }

    // Clean up installer
    let _ = tokio::fs::remove_file(&installer_path).await;

    Ok(())
}

fn emit_progress(app: &AppHandle, stage: &str, current: u32, total: u32, message: &str) {
    let _ = app.emit(
        "install-progress",
        serde_json::json!({
            "stage": stage,
            "current": current,
            "total": total,
            "message": message,
        }),
    );
}

fn extract_task_name(args: &[String]) -> String {
    for (i, arg) in args.iter().enumerate() {
        if arg == "--task" && i + 1 < args.len() {
            return args[i + 1].clone();
        }
    }
    "Unknown".to_string()
}

/// Download data files (mappings, etc.) referenced in profile.data
async fn download_data_files(
    client: &reqwest::Client,
    libraries_dir: &Path,
    data: &HashMap<String, DataEntry>,
    installer_bytes: &[u8],
) -> AppResult<()> {
    // Collect artifact references from data entries
    let mut artifacts_to_download: Vec<(String, std::path::PathBuf)> = Vec::new();

    for entry in data.values() {
        let value = &entry.client;

        // Check if it's an artifact reference like [net.neoforged.neoform:neoform:1.21.10-20251010.172816:mappings@tsrg.lzma]
        if value.starts_with('[') && value.ends_with(']') {
            let artifact = &value[1..value.len() - 1];
            let path = artifact_to_path(artifact);
            let dest = libraries_dir.join(&path);

            if !dest.exists() {
                artifacts_to_download.push((artifact.to_string(), dest));
            }
        }
    }

    if artifacts_to_download.is_empty() {
        println!("[NEOFORGE] No data files to download");
        return Ok(());
    }

    println!(
        "[NEOFORGE] Need to download {} data files",
        artifacts_to_download.len()
    );

    // First, try to extract from installer JAR
    let mut extracted: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
        let cursor = Cursor::new(installer_bytes);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

        for (artifact, dest) in &artifacts_to_download {
            let path = artifact_to_path(artifact);
            let maven_path = format!("maven/{}", path);

            if let Ok(mut file) = archive.by_name(&maven_path) {
                let mut contents = Vec::new();
                if file.read_to_end(&mut contents).is_ok() {
                    if let Some(parent) = dest.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    if std::fs::write(dest, contents).is_ok() {
                        println!("[NEOFORGE] Extracted data file: {}", artifact);
                        extracted.insert(artifact.clone());
                    }
                }
            }
        }
    }

    // Download remaining files from maven
    for (artifact, dest) in artifacts_to_download {
        if extracted.contains(&artifact) {
            continue;
        }

        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
        }

        let path = artifact_to_path(&artifact);

        // Try NeoForge maven
        let url = format!("{}/{}", NEOFORGE_MAVEN, path);
        println!(
            "[NEOFORGE] Downloading data file: {} from {}",
            artifact, url
        );

        if download_file(client, &url, &dest, None).await.is_ok() {
            println!("[NEOFORGE] Downloaded data file: {}", artifact);
            continue;
        }

        // Try Minecraft libraries as fallback
        let mc_url = format!("{}/{}", MC_LIBRARIES, path);
        if download_file(client, &mc_url, &dest, None).await.is_ok() {
            println!("[NEOFORGE] Downloaded data file from MC: {}", artifact);
            continue;
        }

        println!(
            "[NEOFORGE] WARNING: Could not download data file: {}",
            artifact
        );
    }

    Ok(())
}

/// Download processor libraries from installer or maven
async fn download_processor_libraries(
    client: &reqwest::Client,
    libraries_dir: &Path,
    libraries: &[ProfileLibrary],
    installer_bytes: &[u8],
) -> AppResult<()> {
    // First pass: extract all available files from the archive synchronously
    // to avoid holding ZipFile across await points
    let mut extracted_files: Vec<(std::path::PathBuf, Vec<u8>, String)> = Vec::new();
    #[allow(clippy::type_complexity)]
    let mut need_download: Vec<(std::path::PathBuf, String, Option<(String, Option<String>)>)> =
        Vec::new();

    {
        let cursor = Cursor::new(installer_bytes);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

        for lib in libraries {
            let path = library_name_to_path(&lib.name);
            let dest = libraries_dir.join(&path);

            if dest.exists() {
                continue;
            }

            // Try to extract from installer's maven directory
            let maven_path = format!("maven/{}", path);
            if let Ok(mut file) = archive.by_name(&maven_path) {
                let mut contents = Vec::new();
                if file.read_to_end(&mut contents).is_ok() {
                    extracted_files.push((dest, contents, lib.name.clone()));
                    continue;
                }
            }

            // Mark for download
            let download_info = lib
                .downloads
                .as_ref()
                .and_then(|d| d.artifact.as_ref())
                .filter(|a| !a.url.is_empty())
                .map(|a| (a.url.clone(), a.sha1.clone()));
            need_download.push((dest, lib.name.clone(), download_info));
        }
    } // archive is dropped here

    // Second pass: write extracted files asynchronously
    for (dest, contents, name) in extracted_files {
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
        }
        tokio::fs::write(&dest, contents)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write library: {}", e)))?;
        println!("[NEOFORGE] Extracted: {}", name);
    }

    // Third pass: download missing libraries
    for (dest, name, download_info) in need_download {
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
        }

        // Try downloading from provided URL
        if let Some((url, sha1)) = download_info {
            if download_file(client, &url, &dest, sha1.as_deref())
                .await
                .is_ok()
            {
                println!("[NEOFORGE] Downloaded: {}", name);
                continue;
            }
        }

        let path = library_name_to_path(&name);

        // Try NeoForge maven
        let url = format!("{}/{}", NEOFORGE_MAVEN, path);
        if download_file(client, &url, &dest, None).await.is_ok() {
            println!("[NEOFORGE] Downloaded from NeoForge maven: {}", name);
            continue;
        }

        // Try Minecraft libraries
        let mc_url = format!("{}/{}", MC_LIBRARIES, path);
        if download_file(client, &mc_url, &dest, None).await.is_ok() {
            println!("[NEOFORGE] Downloaded from MC libraries: {}", name);
            continue;
        }

        println!("[NEOFORGE] WARNING: Could not obtain: {}", name);
    }

    Ok(())
}

/// Build data variables for processor argument substitution
fn build_data_variables(
    profile: &InstallProfile,
    instance_dir: &Path,
    client_jar: &Path,
    installer_path: &Path,
    mc_version: &str,
) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    let libraries_dir = instance_dir.join("libraries");

    // Standard variables
    vars.insert(
        "ROOT".to_string(),
        instance_dir.to_string_lossy().to_string(),
    );
    vars.insert(
        "INSTALLER".to_string(),
        installer_path.to_string_lossy().to_string(),
    );
    vars.insert(
        "MINECRAFT_JAR".to_string(),
        client_jar.to_string_lossy().to_string(),
    );
    vars.insert("SIDE".to_string(), "client".to_string());
    vars.insert("MINECRAFT_VERSION".to_string(), mc_version.to_string());

    // Add data entries from install_profile
    for (key, entry) in &profile.data {
        let value = &entry.client;

        // Handle artifact references like [net.minecraft:client:1.21.10:mappings@txt]
        if value.starts_with('[') && value.ends_with(']') {
            let artifact = &value[1..value.len() - 1];
            let path = artifact_to_path(artifact);
            let full_path = libraries_dir.join(&path);
            vars.insert(key.clone(), full_path.to_string_lossy().to_string());
        } else if value.starts_with('/') {
            // Installer-relative path
            vars.insert(key.clone(), value.clone());
        } else {
            // Literal value (remove quotes)
            vars.insert(key.clone(), value.trim_matches('\'').to_string());
        }
    }

    vars
}

/// Convert artifact reference to file path
fn artifact_to_path(artifact: &str) -> String {
    // Format: group:artifact:version[:classifier][@extension]
    let (artifact_part, extension) = if let Some(pos) = artifact.find('@') {
        (&artifact[..pos], &artifact[pos + 1..])
    } else {
        (artifact, "jar")
    };

    let parts: Vec<&str> = artifact_part.split(':').collect();
    if parts.len() < 3 {
        return format!("{}.{}", artifact_part.replace(':', "/"), extension);
    }

    let group = parts[0].replace('.', "/");
    let name = parts[1];
    let version = parts[2];

    if parts.len() >= 4 {
        let classifier = parts[3];
        format!(
            "{}/{}/{}/{}-{}-{}.{}",
            group, name, version, name, version, classifier, extension
        )
    } else {
        format!(
            "{}/{}/{}/{}-{}.{}",
            group, name, version, name, version, extension
        )
    }
}

/// Run a single processor
async fn run_single_processor(
    processor: &Processor,
    libraries_dir: &Path,
    data_vars: &HashMap<String, String>,
    java_path: &str,
) -> AppResult<()> {
    // Build classpath
    let mut classpath_entries = Vec::new();
    for cp in &processor.classpath {
        let path = library_name_to_path(cp);
        let full_path = libraries_dir.join(&path);
        if full_path.exists() {
            classpath_entries.push(full_path.to_string_lossy().to_string());
        }
    }

    // Add main jar
    let main_jar_path = library_name_to_path(&processor.jar);
    let main_jar = libraries_dir.join(&main_jar_path);
    if main_jar.exists() {
        classpath_entries.push(main_jar.to_string_lossy().to_string());
    }

    let classpath = classpath_entries.join(if cfg!(windows) { ";" } else { ":" });

    // Substitute variables in arguments
    let args: Vec<String> = processor
        .args
        .iter()
        .map(|arg| substitute_variables(arg, data_vars, libraries_dir))
        .collect();

    println!(
        "[NEOFORGE] Running: {} with args: {:?}",
        processor.jar, args
    );

    // Get main class from JAR manifest
    let main_class = get_jar_main_class(&main_jar)?;

    let mut cmd = Command::new(java_path);
    cmd.arg("-cp")
        .arg(&classpath)
        .arg(&main_class)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Launcher(format!("Failed to run processor: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        println!("[NEOFORGE] STDOUT: {}", stdout);
        println!("[NEOFORGE] STDERR: {}", stderr);
        return Err(AppError::Launcher(format!(
            "Processor {} failed: {}",
            processor.jar, stderr
        )));
    }

    println!("[NEOFORGE] Success: {}", processor.jar);
    Ok(())
}

/// Substitute variables in argument string
fn substitute_variables(arg: &str, vars: &HashMap<String, String>, libraries_dir: &Path) -> String {
    let mut result = arg.to_string();

    // Handle {VAR} format
    for (key, value) in vars {
        result = result.replace(&format!("{{{}}}", key), value);
    }

    // Handle [artifact:reference] format - convert to path
    while let Some(start) = result.find('[') {
        if let Some(end) = result[start..].find(']') {
            let artifact = &result[start + 1..start + end];
            let path = artifact_to_path(artifact);
            let full_path = libraries_dir.join(&path);
            result = format!(
                "{}{}{}",
                &result[..start],
                full_path.to_string_lossy(),
                &result[start + end + 1..]
            );
        } else {
            break;
        }
    }

    result
}

/// Get main class from JAR manifest
fn get_jar_main_class(jar_path: &Path) -> AppResult<String> {
    let file = std::fs::File::open(jar_path)
        .map_err(|e| AppError::Io(format!("Failed to open JAR: {}", e)))?;

    let mut archive =
        ZipArchive::new(file).map_err(|e| AppError::Io(format!("Failed to read JAR: {}", e)))?;

    let mut manifest = archive
        .by_name("META-INF/MANIFEST.MF")
        .map_err(|e| AppError::Io(format!("MANIFEST.MF not found: {}", e)))?;

    let mut contents = String::new();
    manifest
        .read_to_string(&mut contents)
        .map_err(|e| AppError::Io(format!("Failed to read manifest: {}", e)))?;

    for line in contents.lines() {
        if let Some(stripped) = line.strip_prefix("Main-Class:") {
            return Ok(stripped.trim().to_string());
        }
    }

    Err(AppError::Io("Main-Class not found in manifest".to_string()))
}

/// Convert library name to path
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

/// Copy directory contents recursively
async fn copy_directory_contents(src: &Path, dst: &Path) -> AppResult<()> {
    if !src.exists() {
        return Ok(());
    }

    tokio::fs::create_dir_all(dst)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create destination directory: {}", e)))?;

    let mut entries = tokio::fs::read_dir(src)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read source directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            Box::pin(copy_directory_contents(&src_path, &dst_path)).await?;
        } else {
            // Don't overwrite existing files
            if !dst_path.exists() {
                tokio::fs::copy(&src_path, &dst_path)
                    .await
                    .map_err(|e| AppError::Io(format!("Failed to copy file: {}", e)))?;
            }
        }
    }

    Ok(())
}
