use crate::error::{AppError, AppResult};
use crate::tunnel::{AgentInfo, TunnelProvider};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::info;

/// Get the tunnel agents directory
pub fn get_tunnels_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("tunnels")
}

/// Get the directory for a specific provider
fn get_provider_dir(data_dir: &Path, provider: TunnelProvider) -> PathBuf {
    get_tunnels_dir(data_dir).join(provider.to_string())
}

/// Get the binary path for a provider
pub fn get_agent_binary_path(data_dir: &Path, provider: TunnelProvider) -> PathBuf {
    let provider_dir = get_provider_dir(data_dir, provider);

    match provider {
        TunnelProvider::Cloudflare => {
            #[cfg(target_os = "windows")]
            {
                provider_dir.join("cloudflared.exe")
            }
            #[cfg(not(target_os = "windows"))]
            {
                provider_dir.join("cloudflared")
            }
        }
        TunnelProvider::Playit => {
            #[cfg(target_os = "windows")]
            {
                provider_dir.join("playit.exe")
            }
            #[cfg(not(target_os = "windows"))]
            {
                provider_dir.join("playit")
            }
        }
        TunnelProvider::Ngrok => {
            #[cfg(target_os = "windows")]
            {
                provider_dir.join("ngrok.exe")
            }
            #[cfg(not(target_os = "windows"))]
            {
                provider_dir.join("ngrok")
            }
        }
        TunnelProvider::Bore => {
            #[cfg(target_os = "windows")]
            {
                provider_dir.join("bore.exe")
            }
            #[cfg(not(target_os = "windows"))]
            {
                provider_dir.join("bore")
            }
        }
    }
}

/// Check if an agent is installed
pub fn check_agent_installed(data_dir: &Path, provider: TunnelProvider) -> Option<AgentInfo> {
    let binary_path = get_agent_binary_path(data_dir, provider);

    if binary_path.exists() {
        Some(AgentInfo {
            provider,
            version: None, // Could parse version by running --version
            path: binary_path.to_string_lossy().to_string(),
            installed: true,
        })
    } else {
        None
    }
}

/// Get download URL for a provider
fn get_download_url(provider: TunnelProvider) -> AppResult<String> {
    let (os, arch) = get_platform_info();

    match provider {
        TunnelProvider::Cloudflare => {
            // https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-{os}-{arch}
            let filename = match (os, arch) {
                ("darwin", "aarch64") => "cloudflared-darwin-arm64.tgz",
                ("darwin", "x64") => "cloudflared-darwin-amd64.tgz",
                ("linux", "x64") => "cloudflared-linux-amd64",
                ("linux", "aarch64") => "cloudflared-linux-arm64",
                ("windows", "x64") => "cloudflared-windows-amd64.exe",
                _ => {
                    return Err(AppError::Custom(format!(
                        "Unsupported platform: {} {}",
                        os, arch
                    )))
                }
            };
            Ok(format!(
                "https://github.com/cloudflare/cloudflared/releases/latest/download/{}",
                filename
            ))
        }
        TunnelProvider::Playit => {
            // playit.gg does NOT support macOS - only Linux and Windows
            // https://github.com/playit-cloud/playit-agent/releases
            let filename = match (os, arch) {
                ("darwin", _) => {
                    return Err(AppError::Custom(
                        "playit.gg n'est pas disponible sur macOS. Utilisez ngrok ou Cloudflare Tunnels a la place.".to_string()
                    ))
                }
                ("linux", "x64") => "playit-linux-amd64",
                ("linux", "aarch64") => "playit-linux-aarch64",
                ("windows", "x64") => "playit-windows-x86_64-signed.exe",
                _ => return Err(AppError::Custom(format!("Unsupported platform: {} {}", os, arch))),
            };
            Ok(format!(
                "https://github.com/playit-cloud/playit-agent/releases/latest/download/{}",
                filename
            ))
        }
        TunnelProvider::Ngrok => {
            // ngrok downloads from https://bin.equinox.io
            // macOS and Windows use .zip, Linux uses .tgz
            let filename = match (os, arch) {
                ("darwin", "aarch64") => "ngrok-v3-stable-darwin-arm64.zip",
                ("darwin", "x64") => "ngrok-v3-stable-darwin-amd64.zip",
                ("linux", "x64") => "ngrok-v3-stable-linux-amd64.tgz",
                ("linux", "aarch64") => "ngrok-v3-stable-linux-arm64.tgz",
                ("windows", "x64") => "ngrok-v3-stable-windows-amd64.zip",
                _ => {
                    return Err(AppError::Custom(format!(
                        "Unsupported platform: {} {}",
                        os, arch
                    )))
                }
            };
            Ok(format!("https://bin.equinox.io/c/bNyj1mQVY4c/{}", filename))
        }
        TunnelProvider::Bore => {
            // bore downloads from https://github.com/ekzhang/bore/releases
            // macOS and Linux use .tar.gz, Windows uses .zip
            let filename = match (os, arch) {
                ("darwin", "aarch64") => "bore-v0.5.2-aarch64-apple-darwin.tar.gz",
                ("darwin", "x64") => "bore-v0.5.2-x86_64-apple-darwin.tar.gz",
                ("linux", "x64") => "bore-v0.5.2-x86_64-unknown-linux-musl.tar.gz",
                ("linux", "aarch64") => "bore-v0.5.2-aarch64-unknown-linux-musl.tar.gz",
                ("windows", "x64") => "bore-v0.5.2-x86_64-pc-windows-msvc.zip",
                _ => {
                    return Err(AppError::Custom(format!(
                        "Unsupported platform: {} {}",
                        os, arch
                    )))
                }
            };
            Ok(format!(
                "https://github.com/ekzhang/bore/releases/download/v0.5.2/{}",
                filename
            ))
        }
    }
}

