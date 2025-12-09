use crate::download::client::download_file_sha256;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{debug, info};

const ADOPTIUM_API: &str = "https://api.adoptium.net/v3";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInfo {
    pub version: String,
    pub path: String,
    pub is_bundled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstallation {
    pub version: String,
    pub major_version: u32,
    pub path: String,
    pub vendor: String,
    pub is_bundled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableJavaVersion {
    pub major_version: u32,
    pub release_name: String,
    pub release_type: String,
}

#[derive(Debug, Deserialize)]
struct AdoptiumRelease {
    binary: AdoptiumBinary,
    release_name: String,
}

#[derive(Debug, Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(Debug, Deserialize)]
struct AdoptiumPackage {
    link: String,
    checksum: Option<String>,
    name: String,
}

/// Check if Java is installed and return info about it
pub fn check_java_installed(data_dir: &Path) -> Option<JavaInfo> {
    // First check bundled Java
    let bundled_java = get_bundled_java_path(data_dir);
    if bundled_java.exists() {
        if let Some(version) = get_java_version(&bundled_java) {
            return Some(JavaInfo {
                version,
                path: bundled_java.to_string_lossy().to_string(),
                is_bundled: true,
            });
        }
    }

    // Then check system Java
    if let Some(system_java) = find_system_java() {
        if let Some(version) = get_java_version(Path::new(&system_java)) {
            return Some(JavaInfo {
                version,
                path: system_java,
                is_bundled: false,
            });
        }
    }

    None
}

/// Get the path where bundled Java should be installed
pub fn get_bundled_java_path(data_dir: &Path) -> PathBuf {
    let java_dir = data_dir.join("java");

    #[cfg(target_os = "macos")]
    {
        java_dir.join("jdk-21/Contents/Home/bin/java")
    }

    #[cfg(target_os = "windows")]
    {
        java_dir.join("jdk-21/bin/java.exe")
    }

    #[cfg(target_os = "linux")]
    {
        java_dir.join("jdk-21/bin/java")
    }
}

/// Get the Java directory for extraction
fn get_java_extract_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("java")
}

/// Find system Java installation
pub fn find_system_java() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        // Check for Homebrew Java (Apple Silicon and Intel)
        let homebrew_paths = [
            PathBuf::from("/opt/homebrew/opt/openjdk/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@21/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@17/bin/java"),
            PathBuf::from("/usr/local/opt/openjdk/bin/java"),
        ];
        for path in homebrew_paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }

        // Check for Temurin/other JDKs in /Library/Java
        let library_java = PathBuf::from("/Library/Java/JavaVirtualMachines");
        if let Ok(entries) = std::fs::read_dir(&library_java) {
            for entry in entries.flatten() {
                let java_path = entry
                    .path()
                    .join("Contents")
                    .join("Home")
                    .join("bin")
                    .join("java");
                if java_path.exists() {
                    return Some(java_path.to_string_lossy().to_string());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java = PathBuf::from(&java_home).join("bin").join("java.exe");
            if java.exists() {
                return Some(java.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Check common Linux Java locations
        let linux_paths = [
            PathBuf::from("/usr/bin/java"),
            PathBuf::from("/usr/lib/jvm/default/bin/java"),
        ];
        for path in linux_paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }

        // Check JAVA_HOME on Linux too
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java = PathBuf::from(&java_home).join("bin").join("java");
            if java.exists() {
                return Some(java.to_string_lossy().to_string());
            }
        }
    }

    None
}

/// Get Java version from executable
fn get_java_version(java_path: &Path) -> Option<String> {
    let output = std::process::Command::new(java_path)
        .arg("-version")
        .output()
        .ok()?;

    // Java outputs version to stderr
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse version from output like: openjdk version "21.0.1" 2023-10-17
    for line in stderr.lines() {
        if line.contains("version") {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    return Some(line[start + 1..start + 1 + end].to_string());
                }
            }
        }
    }

    None
}

