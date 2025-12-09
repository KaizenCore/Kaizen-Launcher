//! Modloader installer
//! Handles installing Fabric, Quilt, Forge, NeoForge loaders

use crate::download::client::download_file;
use crate::error::{AppError, AppResult};
use crate::minecraft::versions::VersionDetails;
use crate::modloader::{fabric, forge, neoforge, quilt, LoaderType};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};
use std::path::Path;
use tauri::{AppHandle, Emitter};
use zip::ZipArchive;

const FABRIC_MAVEN: &str = "https://maven.fabricmc.net";
const QUILT_MAVEN: &str = "https://maven.quiltmc.org/repository/release";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderProfile {
    pub id: String,
    #[serde(rename = "inheritsFrom")]
    pub inherits_from: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub libraries: Vec<LoaderLibrary>,
    /// JVM arguments from the modloader (for NeoForge BootstrapLauncher)
    #[serde(default)]
    pub jvm_args: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderLibrary {
    pub name: String,
    pub url: Option<String>,
}

/// Install a modloader for an instance
pub async fn install_loader(
    client: &reqwest::Client,
    instance_dir: &Path,
    loader_type: LoaderType,
    mc_version: &str,
    loader_version: &str,
    app: &AppHandle,
) -> AppResult<LoaderProfile> {
    println!(
        "[LOADER] Installing {:?} {} for MC {}",
        loader_type, loader_version, mc_version
    );

    emit_loader_progress(
        app,
        "loader",
        0,
        100,
        &format!("Installation de {:?}...", loader_type),
    );

    match loader_type {
        LoaderType::Fabric => {
            install_fabric(client, instance_dir, mc_version, loader_version, app).await
        }
        LoaderType::Quilt => {
            install_quilt(client, instance_dir, mc_version, loader_version, app).await
        }
        LoaderType::Forge => {
            install_forge(client, instance_dir, mc_version, loader_version, app).await
        }
        LoaderType::NeoForge => {
            install_neoforge(client, instance_dir, mc_version, loader_version, app).await
        }
        _ => Err(AppError::Instance(format!(
            "Loader {:?} installation not yet supported",
            loader_type
        ))),
    }
}

fn emit_loader_progress(app: &AppHandle, stage: &str, current: u32, total: u32, message: &str) {
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

/// Install Fabric loader
async fn install_fabric(
    client: &reqwest::Client,
    instance_dir: &Path,
    mc_version: &str,
    loader_version: &str,
    app: &AppHandle,
) -> AppResult<LoaderProfile> {
    emit_loader_progress(app, "loader", 10, 100, "Telechargement du profil Fabric...");

    // Fetch the Fabric profile
    let profile = fabric::fetch_profile(client, mc_version, loader_version).await?;

    emit_loader_progress(
        app,
        "loader",
        30,
        100,
        "Telechargement des bibliotheques Fabric...",
    );

    // Download Fabric libraries
    let libraries_dir = instance_dir.join("libraries");
    download_loader_libraries(
        client,
        &libraries_dir,
        &profile.libraries,
        FABRIC_MAVEN,
        app,
        30,
        90,
    )
    .await?;

    emit_loader_progress(app, "loader", 100, 100, "Fabric installe!");

    Ok(LoaderProfile {
        id: profile.id,
        inherits_from: profile.inherits_from,
        main_class: profile.main_class,
        libraries: profile
            .libraries
            .into_iter()
            .map(|l| LoaderLibrary {
                name: l.name,
                url: Some(l.url),
            })
            .collect(),
        jvm_args: Vec::new(),
    })
}

/// Install Quilt loader
async fn install_quilt(
    client: &reqwest::Client,
    instance_dir: &Path,
    mc_version: &str,
    loader_version: &str,
    app: &AppHandle,
) -> AppResult<LoaderProfile> {
    emit_loader_progress(app, "loader", 10, 100, "Telechargement du profil Quilt...");

    // Fetch the Quilt profile
    let profile = quilt::fetch_profile(client, mc_version, loader_version).await?;

    emit_loader_progress(
        app,
        "loader",
        30,
        100,
        "Telechargement des bibliotheques Quilt...",
    );

    // Download Quilt libraries
    let libraries_dir = instance_dir.join("libraries");
    let quilt_libs: Vec<LoaderLibrary> = profile
        .libraries
        .into_iter()
        .map(|l| LoaderLibrary {
            name: l.name,
            url: l.url,
        })
        .collect();

    download_loader_libraries_generic(
        client,
        &libraries_dir,
        &quilt_libs,
        QUILT_MAVEN,
        app,
        30,
        90,
    )
    .await?;

    emit_loader_progress(app, "loader", 100, 100, "Quilt installe!");

    Ok(LoaderProfile {
        id: profile.id,
        inherits_from: profile.inherits_from,
        main_class: profile.main_class,
        libraries: quilt_libs,
        jvm_args: Vec::new(),
    })
}

/// Install Forge loader
async fn install_forge(
    client: &reqwest::Client,
    instance_dir: &Path,
    mc_version: &str,
    loader_version: &str,
    app: &AppHandle,
) -> AppResult<LoaderProfile> {
    emit_loader_progress(
        app,
        "loader",
        10,
        100,
        "Telechargement de l'installeur Forge...",
    );

    // Download installer JAR
    let installer_url = forge::get_installer_url(mc_version, loader_version);
    let installer_bytes = download_installer_bytes(client, &installer_url).await?;

    emit_loader_progress(app, "loader", 30, 100, "Extraction des fichiers Forge...");

    // Extract and parse version.json from installer
    let (version_profile, libraries) =
        extract_forge_profile(&installer_bytes, mc_version, loader_version)?;

    emit_loader_progress(
        app,
        "loader",
        50,
        100,
        "Telechargement des bibliotheques Forge...",
    );

    // Download libraries
    let libraries_dir = instance_dir.join("libraries");
    download_forge_libraries(
        client,
        &libraries_dir,
        &libraries,
        &installer_bytes,
        app,
        50,
        95,
    )
    .await?;

    emit_loader_progress(app, "loader", 100, 100, "Forge installe!");

    Ok(version_profile)
}

/// Install NeoForge loader
async fn install_neoforge(
    client: &reqwest::Client,
    instance_dir: &Path,
    mc_version: &str,
    loader_version: &str,
    app: &AppHandle,
) -> AppResult<LoaderProfile> {
    use super::neoforge_processor;
    use crate::launcher::java;

    emit_loader_progress(
        app,
        "loader",
        5,
        100,
        "Telechargement de l'installeur NeoForge...",
    );

    // Download installer JAR
    let installer_url = neoforge::get_installer_url(loader_version);
    let installer_bytes = download_installer_bytes(client, &installer_url).await?;

    emit_loader_progress(
        app,
        "loader",
        15,
        100,
        "Extraction des fichiers NeoForge...",
    );

    // Extract and parse version.json from installer
    let (version_profile, libraries) =
        extract_neoforge_profile(&installer_bytes, mc_version, loader_version)?;

    emit_loader_progress(
        app,
        "loader",
        25,
        100,
        "Telechargement des bibliotheques NeoForge...",
    );

    // Download libraries
    let libraries_dir = instance_dir.join("libraries");
    download_neoforge_libraries(
        client,
        &libraries_dir,
        &libraries,
        &installer_bytes,
        app,
        25,
        50,
    )
    .await?;

    emit_loader_progress(
        app,
        "loader",
        50,
        100,
        "Execution des processeurs NeoForge...",
    );

    // Get Java path for running processors
    // instance_dir is like .../com.kaizen.launcher/instances/neoforge
    // data_dir should be .../com.kaizen.launcher (two levels up)
    let data_dir = instance_dir
        .parent() // instances/
        .and_then(|p| p.parent()) // com.kaizen.launcher/
        .unwrap_or(instance_dir);

    let java_path = java::get_bundled_java_path(data_dir);
    let java_str = if java_path.exists() {
        java_path.to_string_lossy().to_string()
    } else {
        // Fallback to system java with proper detection
        java::find_system_java().ok_or_else(|| {
            AppError::Launcher(
                "Java n'est pas installé. Installez Java depuis les paramètres avant d'installer NeoForge.".to_string()
            )
        })?
    };

    println!("[NEOFORGE] Using Java: {}", java_str);

    // Run processors to generate SRG client and other required files
    let install_info = neoforge_processor::run_processors(
        client,
        &installer_bytes,
        instance_dir,
        data_dir,
        mc_version,
        &java_str,
        app,
    )
    .await?;

    // Extract FML version from loader libraries (net.neoforged.fancymodloader:loader:X.Y.Z)
    let fml_version = version_profile
        .libraries
        .iter()
        .find(|lib| lib.name.contains("fancymodloader") && lib.name.contains(":loader:"))
        .and_then(|lib| {
            let name = lib.name.split('@').next().unwrap_or(&lib.name);
            name.split(':').nth(2).map(|v| v.to_string())
        })
        .unwrap_or_else(|| loader_version.to_string());

    // Save neoform version to instance metadata
    let neoforge_meta_path = instance_dir.join("neoforge_meta.json");
    let meta_json = serde_json::json!({
        "neoform_version": install_info.neoform_version,
        "fml_version": fml_version,
        "mc_version": mc_version,
        "loader_version": loader_version,
    });
    let meta_content = serde_json::to_string_pretty(&meta_json)
        .map_err(|e| AppError::Io(format!("Failed to serialize neoforge metadata: {}", e)))?;
    tokio::fs::write(&neoforge_meta_path, meta_content)
        .await
        .map_err(|e| AppError::Io(format!("Failed to save neoforge metadata: {}", e)))?;

    // Note: The NeoForge client jar (neoforge-X.Y.Z-client.jar) is discovered automatically
    // by NeoForge's "production client provider" locator - we don't need to add it to libraries

    emit_loader_progress(app, "loader", 100, 100, "NeoForge installe!");

    Ok(version_profile)
}

/// Download installer JAR as bytes
async fn download_installer_bytes(client: &reqwest::Client, url: &str) -> AppResult<Vec<u8>> {
    println!("[LOADER] Downloading installer from: {}", url);

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download installer: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download installer: HTTP {}",
            response.status()
        )));
    }

    response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read installer bytes: {}", e)))
        .map(|b| b.to_vec())
}