/// Check if download is a tarball
fn is_tarball(provider: TunnelProvider) -> bool {
    match provider {
        TunnelProvider::Cloudflare => {
            #[cfg(target_os = "macos")]
            return true;
            #[cfg(not(target_os = "macos"))]
            return false;
        }
        TunnelProvider::Ngrok => {
            // ngrok uses .tgz on Linux only
            #[cfg(target_os = "linux")]
            return true;
            #[cfg(not(target_os = "linux"))]
            return false;
        }
        TunnelProvider::Bore => {
            // bore uses .tar.gz on macOS and Linux
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            return true;
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            return false;
        }
        TunnelProvider::Playit => false,
    }
}

/// Check if download is a zip file
fn is_zip(provider: TunnelProvider) -> bool {
    match provider {
        TunnelProvider::Ngrok => {
            // ngrok uses .zip on macOS and Windows
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            return true;
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            return false;
        }
        TunnelProvider::Bore => {
            // bore uses .zip on Windows only
            #[cfg(target_os = "windows")]
            return true;
            #[cfg(not(target_os = "windows"))]
            return false;
        }
        _ => false,
    }
}

/// Get platform info
fn get_platform_info() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };

    (os, arch)
}

/// Download and install a tunnel agent
pub async fn install_agent(
    client: &reqwest::Client,
    data_dir: &Path,
    provider: TunnelProvider,
) -> AppResult<AgentInfo> {
    info!("[TUNNEL] Installing {} agent...", provider);

    let provider_dir = get_provider_dir(data_dir, provider);
    fs::create_dir_all(&provider_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create tunnel directory: {}", e)))?;

    let download_url = get_download_url(provider)?;
    info!("[TUNNEL] Downloading from: {}", download_url);

    // Download the file
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download agent: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read agent download: {}", e)))?;

    let binary_path = get_agent_binary_path(data_dir, provider);

    if is_tarball(provider) {
        // Extract tarball (macOS cloudflared, Linux ngrok)
        let tarball_path = provider_dir.join("agent.tgz");
        fs::write(&tarball_path, &bytes)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write tarball: {}", e)))?;

        // Extract using tar
        extract_tarball(&tarball_path, &provider_dir).await?;

        // Clean up tarball
        let _ = fs::remove_file(&tarball_path).await;
    } else if is_zip(provider) {
        // Extract zip (ngrok on macOS/Windows)
        let zip_path = provider_dir.join("agent.zip");
        fs::write(&zip_path, &bytes)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write zip: {}", e)))?;

        // Extract using unzip
        extract_zip(&zip_path, &provider_dir).await?;

        // Clean up zip
        let _ = fs::remove_file(&zip_path).await;
    } else {
        // Direct binary download
        fs::write(&binary_path, &bytes)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write agent binary: {}", e)))?;
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&binary_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read permissions: {}", e)))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary_path, perms)
            .await
            .map_err(|e| AppError::Io(format!("Failed to set permissions: {}", e)))?;
    }

    info!("[TUNNEL] {} agent installed successfully!", provider);

    Ok(AgentInfo {
        provider,
        version: None,
        path: binary_path.to_string_lossy().to_string(),
        installed: true,
    })
}

/// Extract a tarball
#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn extract_tarball(archive_path: &Path, dest_dir: &Path) -> AppResult<()> {
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
        return Err(AppError::Io("Failed to extract agent archive".to_string()));
    }

    Ok(())
}

/// Extract a tarball (Windows stub - not used)
#[cfg(target_os = "windows")]
#[allow(dead_code)]
async fn extract_tarball(_archive_path: &Path, _dest_dir: &Path) -> AppResult<()> {
    Ok(())
}

/// Extract a zip file
async fn extract_zip(archive_path: &Path, dest_dir: &Path) -> AppResult<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;

        let status = Command::new("unzip")
            .args([
                "-o", // overwrite without prompting
                &archive_path.to_string_lossy(),
                "-d",
                &dest_dir.to_string_lossy(),
            ])
            .status()
            .map_err(|e| AppError::Io(format!("Failed to extract zip: {}", e)))?;

        if !status.success() {
            return Err(AppError::Io("Failed to extract agent zip".to_string()));
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Use PowerShell's Expand-Archive on Windows
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-Command",
            &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                archive_path.to_string_lossy(),
                dest_dir.to_string_lossy()
            ),
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let status = cmd
            .status()
            .map_err(|e| AppError::Io(format!("Failed to extract zip: {}", e)))?;

        if !status.success() {
            return Err(AppError::Io("Failed to extract agent zip".to_string()));
        }
    }

    Ok(())
}