/// Download and install Java from Adoptium
pub async fn install_java(client: &reqwest::Client, data_dir: &Path) -> AppResult<JavaInfo> {
    println!("[JAVA] Starting Java 21 installation...");

    let java_dir = get_java_extract_dir(data_dir);
    fs::create_dir_all(&java_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create java directory: {}", e)))?;

    // Get OS and architecture for Adoptium API
    let (os, arch) = get_platform_info();
    println!("[JAVA] Platform: {} {}", os, arch);

    // Fetch latest Java 21 release info from Adoptium
    let api_url = format!(
        "{}/assets/latest/21/hotspot?architecture={}&image_type=jdk&os={}&vendor=eclipse",
        ADOPTIUM_API, arch, os
    );
    println!("[JAVA] Fetching release info from: {}", api_url);

    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Java info: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Adoptium API error: {}",
            response.status()
        )));
    }

    let releases: Vec<AdoptiumRelease> = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Java info: {}", e)))?;

    let release = releases
        .first()
        .ok_or_else(|| AppError::Network("No Java releases found".to_string()))?;

    println!("[JAVA] Found release: {}", release.release_name);

    // Download the archive
    let archive_path = java_dir.join(&release.binary.package.name);
    println!("[JAVA] Downloading to: {:?}", archive_path);

    download_file_sha256(
        client,
        &release.binary.package.link,
        &archive_path,
        release.binary.package.checksum.as_deref(),
    )
    .await?;

    println!("[JAVA] Download complete, extracting...");

    // Extract the archive
    extract_java_archive(&archive_path, &java_dir).await?;

    // Clean up archive
    let _ = fs::remove_file(&archive_path).await;

    // Find the extracted directory and rename it to jdk-21
    let target_dir = java_dir.join("jdk-21");
    if !target_dir.exists() {
        // Find the extracted folder (usually named like jdk-21.0.x+y)
        let mut entries = fs::read_dir(&java_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read java directory: {}", e)))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("jdk-21")
                && entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false)
            {
                fs::rename(entry.path(), &target_dir)
                    .await
                    .map_err(|e| AppError::Io(format!("Failed to rename java directory: {}", e)))?;
                break;
            }
        }
    }

    println!("[JAVA] Java 21 installed successfully!");

    let java_path = get_bundled_java_path(data_dir);
    let version = get_java_version(&java_path).unwrap_or_else(|| "21".to_string());

    Ok(JavaInfo {
        version,
        path: java_path.to_string_lossy().to_string(),
        is_bundled: true,
    })
}

/// Get platform info for Adoptium API
fn get_platform_info() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        "x64"
    };

    (os, arch)
}

/// Extract Java archive (tar.gz on Unix, zip on Windows)
async fn extract_java_archive(archive_path: &Path, dest_dir: &Path) -> AppResult<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;

        let status = Command::new("tar")
            .args([
                "-xzf",
                &archive_path.to_string_lossy(),
                "-C",
                &dest_dir.to_string_lossy(),
            ])
            .status()
            .map_err(|e| AppError::Io(format!("Failed to extract archive: {}", e)))?;

        if !status.success() {
            return Err(AppError::Io("Failed to extract Java archive".to_string()));
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // Use PowerShell to extract zip
        let status = Command::new("powershell")
            .args([
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    archive_path.to_string_lossy(),
                    dest_dir.to_string_lossy()
                ),
            ])
            .status()
            .map_err(|e| AppError::Io(format!("Failed to extract archive: {}", e)))?;

        if !status.success() {
            return Err(AppError::Io("Failed to extract Java archive".to_string()));
        }
    }

    Ok(())
}