/// Forge/NeoForge version.json structure (simplified)
#[derive(Debug, Deserialize)]
struct ForgeVersionJson {
    id: String,
    #[serde(rename = "inheritsFrom")]
    inherits_from: Option<String>,
    #[serde(rename = "mainClass")]
    main_class: String,
    libraries: Vec<ForgeLibraryJson>,
    #[serde(default)]
    arguments: Option<ForgeArguments>,
}

#[derive(Debug, Deserialize)]
struct ForgeArguments {
    #[serde(default)]
    #[allow(dead_code)]
    game: Vec<serde_json::Value>,
    #[serde(default)]
    jvm: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeLibraryJson {
    name: String,
    downloads: Option<ForgeLibraryDownloads>,
    url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeLibraryDownloads {
    artifact: Option<ForgeArtifact>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeArtifact {
    path: String,
    url: String,
    sha1: Option<String>,
    #[allow(dead_code)]
    size: Option<u64>,
}

/// Extract Forge profile from installer JAR
fn extract_forge_profile(
    installer_bytes: &[u8],
    mc_version: &str,
    _loader_version: &str,
) -> AppResult<(LoaderProfile, Vec<ForgeLibraryJson>)> {
    let cursor = Cursor::new(installer_bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

    // Try to find version.json
    let version_json = read_zip_file(&mut archive, "version.json")?;

    let version: ForgeVersionJson = serde_json::from_str(&version_json)
        .map_err(|e| AppError::Io(format!("Failed to parse version.json: {}", e)))?;

    println!(
        "[FORGE] Loaded profile: id={}, mainClass={}",
        version.id, version.main_class
    );

    // Extract JVM arguments from the installer (for Forge with BootstrapLauncher)
    let jvm_args = version
        .arguments
        .as_ref()
        .map(|args| args.jvm.clone())
        .unwrap_or_default();

    let profile = LoaderProfile {
        id: version.id,
        inherits_from: version
            .inherits_from
            .unwrap_or_else(|| mc_version.to_string()),
        main_class: version.main_class,
        libraries: version
            .libraries
            .iter()
            .map(|l| LoaderLibrary {
                name: l.name.clone(),
                url: l.url.clone().or_else(|| {
                    l.downloads
                        .as_ref()
                        .and_then(|d| d.artifact.as_ref())
                        .and_then(|a| {
                            // Extract base URL from full URL
                            if a.url.is_empty() {
                                None
                            } else {
                                Some(FORGE_MAVEN.to_string())
                            }
                        })
                }),
            })
            .collect(),
        jvm_args,
    };

    Ok((profile, version.libraries))
}

/// Extract NeoForge profile from installer JAR
fn extract_neoforge_profile(
    installer_bytes: &[u8],
    mc_version: &str,
    _loader_version: &str,
) -> AppResult<(LoaderProfile, Vec<ForgeLibraryJson>)> {
    let cursor = Cursor::new(installer_bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

    // Try to find version.json
    let version_json = read_zip_file(&mut archive, "version.json")?;

    let version: ForgeVersionJson = serde_json::from_str(&version_json)
        .map_err(|e| AppError::Io(format!("Failed to parse version.json: {}", e)))?;

    println!(
        "[NEOFORGE] Loaded profile: id={}, mainClass={}",
        version.id, version.main_class
    );

    // Extract JVM arguments from the installer
    let jvm_args = version
        .arguments
        .as_ref()
        .map(|args| args.jvm.clone())
        .unwrap_or_default();

    println!(
        "[NEOFORGE] Found {} JVM arguments from installer",
        jvm_args.len()
    );

    let profile = LoaderProfile {
        id: version.id,
        inherits_from: version
            .inherits_from
            .unwrap_or_else(|| mc_version.to_string()),
        main_class: version.main_class,
        libraries: version
            .libraries
            .iter()
            .map(|l| LoaderLibrary {
                name: l.name.clone(),
                url: l.url.clone().or_else(|| {
                    l.downloads
                        .as_ref()
                        .and_then(|d| d.artifact.as_ref())
                        .and_then(|a| {
                            if a.url.is_empty() {
                                None
                            } else {
                                Some(NEOFORGE_MAVEN.to_string())
                            }
                        })
                }),
            })
            .collect(),
        jvm_args,
    };

    Ok((profile, version.libraries))
}

/// Read a file from ZIP archive
fn read_zip_file(archive: &mut ZipArchive<Cursor<&[u8]>>, filename: &str) -> AppResult<String> {
    let mut file = archive
        .by_name(filename)
        .map_err(|e| AppError::Io(format!("File {} not found in installer: {}", filename, e)))?;

    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| AppError::Io(format!("Failed to read {}: {}", filename, e)))?;

    Ok(contents)
}

/// Download Forge libraries
async fn download_forge_libraries(
    client: &reqwest::Client,
    libraries_dir: &Path,
    libraries: &[ForgeLibraryJson],
    installer_bytes: &[u8],
    app: &AppHandle,
    start_percent: u32,
    end_percent: u32,
) -> AppResult<()> {
    let total = libraries.len();
    let cursor = Cursor::new(installer_bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

    for (i, lib) in libraries.iter().enumerate() {
        // Determine the path - prefer artifact.path if available
        let path = if let Some(ref downloads) = lib.downloads {
            if let Some(ref artifact) = downloads.artifact {
                artifact.path.clone()
            } else {
                library_name_to_path(&lib.name)
            }
        } else {
            library_name_to_path(&lib.name)
        };

        let dest = libraries_dir.join(&path);

        // Create parent directories
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create library directory: {}", e)))?;
        }

        // Skip if already exists
        if dest.exists() {
            println!("[FORGE] Already exists: {}", lib.name);
            continue;
        }

        let mut downloaded = false;

        // Try to extract from installer's maven directory first
        let maven_path = format!("maven/{}", path);
        if let Ok(lib_bytes) = extract_zip_bytes(&mut archive, &maven_path) {
            tokio::fs::write(&dest, lib_bytes)
                .await
                .map_err(|e| AppError::Io(format!("Failed to write library: {}", e)))?;
            println!("[FORGE] Extracted from installer: {}", lib.name);
            downloaded = true;
        }

        // If not extracted, try downloading
        if !downloaded {
            if let Some(ref downloads) = lib.downloads {
                if let Some(ref artifact) = downloads.artifact {
                    if !artifact.url.is_empty() {
                        match download_file(client, &artifact.url, &dest, artifact.sha1.as_deref())
                            .await
                        {
                            Ok(_) => {
                                println!("[FORGE] Downloaded: {}", lib.name);
                                downloaded = true;
                            }
                            Err(e) => {
                                println!("[FORGE] Download failed for {}: {}", lib.name, e);
                            }
                        }
                    }
                }
            }
        }

        // Try custom maven URL if provided
        if !downloaded {
            if let Some(ref url) = lib.url {
                let full_url = format!("{}/{}", url.trim_end_matches('/'), path);
                if download_file(client, &full_url, &dest, None).await.is_ok() {
                    println!("[FORGE] Downloaded from maven: {}", lib.name);
                    downloaded = true;
                }
            }
        }

        // Try Forge maven as fallback
        if !downloaded {
            let full_url = format!("{}/{}", FORGE_MAVEN, path);
            if download_file(client, &full_url, &dest, None).await.is_ok() {
                println!("[FORGE] Downloaded from Forge maven: {}", lib.name);
                downloaded = true;
            }
        }

        // Try Minecraft libraries as final fallback
        if !downloaded {
            let mc_url = format!("https://libraries.minecraft.net/{}", path);
            if download_file(client, &mc_url, &dest, None).await.is_ok() {
                println!("[FORGE] Downloaded from Minecraft: {}", lib.name);
                downloaded = true;
            }
        }

        if !downloaded {
            println!("[FORGE] WARNING: Could not obtain library: {}", lib.name);
        }

        // Update progress
        let percent =
            start_percent + ((i as u32 + 1) * (end_percent - start_percent) / total.max(1) as u32);
        emit_loader_progress(
            app,
            "loader",
            percent,
            100,
            &format!("Bibliotheque {}/{}", i + 1, total),
        );
    }

    Ok(())
}

/// Download NeoForge libraries
async fn download_neoforge_libraries(
    client: &reqwest::Client,
    libraries_dir: &Path,
    libraries: &[ForgeLibraryJson],
    installer_bytes: &[u8],
    app: &AppHandle,
    start_percent: u32,
    end_percent: u32,
) -> AppResult<()> {
    let total = libraries.len();
    let cursor = Cursor::new(installer_bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Failed to open installer JAR: {}", e)))?;

    for (i, lib) in libraries.iter().enumerate() {
        // Determine the path - prefer artifact.path if available
        let path = if let Some(ref downloads) = lib.downloads {
            if let Some(ref artifact) = downloads.artifact {
                artifact.path.clone()
            } else {
                library_name_to_path(&lib.name)
            }
        } else {
            library_name_to_path(&lib.name)
        };

        let dest = libraries_dir.join(&path);

        // Create parent directories
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create library directory: {}", e)))?;
        }

        // Skip if already exists
        if dest.exists() {
            println!("[NEOFORGE] Already exists: {}", lib.name);
            continue;
        }

        let mut downloaded = false;

        // Try to extract from installer's maven directory first
        let maven_path = format!("maven/{}", path);
        if let Ok(lib_bytes) = extract_zip_bytes(&mut archive, &maven_path) {
            tokio::fs::write(&dest, lib_bytes)
                .await
                .map_err(|e| AppError::Io(format!("Failed to write library: {}", e)))?;
            println!("[NEOFORGE] Extracted from installer: {}", lib.name);
            downloaded = true;
        }

        // If not extracted, try downloading
        if !downloaded {
            if let Some(ref downloads) = lib.downloads {
                if let Some(ref artifact) = downloads.artifact {
                    if !artifact.url.is_empty() {
                        match download_file(client, &artifact.url, &dest, artifact.sha1.as_deref())
                            .await
                        {
                            Ok(_) => {
                                println!("[NEOFORGE] Downloaded: {}", lib.name);
                                downloaded = true;
                            }
                            Err(e) => {
                                println!("[NEOFORGE] Download failed for {}: {}", lib.name, e);
                            }
                        }
                    }
                }
            }
        }

        // Try custom maven URL if provided
        if !downloaded {
            if let Some(ref url) = lib.url {
                let full_url = format!("{}/{}", url.trim_end_matches('/'), path);
                if download_file(client, &full_url, &dest, None).await.is_ok() {
                    println!("[NEOFORGE] Downloaded from maven: {}", lib.name);
                    downloaded = true;
                }
            }
        }

        // Try NeoForge maven as fallback
        if !downloaded {
            let full_url = format!("{}/{}", NEOFORGE_MAVEN, path);
            if download_file(client, &full_url, &dest, None).await.is_ok() {
                println!("[NEOFORGE] Downloaded from NeoForge maven: {}", lib.name);
                downloaded = true;
            }
        }

        // Try Minecraft libraries as final fallback
        if !downloaded {
            let mc_url = format!("https://libraries.minecraft.net/{}", path);
            if download_file(client, &mc_url, &dest, None).await.is_ok() {
                println!("[NEOFORGE] Downloaded from Minecraft: {}", lib.name);
                downloaded = true;
            }
        }

        if !downloaded {
            println!("[NEOFORGE] WARNING: Could not obtain library: {}", lib.name);
        }

        // Update progress
        let percent =
            start_percent + ((i as u32 + 1) * (end_percent - start_percent) / total.max(1) as u32);
        emit_loader_progress(
            app,
            "loader",
            percent,
            100,
            &format!("Bibliotheque {}/{}", i + 1, total),
        );
    }

    Ok(())
}

/// Extract bytes from ZIP archive
fn extract_zip_bytes(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    filename: &str,
) -> AppResult<Vec<u8>> {
    let mut file = archive
        .by_name(filename)
        .map_err(|e| AppError::Io(format!("File {} not found in installer: {}", filename, e)))?;

    let mut contents = Vec::new();
    file.read_to_end(&mut contents)
        .map_err(|e| AppError::Io(format!("Failed to read {}: {}", filename, e)))?;

    Ok(contents)
}

/// Download Fabric libraries
async fn download_loader_libraries(
    client: &reqwest::Client,
    libraries_dir: &Path,
    libraries: &[fabric::FabricLibrary],
    _maven_url: &str,
    app: &AppHandle,
    start_percent: u32,
    end_percent: u32,
) -> AppResult<()> {
    let total = libraries.len();

    for (i, lib) in libraries.iter().enumerate() {
        let path = library_name_to_path(&lib.name);
        let url = format!("{}/{}", lib.url, path);
        let dest = libraries_dir.join(&path);

        // Create parent directories
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create library directory: {}", e)))?;
        }

        // Download if not exists
        if !dest.exists() {
            download_file(client, &url, &dest, None).await?;
        }

        // Update progress
        let percent =
            start_percent + ((i as u32 + 1) * (end_percent - start_percent) / total.max(1) as u32);
        emit_loader_progress(
            app,
            "loader",
            percent,
            100,
            &format!("Bibliotheque {}/{}", i + 1, total),
        );
    }

    Ok(())
}

/// Download loader libraries with generic URL handling
async fn download_loader_libraries_generic(
    client: &reqwest::Client,
    libraries_dir: &Path,
    libraries: &[LoaderLibrary],
    default_maven: &str,
    app: &AppHandle,
    start_percent: u32,
    end_percent: u32,
) -> AppResult<()> {
    let total = libraries.len();

    for (i, lib) in libraries.iter().enumerate() {
        let path = library_name_to_path(&lib.name);
        let maven = lib.url.as_deref().unwrap_or(default_maven);
        let url = format!("{}/{}", maven, path);
        let dest = libraries_dir.join(&path);

        // Create parent directories
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create library directory: {}", e)))?;
        }

        // Download if not exists
        if !dest.exists() {
            download_file(client, &url, &dest, None).await?;
        }

        // Update progress
        let percent =
            start_percent + ((i as u32 + 1) * (end_percent - start_percent) / total.max(1) as u32);
        emit_loader_progress(
            app,
            "loader",
            percent,
            100,
            &format!("Bibliotheque {}/{}", i + 1, total),
        );
    }

    Ok(())
}

/// Convert library name to path (e.g., "net.fabricmc:fabric-loader:0.14.21" -> "net/fabricmc/fabric-loader/0.14.21/fabric-loader-0.14.21.jar")
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

    // Handle classifier if present (e.g., "natives-linux")
    if parts.len() > 3 {
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

/// Update version.json with loader information
pub fn merge_loader_profile(version: &mut VersionDetails, loader_profile: &LoaderProfile) {
    use crate::minecraft::versions::{ArgumentValue, Arguments};

    // Update main class
    version.main_class = loader_profile.main_class.clone();

    // Add loader libraries to the beginning
    for lib in loader_profile.libraries.iter().rev() {
        let new_lib = crate::minecraft::versions::Library {
            name: lib.name.clone(),
            downloads: None,
            rules: None,
            natives: None,
            extract: None,
        };
        version.libraries.insert(0, new_lib);
    }

    // Merge JVM arguments from loader (for NeoForge BootstrapLauncher)
    if !loader_profile.jvm_args.is_empty() {
        println!(
            "[LOADER] Merging {} JVM arguments from loader",
            loader_profile.jvm_args.len()
        );

        // Convert JSON values to ArgumentValue
        let loader_jvm_args: Vec<ArgumentValue> = loader_profile
            .jvm_args
            .iter()
            .filter_map(|v| {
                // Try to deserialize as ArgumentValue
                serde_json::from_value(v.clone()).ok()
            })
            .collect();

        println!("[LOADER] Converted {} JVM arguments", loader_jvm_args.len());

        // Ensure arguments struct exists
        if version.arguments.is_none() {
            version.arguments = Some(Arguments {
                game: Vec::new(),
                jvm: Vec::new(),
            });
        }

        // Prepend loader JVM args to existing ones (loader args should come first)
        if let Some(ref mut args) = version.arguments {
            let mut new_jvm = loader_jvm_args;
            new_jvm.append(&mut args.jvm);
            args.jvm = new_jvm;
            println!(
                "[LOADER] Total JVM arguments after merge: {}",
                args.jvm.len()
            );
        }
    }
}