/// Detect all Java installations on the system
pub fn detect_all_java_installations(data_dir: &Path) -> Vec<JavaInstallation> {
    let mut installations = Vec::new();

    // Check bundled Java installations
    let java_dir = data_dir.join("java");
    if java_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&java_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("jdk-")
                    && entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                {
                    let java_path = get_java_executable_in_dir(&entry.path());
                    if let Some(path) = java_path {
                        if let Some(version) = get_java_version(&path) {
                            let major = extract_major_version(&version);
                            installations.push(JavaInstallation {
                                version: version.clone(),
                                major_version: major,
                                path: path.to_string_lossy().to_string(),
                                vendor: "Eclipse Temurin (Bundled)".to_string(),
                                is_bundled: true,
                            });
                        }
                    }
                }
            }
        }
    }

    // Check system Java installations
    #[cfg(target_os = "macos")]
    {
        // Homebrew paths (Apple Silicon and Intel)
        let homebrew_paths = [
            PathBuf::from("/opt/homebrew/opt/openjdk/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@21/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@17/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@11/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@8/bin/java"),
            PathBuf::from("/usr/local/opt/openjdk/bin/java"),
            PathBuf::from("/usr/local/opt/openjdk@21/bin/java"),
            PathBuf::from("/usr/local/opt/openjdk@17/bin/java"),
        ];

        for path in &homebrew_paths {
            if path.exists() {
                if let Some(version) = get_java_version(path) {
                    let major = extract_major_version(&version);
                    let path_str = path.to_string_lossy().to_string();
                    if !installations.iter().any(|i| i.path == path_str) {
                        installations.push(JavaInstallation {
                            version: version.clone(),
                            major_version: major,
                            path: path_str,
                            vendor: "Homebrew OpenJDK".to_string(),
                            is_bundled: false,
                        });
                    }
                }
            }
        }

        // /Library/Java/JavaVirtualMachines
        let library_java = PathBuf::from("/Library/Java/JavaVirtualMachines");
        if let Ok(entries) = std::fs::read_dir(&library_java) {
            for entry in entries.flatten() {
                let java_path = entry
                    .path()
                    .join("Contents")
                    .join("Home")
                    .join("bin")
                    .join("java");
                if java_path.exists() {
                    if let Some(version) = get_java_version(&java_path) {
                        let major = extract_major_version(&version);
                        let path_str = java_path.to_string_lossy().to_string();
                        let vendor = detect_vendor(&entry.file_name().to_string_lossy());
                        if !installations.iter().any(|i| i.path == path_str) {
                            installations.push(JavaInstallation {
                                version: version.clone(),
                                major_version: major,
                                path: path_str,
                                vendor,
                                is_bundled: false,
                            });
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Check JAVA_HOME
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java_path = PathBuf::from(&java_home).join("bin").join("java.exe");
            if java_path.exists() {
                if let Some(version) = get_java_version(&java_path) {
                    let major = extract_major_version(&version);
                    let path_str = java_path.to_string_lossy().to_string();
                    if !installations.iter().any(|i| i.path == path_str) {
                        installations.push(JavaInstallation {
                            version: version.clone(),
                            major_version: major,
                            path: path_str,
                            vendor: "JAVA_HOME".to_string(),
                            is_bundled: false,
                        });
                    }
                }
            }
        }

        // Check common installation directories using Path::join for cross-platform safety
        let program_files =
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 = std::env::var("ProgramFiles(x86)")
            .unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

        let search_dirs = [
            PathBuf::from(&program_files).join("Java"),
            PathBuf::from(&program_files_x86).join("Java"),
            PathBuf::from(&program_files).join("Eclipse Adoptium"),
            PathBuf::from(&program_files).join("Zulu"),
            PathBuf::from(&program_files).join("Microsoft"),
            PathBuf::from(&program_files).join("Amazon Corretto"),
        ];

        for search_dir in &search_dirs {
            if let Ok(entries) = std::fs::read_dir(search_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let java_path = entry.path().join("bin").join("java.exe");
                        if java_path.exists() {
                            if let Some(version) = get_java_version(&java_path) {
                                let major = extract_major_version(&version);
                                let path_str = java_path.to_string_lossy().to_string();
                                let vendor = detect_vendor(&entry.file_name().to_string_lossy());
                                if !installations.iter().any(|i| i.path == path_str) {
                                    installations.push(JavaInstallation {
                                        version: version.clone(),
                                        major_version: major,
                                        path: path_str,
                                        vendor,
                                        is_bundled: false,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Direct java binary
        let system_java = PathBuf::from("/usr/bin/java");
        if system_java.exists() {
            if let Some(version) = get_java_version(&system_java) {
                let major = extract_major_version(&version);
                let path_str = system_java.to_string_lossy().to_string();
                installations.push(JavaInstallation {
                    version: version.clone(),
                    major_version: major,
                    path: path_str,
                    vendor: "System Java".to_string(),
                    is_bundled: false,
                });
            }
        }

        // /usr/lib/jvm directory
        let jvm_dir = PathBuf::from("/usr/lib/jvm");
        if let Ok(entries) = std::fs::read_dir(&jvm_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let java_path = entry.path().join("bin").join("java");
                    if java_path.exists() {
                        if let Some(version) = get_java_version(&java_path) {
                            let major = extract_major_version(&version);
                            let path_str = java_path.to_string_lossy().to_string();
                            let vendor = detect_vendor(&entry.file_name().to_string_lossy());
                            if !installations.iter().any(|i| i.path == path_str) {
                                installations.push(JavaInstallation {
                                    version: version.clone(),
                                    major_version: major,
                                    path: path_str,
                                    vendor,
                                    is_bundled: false,
                                });
                            }
                        }
                    }
                }
            }
        }

        // SDKMAN installations - use HOME env var (Linux-specific)
        if let Ok(home) = std::env::var("HOME") {
            let sdkman_java = PathBuf::from(&home)
                .join(".sdkman")
                .join("candidates")
                .join("java");
            if let Ok(entries) = std::fs::read_dir(&sdkman_java) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let java_path = entry.path().join("bin").join("java");
                        if java_path.exists() {
                            if let Some(version) = get_java_version(&java_path) {
                                let major = extract_major_version(&version);
                                let path_str = java_path.to_string_lossy().to_string();
                                let vendor =
                                    format!("SDKMAN ({})", entry.file_name().to_string_lossy());
                                if !installations.iter().any(|i| i.path == path_str) {
                                    installations.push(JavaInstallation {
                                        version: version.clone(),
                                        major_version: major,
                                        path: path_str,
                                        vendor,
                                        is_bundled: false,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Also check JAVA_HOME on Linux
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java_path = PathBuf::from(&java_home).join("bin").join("java");
            if java_path.exists() {
                if let Some(version) = get_java_version(&java_path) {
                    let major = extract_major_version(&version);
                    let path_str = java_path.to_string_lossy().to_string();
                    if !installations.iter().any(|i| i.path == path_str) {
                        installations.push(JavaInstallation {
                            version: version.clone(),
                            major_version: major,
                            path: path_str,
                            vendor: "JAVA_HOME".to_string(),
                            is_bundled: false,
                        });
                    }
                }
            }
        }
    }

    // Sort by major version descending
    installations.sort_by(|a, b| b.major_version.cmp(&a.major_version));

    installations
}

/// Get Java executable path within a JDK directory
fn get_java_executable_in_dir(jdk_dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let path = jdk_dir.join("Contents/Home/bin/java");
        if path.exists() {
            return Some(path);
        }
        let path = jdk_dir.join("bin/java");
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let path = jdk_dir.join("bin/java.exe");
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let path = jdk_dir.join("bin/java");
        if path.exists() {
            return Some(path);
        }
    }

    None
}

/// Extract major version from version string (e.g., "21.0.1" -> 21, "1.8.0_362" -> 8)
fn extract_major_version(version: &str) -> u32 {
    let parts: Vec<&str> = version.split('.').collect();
    if let Some(first) = parts.first() {
        if let Ok(major) = first.parse::<u32>() {
            // For Java 8 and earlier, version starts with "1."
            if major == 1 && parts.len() > 1 {
                if let Ok(actual_major) = parts[1].parse::<u32>() {
                    return actual_major;
                }
            }
            return major;
        }
    }
    0
}

/// Detect vendor from JDK directory name
fn detect_vendor(name: &str) -> String {
    let name_lower = name.to_lowercase();
    if name_lower.contains("temurin") || name_lower.contains("adoptium") {
        "Eclipse Temurin".to_string()
    } else if name_lower.contains("zulu") {
        "Azul Zulu".to_string()
    } else if name_lower.contains("corretto") {
        "Amazon Corretto".to_string()
    } else if name_lower.contains("graal") {
        "GraalVM".to_string()
    } else if name_lower.contains("microsoft") {
        "Microsoft OpenJDK".to_string()
    } else if name_lower.contains("oracle") {
        "Oracle JDK".to_string()
    } else if name_lower.contains("openjdk") || name_lower.contains("java-") {
        "OpenJDK".to_string()
    } else {
        "Unknown".to_string()
    }
}

/// Fetch available Java versions from Adoptium
pub async fn fetch_available_java_versions(
    client: &reqwest::Client,
) -> AppResult<Vec<AvailableJavaVersion>> {
    let url = format!("{}/info/available_releases", ADOPTIUM_API);

    debug!("Fetching available Java versions from: {}", url);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Java versions: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to fetch Java versions: HTTP {}",
            response.status()
        )));
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct AvailableReleases {
        available_lts_releases: Vec<u32>,
        available_releases: Vec<u32>,
        most_recent_feature_release: u32,
        most_recent_lts: u32,
    }

    let releases: AvailableReleases = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Java versions: {}", e)))?;

    let mut versions = Vec::new();

    // Add LTS versions
    for major in releases.available_lts_releases.iter().rev() {
        versions.push(AvailableJavaVersion {
            major_version: *major,
            release_name: format!("Java {} (LTS)", major),
            release_type: "LTS".to_string(),
        });
    }

    // Add latest feature release if not already in LTS
    if !releases
        .available_lts_releases
        .contains(&releases.most_recent_feature_release)
    {
        versions.insert(
            0,
            AvailableJavaVersion {
                major_version: releases.most_recent_feature_release,
                release_name: format!("Java {} (Latest)", releases.most_recent_feature_release),
                release_type: "Latest".to_string(),
            },
        );
    }

    Ok(versions)
}

/// Install a specific Java version
pub async fn install_java_version(
    client: &reqwest::Client,
    data_dir: &Path,
    major_version: u32,
) -> AppResult<JavaInstallation> {
    info!("Starting Java {} installation...", major_version);

    let java_dir = data_dir.join("java");
    fs::create_dir_all(&java_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create java directory: {}", e)))?;

    let (os, arch) = get_platform_info();
    info!("Platform: {} {}", os, arch);

    // Fetch latest release for the specified version
    let api_url = format!(
        "{}/assets/latest/{}/hotspot?architecture={}&image_type=jdk&os={}&vendor=eclipse",
        ADOPTIUM_API, major_version, arch, os
    );
    info!("Fetching release info from: {}", api_url);

    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Java info: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Adoptium API error: {} - Java {} may not be available for your platform",
            response.status(),
            major_version
        )));
    }

    let releases: Vec<AdoptiumRelease> = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Java info: {}", e)))?;

    let release = releases.first().ok_or_else(|| {
        AppError::Network(format!(
            "No Java {} releases found for your platform",
            major_version
        ))
    })?;

    info!("Found release: {}", release.release_name);

    // Download the archive
    let archive_path = java_dir.join(&release.binary.package.name);
    info!("Downloading to: {:?}", archive_path);

    download_file_sha256(
        client,
        &release.binary.package.link,
        &archive_path,
        release.binary.package.checksum.as_deref(),
    )
    .await?;

    info!("Download complete, extracting...");

    // Extract the archive
    extract_java_archive(&archive_path, &java_dir).await?;

    // Clean up archive
    let _ = fs::remove_file(&archive_path).await;

    // Find the extracted directory and rename it
    let target_dir = java_dir.join(format!("jdk-{}", major_version));

    // Remove existing if present
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).await.map_err(|e| {
            AppError::Io(format!(
                "Failed to remove existing jdk-{}: {}",
                major_version, e
            ))
        })?;
    }

    // Find and rename the extracted folder
    let mut entries = fs::read_dir(&java_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read java directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&format!("jdk-{}", major_version))
            && name != format!("jdk-{}", major_version)
            && entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false)
        {
            fs::rename(entry.path(), &target_dir)
                .await
                .map_err(|e| AppError::Io(format!("Failed to rename java directory: {}", e)))?;
            break;
        }
    }

    info!("Java {} installed successfully!", major_version);

    let java_path = get_java_executable_in_dir(&target_dir).ok_or_else(|| {
        AppError::Io("Failed to find Java executable after installation".to_string())
    })?;

    let version = get_java_version(&java_path).unwrap_or_else(|| major_version.to_string());

    Ok(JavaInstallation {
        version,
        major_version,
        path: java_path.to_string_lossy().to_string(),
        vendor: "Eclipse Temurin (Bundled)".to_string(),
        is_bundled: true,
    })
}

/// Uninstall a bundled Java version
pub async fn uninstall_java_version(data_dir: &Path, major_version: u32) -> AppResult<()> {
    let java_dir = data_dir.join("java").join(format!("jdk-{}", major_version));

    if !java_dir.exists() {
        return Err(AppError::Io(format!(
            "Java {} is not installed",
            major_version
        )));
    }

    fs::remove_dir_all(&java_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to uninstall Java {}: {}", major_version, e)))?;

    info!("Java {} uninstalled successfully", major_version);
    Ok(())
}
