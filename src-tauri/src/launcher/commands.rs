use crate::auth::{microsoft, minecraft, xbox};
use crate::crypto;
use crate::db::accounts::Account;
use crate::db::instances::Instance;
use crate::error::{AppError, AppResult};
use crate::launcher::runner::LaunchProgressEvent;
use crate::launcher::{java, runner};
use crate::minecraft::{installer, versions};
use crate::modloader::{self, paper, LoaderType};
use crate::state::SharedState;
use chrono::{Duration, Utc};
use sqlx::SqlitePool;
use std::path::Path;
use tauri::{Emitter, State};
use tokio::fs;

// Windows-specific: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Helper to get loader version from instance or return an error
fn get_loader_version<'a>(instance: &'a Instance, loader_name: &str) -> AppResult<&'a str> {
    instance
        .loader_version
        .as_deref()
        .ok_or_else(|| AppError::Instance(format!("{} requires a loader version", loader_name)))
}

/// Internal function to refresh token without needing Tauri State
/// This is used during game launch to automatically refresh expired tokens
async fn refresh_token_internal(
    http_client: &reqwest::Client,
    db: &SqlitePool,
    encryption_key: &[u8; 32],
    account: &Account,
) -> AppResult<Account> {
    tracing::info!("Refreshing token for account: {}", account.username);

    // Refresh Microsoft token
    let ms_token = microsoft::refresh_token(http_client, &account.refresh_token).await?;

    // Re-authenticate through the chain
    let xbox_token = xbox::authenticate_xbox_live(http_client, &ms_token.access_token).await?;
    let xsts_token = xbox::get_xsts_token(http_client, &xbox_token.token).await?;
    let mc_token =
        minecraft::authenticate_minecraft(http_client, &xsts_token.user_hash, &xsts_token.token)
            .await?;

    // Get updated profile
    let profile = minecraft::get_minecraft_profile(http_client, &mc_token.access_token).await?;

    tracing::info!("Token refreshed successfully for user: {}", profile.name);

    let expires_at = Utc::now() + Duration::seconds(mc_token.expires_in as i64);
    let skin_url = profile.skins.first().map(|s| s.url.clone());

    // Encrypt new tokens before storing
    let encrypted_access_token = crypto::encrypt(encryption_key, &mc_token.access_token)
        .map_err(|e| AppError::Encryption(format!("Failed to encrypt access token: {}", e)))?;
    let encrypted_refresh_token = crypto::encrypt(encryption_key, &ms_token.refresh_token)
        .map_err(|e| AppError::Encryption(format!("Failed to encrypt refresh token: {}", e)))?;

    // Update account in database with encrypted tokens
    let account_for_db = Account {
        id: account.id.clone(),
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        access_token: encrypted_access_token,
        refresh_token: encrypted_refresh_token,
        expires_at: expires_at.to_rfc3339(),
        skin_url: skin_url.clone(),
        is_active: account.is_active,
        created_at: account.created_at.clone(),
    };

    account_for_db.insert(db).await.map_err(AppError::from)?;

    // Return account with decrypted tokens for immediate use
    Ok(Account {
        id: account.id.clone(),
        uuid: profile.id,
        username: profile.name,
        access_token: mc_token.access_token,
        refresh_token: ms_token.refresh_token,
        expires_at: expires_at.to_rfc3339(),
        skin_url,
        is_active: account.is_active,
        created_at: account.created_at.clone(),
    })
}

/// Install Minecraft for an instance
#[tauri::command]
pub async fn install_instance(
    state: State<'_, SharedState>,
    app: tauri::AppHandle,
    instance_id: String,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Starting installation for instance: {}",
        instance_id
    );

    let state_guard = state.read().await;

    // Get the instance
    tracing::info!("[INSTALL] Getting instance from database...");
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;
    tracing::info!(
        "[INSTALL] Found instance: {} ({})",
        instance.name,
        instance.mc_version
    );

    // Get instance directory
    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);
    tracing::info!("[INSTALL] Instance directory: {:?}", instance_dir);

    // Check if this is a server/proxy instance using the instance flag
    // (instance.is_server is set when creating the instance in the UI)
    if instance.is_server {
        // Install server (Vanilla, Paper, Fabric, Forge, NeoForge, Velocity, BungeeCord, Waterfall)
        install_server_instance(&state_guard.http_client, &instance_dir, &instance, &app).await?;
    } else {
        // Install client (Vanilla, Fabric, Forge, NeoForge, Quilt)
        install_client_instance(&state_guard, &instance_dir, &instance, &app).await?;
    }

    // Emit completion event with instance_id
    installer::emit_progress_for_instance(
        &app,
        &instance_id,
        "complete",
        100,
        100,
        "Installation terminee!",
    );

    Ok(())
}

/// Install a client instance (Vanilla, Fabric, Forge, NeoForge, Quilt)
async fn install_client_instance(
    state_guard: &crate::state::AppState,
    instance_dir: &std::path::Path,
    instance: &Instance,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    // Load or fetch version details
    tracing::info!("[INSTALL] Loading version details...");
    let version = match versions::load_version_details(&state_guard.data_dir, &instance.mc_version)
        .await?
    {
        Some(details) => {
            tracing::info!("[INSTALL] Version details loaded from cache");
            details
        }
        None => {
            tracing::info!("[INSTALL] Fetching version manifest...");
            let manifest = versions::fetch_version_manifest(&state_guard.http_client).await?;
            tracing::info!("[INSTALL] Manifest fetched, looking for version...");

            let version_info = manifest
                .versions
                .iter()
                .find(|v| v.id == instance.mc_version)
                .ok_or_else(|| {
                    AppError::Instance(format!(
                        "Minecraft version {} not found",
                        instance.mc_version
                    ))
                })?;
            tracing::info!(
                "[INSTALL] Found version info, fetching details from: {}",
                version_info.url
            );

            let details =
                versions::fetch_version_details(&state_guard.http_client, &version_info.url)
                    .await?;
            tracing::info!("[INSTALL] Version details fetched, saving...");
            versions::save_version_details(&state_guard.data_dir, &instance.mc_version, &details)
                .await?;
            tracing::info!("[INSTALL] Version details saved");
            details
        }
    };

    // Install the version to instance directory with progress reporting
    tracing::info!("[INSTALL] Starting download and installation...");
    installer::install_instance(&state_guard.http_client, instance_dir, &version, app).await?;
    tracing::info!("[INSTALL] Vanilla installation complete!");

    // Install modloader if configured
    let mut final_version = version.clone();
    if let Some(loader_str) = &instance.loader {
        if let Some(loader_version) = &instance.loader_version {
            if let Some(loader_type) = LoaderType::from_str(loader_str) {
                if loader_type != LoaderType::Vanilla && loader_type.is_client_loader() {
                    tracing::info!(
                        "[INSTALL] Installing {:?} loader version {}",
                        loader_type,
                        loader_version
                    );

                    let loader_profile = modloader::installer::install_loader(
                        &state_guard.http_client,
                        instance_dir,
                        loader_type,
                        &instance.mc_version,
                        loader_version,
                        app,
                    )
                    .await?;

                    modloader::installer::merge_loader_profile(&mut final_version, &loader_profile);

                    let version_file = instance_dir.join("client").join("version.json");
                    let version_content = serde_json::to_string_pretty(&final_version)
                        .map_err(|e| AppError::Io(format!("Failed to serialize version: {}", e)))?;
                    fs::write(&version_file, version_content)
                        .await
                        .map_err(|e| {
                            AppError::Io(format!("Failed to write version file: {}", e))
                        })?;

                    tracing::info!("[INSTALL] Loader installation complete!");
                }
            }
        }
    }

    Ok(())
}

/// Install a server instance (Vanilla, Paper, Fabric, Forge, NeoForge, Velocity, BungeeCord, Waterfall)
async fn install_server_instance(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    instance: &Instance,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    let loader_str = instance.loader.as_deref().unwrap_or("vanilla");

    tracing::info!(
        "[INSTALL] Installing server: {} for MC {}",
        loader_str,
        instance.mc_version
    );

    // Create instance directory
    fs::create_dir_all(instance_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create instance directory: {}", e)))?;

    // Emit progress
    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 10,
            total: 100,
            message: format!("Telechargement du serveur {}...", loader_str),
        },
    );

    match loader_str {
        "vanilla" => {
            install_vanilla_server(client, instance_dir, &instance.mc_version, app).await?;
        }
        "fabric" => {
            let loader_version = get_loader_version(instance, "Fabric server")?;
            install_fabric_server(
                client,
                instance_dir,
                &instance.mc_version,
                loader_version,
                app,
            )
            .await?;
        }
        "forge" => {
            let loader_version = get_loader_version(instance, "Forge server")?;
            install_forge_server(
                client,
                instance_dir,
                &instance.mc_version,
                loader_version,
                app,
            )
            .await?;
        }
        "neoforge" => {
            let loader_version = get_loader_version(instance, "NeoForge server")?;
            install_neoforge_server(
                client,
                instance_dir,
                &instance.mc_version,
                loader_version,
                app,
            )
            .await?;
        }
        "paper" => {
            let loader_version = get_loader_version(instance, "Paper server")?;
            install_paper_server(
                client,
                instance_dir,
                &instance.mc_version,
                loader_version,
                app,
            )
            .await?;
        }
        "purpur" => {
            let loader_version = get_loader_version(instance, "Purpur server")?;
            install_purpur_server(
                client,
                instance_dir,
                &instance.mc_version,
                loader_version,
                app,
            )
            .await?;
        }
        "folia" => {
            let loader_version = get_loader_version(instance, "Folia server")?;
            install_folia_server(
                client,
                instance_dir,
                &instance.mc_version,
                loader_version,
                app,
            )
            .await?;
        }
        "pufferfish" => {
            let loader_version = get_loader_version(instance, "Pufferfish server")?;
            install_pufferfish_server(client, instance_dir, loader_version, app).await?;
        }
        "spigot" => {
            return Err(AppError::Instance(
                "Spigot requires BuildTools. Please build it manually.".to_string(),
            ));
        }
        "spongevanilla" => {
            let loader_version = get_loader_version(instance, "SpongeVanilla")?;
            install_sponge_server(client, instance_dir, loader_version, "spongevanilla", app)
                .await?;
        }
        "spongeforge" => {
            let loader_version = get_loader_version(instance, "SpongeForge")?;
            install_sponge_server(client, instance_dir, loader_version, "spongeforge", app).await?;
        }
        "velocity" => {
            let loader_version = get_loader_version(instance, "Velocity")?;
            install_velocity_server(client, instance_dir, loader_version, app).await?;
        }
        "waterfall" => {
            let loader_version = get_loader_version(instance, "Waterfall")?;
            install_waterfall_server(client, instance_dir, loader_version, app).await?;
        }
        "bungeecord" => {
            let loader_version = get_loader_version(instance, "BungeeCord")?;
            install_bungeecord_server(client, instance_dir, loader_version, app).await?;
        }
        _ => {
            return Err(AppError::Instance(format!(
                "Unknown server type: {}",
                loader_str
            )));
        }
    }

    // Create eula.txt (accepted)
    let eula_path = instance_dir.join("eula.txt");
    fs::write(&eula_path, "eula=true\n")
        .await
        .map_err(|e| AppError::Io(format!("Failed to write eula.txt: {}", e)))?;

    // Create server.properties with default values (only for non-proxy servers)
    if !matches!(loader_str, "velocity" | "bungeecord" | "waterfall") {
        let properties_path = instance_dir.join("server.properties");
        if !properties_path.exists() {
            let default_properties =
                "server-port=25565\nonline-mode=true\nmotd=A Minecraft Server\n";
            fs::write(&properties_path, default_properties)
                .await
                .map_err(|e| AppError::Io(format!("Failed to write server.properties: {}", e)))?;
        }
    }

    // Mark as installed
    let installed_marker = instance_dir.join(".installed");
    fs::write(&installed_marker, "server")
        .await
        .map_err(|e| AppError::Io(format!("Failed to write installed marker: {}", e)))?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 100,
            total: 100,
            message: "Serveur installe!".to_string(),
        },
    );

    tracing::info!("[INSTALL] Server installation complete");

    Ok(())
}

/// Install vanilla Minecraft server
async fn install_vanilla_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    mc_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!("[INSTALL] Installing Vanilla server for MC {}", mc_version);

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 20,
            total: 100,
            message: "Recuperation des informations de version...".to_string(),
        },
    );

    // Fetch version manifest to get the server download URL
    let manifest = versions::fetch_version_manifest(client).await?;
    let version_info = manifest
        .versions
        .iter()
        .find(|v| v.id == mc_version)
        .ok_or_else(|| AppError::Instance(format!("Minecraft version {} not found", mc_version)))?;

    let version_details = versions::fetch_version_details(client, &version_info.url).await?;

    let server_download = version_details.downloads.server.as_ref().ok_or_else(|| {
        AppError::Instance("No server download available for this version".to_string())
    })?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 40,
            total: 100,
            message: "Telechargement du serveur vanilla...".to_string(),
        },
    );

    let response = client
        .get(&server_download.url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download vanilla server: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download vanilla server: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read server response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write server JAR: {}", e)))?;

    tracing::info!("[INSTALL] Vanilla server downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Fabric server
async fn install_fabric_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    mc_version: &str,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Fabric server for MC {} with loader {}",
        mc_version,
        loader_version
    );

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement du serveur Fabric...".to_string(),
        },
    );

    // Fabric server launcher URL - uses installer version 1.0.1 (stable)
    // Format: /v2/versions/loader/{game_version}/{loader_version}/{installer_version}/server/jar
    let download_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/1.0.1/server/jar",
        mc_version, loader_version
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Fabric server: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Fabric server: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read server response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Fabric server JAR: {}", e)))?;

    tracing::info!("[INSTALL] Fabric server downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Forge server
async fn install_forge_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    mc_version: &str,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    use crate::modloader::forge;

    tracing::info!(
        "[INSTALL] Installing Forge server for MC {} with loader {}",
        mc_version,
        loader_version
    );

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 20,
            total: 100,
            message: "Telechargement de l'installeur Forge...".to_string(),
        },
    );

    // Download Forge installer
    let installer_url = forge::get_installer_url(mc_version, loader_version);
    tracing::info!(
        "[INSTALL] Downloading Forge installer from: {}",
        installer_url
    );

    let response = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Forge installer: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Forge installer: HTTP {}",
            response.status()
        )));
    }

    let installer_bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read Forge installer: {}", e)))?;

    // Save installer temporarily
    let installer_path = instance_dir.join("forge-installer.jar");
    fs::write(&installer_path, &installer_bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Forge installer: {}", e)))?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 50,
            total: 100,
            message: "Installation du serveur Forge (cela peut prendre quelques minutes)..."
                .to_string(),
        },
    );

    // Find Java to run the installer
    let data_dir = instance_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(instance_dir);
    let java_path = java::check_java_installed(data_dir)
        .map(|j| j.path)
        .or_else(|| {
            // Try bundled Java
            let bundled = java::get_bundled_java_path(data_dir);
            if bundled.exists() {
                Some(bundled.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            AppError::Instance("Java not found. Please install Java first.".to_string())
        })?;

    // Run the installer with --installServer
    tracing::info!("[INSTALL] Running Forge installer with Java: {}", java_path);
    let installer_path_str = installer_path
        .to_str()
        .ok_or_else(|| AppError::Io("Invalid installer path (non-UTF8)".to_string()))?;

    let mut cmd = tokio::process::Command::new(&java_path);
    cmd.args(["-jar", installer_path_str, "--installServer"])
        .current_dir(instance_dir);

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Io(format!("Failed to run Forge installer: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::info!("[INSTALL] Forge installer stderr: {}", stderr);
        return Err(AppError::Instance(format!(
            "Forge installer failed: {}",
            stderr
        )));
    }

    // Clean up installer
    if let Err(e) = fs::remove_file(&installer_path).await {
        tracing::debug!("Failed to clean up Forge installer: {}", e);
    }
    if let Err(e) = fs::remove_file(instance_dir.join("forge-installer.jar.log")).await {
        tracing::debug!("Failed to clean up Forge installer log: {}", e);
    }

    // Find and rename the server JAR
    // Forge creates something like forge-{mc_version}-{forge_version}-shim.jar or run.sh/run.bat
    let server_jar = instance_dir.join("server.jar");

    // Try different possible jar names
    let possible_jars = vec![
        format!("forge-{}-{}.jar", mc_version, loader_version),
        format!("forge-{}-{}-shim.jar", mc_version, loader_version),
        format!("forge-{}-{}-server.jar", mc_version, loader_version),
    ];

    let mut found_jar = None;
    for jar_name in &possible_jars {
        let jar_path = instance_dir.join(jar_name);
        if jar_path.exists() {
            found_jar = Some(jar_path);
            break;
        }
    }

    // Also check for @libraries/... style (modern Forge)
    if found_jar.is_none() {
        // Modern Forge uses run.sh/run.bat - we'll create a wrapper approach
        // For now, look for any forge*.jar
        let mut entries = fs::read_dir(instance_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read instance directory: {}", e)))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("forge-") && name.ends_with(".jar") && !name.contains("installer") {
                found_jar = Some(entry.path());
                break;
            }
        }
    }

    if let Some(jar) = found_jar {
        // Copy/rename to server.jar
        if server_jar.exists() {
            if let Err(e) = fs::remove_file(&server_jar).await {
                tracing::warn!("Failed to remove old server.jar: {}", e);
            }
        }
        fs::copy(&jar, &server_jar)
            .await
            .map_err(|e| AppError::Io(format!("Failed to copy Forge server JAR: {}", e)))?;
        tracing::info!("Forge server ready: {:?}", server_jar);
    } else {
        // For modern Forge that uses @libraries, the jar might not be directly runnable
        // Check if there's a unix_args.txt or win_args.txt
        let unix_args = instance_dir.join("unix_args.txt");
        let win_args = instance_dir.join("win_args.txt");

        if unix_args.exists() || win_args.exists() {
            // Modern Forge - need to handle differently
            // Create a launcher script approach or use the libraries folder
            tracing::info!("Modern Forge detected - using @libraries style");
            // The server will need special handling in runner.rs

            // Create a marker file to indicate modern Forge
            if let Err(e) = fs::write(instance_dir.join(".forge_modern"), "true").await {
                tracing::warn!("Failed to write Forge marker file: {}", e);
            }
        } else {
            return Err(AppError::Instance(
                "Forge installation completed but server JAR not found".to_string(),
            ));
        }
    }

    Ok(())
}

/// Install NeoForge server
async fn install_neoforge_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    mc_version: &str,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    use crate::modloader::neoforge;

    tracing::info!(
        "[INSTALL] Installing NeoForge server for MC {} with loader {}",
        mc_version,
        loader_version
    );

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 20,
            total: 100,
            message: "Telechargement de l'installeur NeoForge...".to_string(),
        },
    );

    // Download NeoForge installer
    let installer_url = neoforge::get_installer_url(loader_version);
    tracing::info!(
        "[INSTALL] Downloading NeoForge installer from: {}",
        installer_url
    );

    let response =
        client.get(&installer_url).send().await.map_err(|e| {
            AppError::Network(format!("Failed to download NeoForge installer: {}", e))
        })?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download NeoForge installer: HTTP {}",
            response.status()
        )));
    }

    let installer_bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read NeoForge installer: {}", e)))?;

    // Save installer temporarily
    let installer_path = instance_dir.join("neoforge-installer.jar");
    fs::write(&installer_path, &installer_bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write NeoForge installer: {}", e)))?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 50,
            total: 100,
            message: "Installation du serveur NeoForge (cela peut prendre quelques minutes)..."
                .to_string(),
        },
    );

    // Find Java to run the installer
    let data_dir = instance_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(instance_dir);
    let java_path = java::check_java_installed(data_dir)
        .map(|j| j.path)
        .or_else(|| {
            let bundled = java::get_bundled_java_path(data_dir);
            if bundled.exists() {
                Some(bundled.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            AppError::Instance("Java not found. Please install Java first.".to_string())
        })?;

    // Run the installer with --installServer
    tracing::info!(
        "[INSTALL] Running NeoForge installer with Java: {}",
        java_path
    );
    let installer_path_str = installer_path
        .to_str()
        .ok_or_else(|| AppError::Io("Invalid installer path (non-UTF8)".to_string()))?;

    let mut cmd = tokio::process::Command::new(&java_path);
    cmd.args(["-jar", installer_path_str, "--installServer"])
        .current_dir(instance_dir);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Io(format!("Failed to run NeoForge installer: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!("NeoForge installer stderr: {}", stderr);
        return Err(AppError::Instance(format!(
            "NeoForge installer failed: {}",
            stderr
        )));
    }

    // Clean up installer
    if let Err(e) = fs::remove_file(&installer_path).await {
        tracing::debug!("Failed to clean up NeoForge installer: {}", e);
    }
    if let Err(e) = fs::remove_file(instance_dir.join("neoforge-installer.jar.log")).await {
        tracing::debug!("Failed to clean up NeoForge installer log: {}", e);
    }

    // Find the server JAR (NeoForge uses @libraries style like modern Forge)
    let server_jar = instance_dir.join("server.jar");

    // Look for neoforge-*.jar
    let mut entries = fs::read_dir(instance_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read instance directory: {}", e)))?;

    let mut found_jar = None;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("neoforge-") && name.ends_with(".jar") && !name.contains("installer") {
            found_jar = Some(entry.path());
            break;
        }
    }

    // Check for run.sh/run.bat (modern NeoForge)
    let run_sh = instance_dir.join("run.sh");
    let run_bat = instance_dir.join("run.bat");
    let unix_args = instance_dir.join("unix_args.txt");
    let win_args = instance_dir.join("win_args.txt");

    if let Some(jar) = found_jar {
        if server_jar.exists() {
            if let Err(e) = fs::remove_file(&server_jar).await {
                tracing::warn!("Failed to remove old server.jar: {}", e);
            }
        }
        fs::copy(&jar, &server_jar)
            .await
            .map_err(|e| AppError::Io(format!("Failed to copy NeoForge server JAR: {}", e)))?;
        tracing::info!("NeoForge server ready: {:?}", server_jar);
    } else if run_sh.exists() || run_bat.exists() || unix_args.exists() || win_args.exists() {
        // Modern NeoForge with @libraries - mark for special handling
        tracing::info!("Modern NeoForge detected - using @libraries style");
        if let Err(e) = fs::write(instance_dir.join(".neoforge_modern"), "true").await {
            tracing::warn!("Failed to write NeoForge marker file: {}", e);
        }
    } else {
        return Err(AppError::Instance(
            "NeoForge installation completed but server JAR not found".to_string(),
        ));
    }

    Ok(())
}

/// Install Paper server
async fn install_paper_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    mc_version: &str,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Paper server for MC {} build {}",
        mc_version,
        loader_version
    );

    // Paper version format: "build-123"
    let build: i32 = loader_version
        .replace("build-", "")
        .split('-')
        .next_back()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Instance("Invalid Paper build number".to_string()))?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement du serveur Paper...".to_string(),
        },
    );

    let build_info =
        paper::fetch_build_info(client, paper::PaperProject::Paper, mc_version, build).await?;
    let download_url = paper::get_download_url(
        paper::PaperProject::Paper,
        mc_version,
        build,
        &build_info.downloads.application.name,
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Paper server: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Paper server: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read server response: {}", e)))?;

    // Save server JAR with specific name
    let jar_name = format!("paper-{}-{}.jar", mc_version, build);
    let jar_path = instance_dir.join(&jar_name);
    fs::write(&jar_path, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Paper server JAR: {}", e)))?;

    // Also create server.jar for easy launching
    let server_jar = instance_dir.join("server.jar");
    if server_jar.exists() {
        if let Err(e) = fs::remove_file(&server_jar).await {
            tracing::warn!("Failed to remove old server.jar: {}", e);
        }
    }
    fs::copy(&jar_path, &server_jar)
        .await
        .map_err(|e| AppError::Io(format!("Failed to copy Paper server JAR: {}", e)))?;

    tracing::info!("[INSTALL] Paper server downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Velocity proxy
async fn install_velocity_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Velocity proxy version {}",
        loader_version
    );

    // Velocity version format: "3.3.0-123"
    let parts: Vec<&str> = loader_version.split('-').collect();
    if parts.len() != 2 {
        return Err(AppError::Instance(
            "Invalid Velocity version format (expected X.Y.Z-BUILD)".to_string(),
        ));
    }
    let version = parts[0];
    let build: i32 = parts[1]
        .parse()
        .map_err(|_| AppError::Instance("Invalid Velocity build number".to_string()))?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement de Velocity...".to_string(),
        },
    );

    let build_info =
        paper::fetch_build_info(client, paper::PaperProject::Velocity, version, build).await?;
    let download_url = paper::get_download_url(
        paper::PaperProject::Velocity,
        version,
        build,
        &build_info.downloads.application.name,
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Velocity: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Velocity: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Velocity JAR: {}", e)))?;

    // Create velocity.toml with default config
    let config_path = instance_dir.join("velocity.toml");
    if !config_path.exists() {
        let default_config = r#"# Velocity proxy configuration
# Generated by Kaizen Launcher

bind = "0.0.0.0:25577"
motd = "&3A Velocity Server"
show-max-players = 500
online-mode = true
force-key-authentication = true
prevent-client-proxy-connections = false
player-info-forwarding-mode = "NONE"
"#;
        fs::write(&config_path, default_config)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write velocity.toml: {}", e)))?;
    }

    tracing::info!("[INSTALL] Velocity proxy downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Waterfall proxy
async fn install_waterfall_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Waterfall proxy version {}",
        loader_version
    );

    // Waterfall version format: "1.21-123"
    let parts: Vec<&str> = loader_version.split('-').collect();
    if parts.len() != 2 {
        return Err(AppError::Instance(
            "Invalid Waterfall version format (expected X.Y-BUILD)".to_string(),
        ));
    }
    let version = parts[0];
    let build: i32 = parts[1]
        .parse()
        .map_err(|_| AppError::Instance("Invalid Waterfall build number".to_string()))?;

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement de Waterfall...".to_string(),
        },
    );

    let build_info =
        paper::fetch_build_info(client, paper::PaperProject::Waterfall, version, build).await?;
    let download_url = paper::get_download_url(
        paper::PaperProject::Waterfall,
        version,
        build,
        &build_info.downloads.application.name,
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Waterfall: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Waterfall: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Waterfall JAR: {}", e)))?;

    // Create config.yml with default BungeeCord-style config
    let config_path = instance_dir.join("config.yml");
    if !config_path.exists() {
        let default_config = r#"# Waterfall proxy configuration
# Generated by Kaizen Launcher

server_connect_timeout: 5000
listeners:
- query_port: 25577
  motd: '&1A Waterfall Proxy'
  priorities:
  - lobby
  bind_local_address: true
  tab_list: GLOBAL_PING
  query_enabled: false
  host: 0.0.0.0:25577
  force_default_server: false
  max_players: 1
  ping_passthrough: false
online_mode: true
"#;
        fs::write(&config_path, default_config)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write config.yml: {}", e)))?;
    }

    tracing::info!("[INSTALL] Waterfall proxy downloaded: {:?}", server_jar);
    Ok(())
}

/// Install BungeeCord proxy
async fn install_bungeecord_server(
    client: &reqwest::Client,
    instance_dir: &std::path::Path,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing BungeeCord proxy version {}",
        loader_version
    );

    // BungeeCord version format: "#123"
    let build_num = loader_version.trim_start_matches('#');

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement de BungeeCord...".to_string(),
        },
    );

    let download_url = format!(
        "https://hub.spigotmc.org/jenkins/job/BungeeCord/{}/artifact/bootstrap/target/BungeeCord.jar",
        build_num
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download BungeeCord: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download BungeeCord: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write BungeeCord JAR: {}", e)))?;

    // Create config.yml with default config
    let config_path = instance_dir.join("config.yml");
    if !config_path.exists() {
        let default_config = r#"# BungeeCord proxy configuration
# Generated by Kaizen Launcher

server_connect_timeout: 5000
listeners:
- query_port: 25577
  motd: '&1A BungeeCord Proxy'
  priorities:
  - lobby
  bind_local_address: true
  tab_list: GLOBAL_PING
  query_enabled: false
  host: 0.0.0.0:25577
  force_default_server: false
  max_players: 1
  ping_passthrough: false
online_mode: true
"#;
        fs::write(&config_path, default_config)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write config.yml: {}", e)))?;
    }

    tracing::info!("[INSTALL] BungeeCord proxy downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Purpur server
async fn install_purpur_server(
    client: &reqwest::Client,
    instance_dir: &Path,
    mc_version: &str,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Purpur server {} for MC {}",
        loader_version,
        mc_version
    );

    // Version format: "build-123"
    let build_num = loader_version.trim_start_matches("build-");

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement de Purpur...".to_string(),
        },
    );

    let download_url = format!(
        "https://api.purpurmc.org/v2/purpur/{}/{}/download",
        mc_version, build_num
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Purpur: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Purpur: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Purpur JAR: {}", e)))?;

    tracing::info!("[INSTALL] Purpur server downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Folia server (uses PaperMC API)
async fn install_folia_server(
    client: &reqwest::Client,
    instance_dir: &Path,
    mc_version: &str,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Folia server {} for MC {}",
        loader_version,
        mc_version
    );

    // Version format: "1.20.4-25" (mc_version-build)
    let parts: Vec<&str> = loader_version.split('-').collect();
    let build_num = parts.get(1).unwrap_or(&"1");

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement de Folia...".to_string(),
        },
    );

    // Get build info to get the exact filename
    let build_info_url = format!(
        "https://api.papermc.io/v2/projects/folia/versions/{}/builds/{}",
        mc_version, build_num
    );

    let info_response = client
        .get(&build_info_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to get Folia build info: {}", e)))?;

    let build_info: serde_json::Value = info_response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Folia build info: {}", e)))?;

    let filename = build_info["downloads"]["application"]["name"]
        .as_str()
        .unwrap_or("folia.jar");

    let download_url = format!(
        "https://api.papermc.io/v2/projects/folia/versions/{}/builds/{}/downloads/{}",
        mc_version, build_num, filename
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Folia: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Folia: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Folia JAR: {}", e)))?;

    tracing::info!("[INSTALL] Folia server downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Pufferfish server
async fn install_pufferfish_server(
    client: &reqwest::Client,
    instance_dir: &Path,
    loader_version: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing Pufferfish server version {}",
        loader_version
    );

    // Version format: "#123" with MC version embedded
    let build_num = loader_version.trim_start_matches('#');

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: "Telechargement de Pufferfish...".to_string(),
        },
    );

    // Try 1.21 first, then 1.20
    let mut download_url = format!(
        "https://ci.pufferfish.host/job/Pufferfish-1.21/{}/artifact/build/libs/pufferfish-paperclip-1.21-R0.1-SNAPSHOT-reobf.jar",
        build_num
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let mut response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download Pufferfish: {}", e)))?;

    // If 1.21 fails, try 1.20
    if !response.status().is_success() {
        download_url = format!(
            "https://ci.pufferfish.host/job/Pufferfish-1.20/{}/artifact/build/libs/pufferfish-paperclip-1.20-R0.1-SNAPSHOT-reobf.jar",
            build_num
        );
        response = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| AppError::Network(format!("Failed to download Pufferfish: {}", e)))?;
    }

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download Pufferfish: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write Pufferfish JAR: {}", e)))?;

    tracing::info!("[INSTALL] Pufferfish server downloaded: {:?}", server_jar);
    Ok(())
}

/// Install Sponge server (SpongeVanilla or SpongeForge)
async fn install_sponge_server(
    client: &reqwest::Client,
    instance_dir: &Path,
    loader_version: &str,
    project: &str,
    app: &tauri::AppHandle,
) -> AppResult<()> {
    tracing::info!(
        "[INSTALL] Installing {} server version {}",
        project,
        loader_version
    );

    let _ = app.emit(
        "install-progress",
        installer::InstallProgress {
            instance_id: None,
            stage: "server".to_string(),
            current: 30,
            total: 100,
            message: format!("Telechargement de {}...", project),
        },
    );

    let download_url = format!(
        "https://repo.spongepowered.org/repository/maven-releases/org/spongepowered/{}/{}/{}-{}-universal.jar",
        project, loader_version, project, loader_version
    );

    tracing::info!("[INSTALL] Downloading from: {}", download_url);

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download {}: {}", project, e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download {}: HTTP {}",
            project,
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    // Save as server.jar
    let server_jar = instance_dir.join("server.jar");
    fs::write(&server_jar, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write {} JAR: {}", project, e)))?;

    tracing::info!("[INSTALL] {} server downloaded: {:?}", project, server_jar);
    Ok(())
}

/// Launch an installed instance
#[tauri::command]
pub async fn launch_instance(
    state: State<'_, SharedState>,
    app: tauri::AppHandle,
    instance_id: String,
    account_id: String,
) -> AppResult<()> {
    let instance_id_clone = instance_id.clone();
    let total_steps: u8 = 4;

    // Helper to emit launch progress
    let emit_progress = |step: &str, step_index: u8| {
        let _ = app.emit(
            "launch-progress",
            LaunchProgressEvent {
                instance_id: instance_id_clone.clone(),
                step: step.to_string(),
                step_index,
                total_steps,
            },
        );
    };

    // Step 1: Preparing - loading instance data
    emit_progress("preparing", 1);

    let state_guard = state.read().await;

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Update last_played timestamp
    Instance::update_last_played(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?;

    // Get instance directory
    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Check if instance is already running (tracked by launcher)
    {
        let running = state_guard.running_instances.read().await;
        if running.contains_key(&instance_id) {
            return Err(AppError::Instance(
                "Cette instance est deja en cours d'execution.".to_string(),
            ));
        }
    }

    // For servers, also check session.lock file (in case server was started externally)
    if instance.is_server {
        let session_lock = instance_dir.join("world").join("session.lock");
        if session_lock.exists() {
            // Try to check if file is locked by attempting to open it exclusively
            if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&session_lock) {
                // Try to get exclusive lock
                #[cfg(unix)]
                {
                    use std::os::unix::io::AsRawFd;
                    let fd = file.as_raw_fd();
                    let result = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
                    if result != 0 {
                        return Err(AppError::Instance(
                            "Un serveur est deja en cours d'execution dans ce dossier (session.lock verrouille).".to_string(),
                        ));
                    }
                    // Release the lock immediately
                    unsafe {
                        libc::flock(fd, libc::LOCK_UN);
                    }
                }
                #[cfg(windows)]
                {
                    // On Windows, if we could open it, it's probably not locked
                    // But the Minecraft lock might still prevent starting
                }
            }
        }
    }

    // Check if instance is installed
    if !installer::is_instance_installed(&instance_dir).await {
        return Err(AppError::Instance(
            "Instance is not installed. Please install first.".to_string(),
        ));
    }

    // Get running instances tracker
    let running_instances = state_guard.running_instances.clone();

    // Clone db for the runner (it needs to update playtime after process exits)
    let db = state_guard.db.clone();

    // Check if this is a server/proxy instance using instance flag
    if instance.is_server {
        // Step 2: Checking Java for server
        emit_progress("checking_java", 2);

        // Step 3: Loading server configuration
        emit_progress("building_args", 3);

        // Step 4: Starting server
        emit_progress("starting", 4);

        // Launch server (no account needed)
        let stdin_handles = state_guard.server_stdin_handles.clone();
        let running_tunnels = state_guard.running_tunnels.clone();
        runner::launch_server(
            &instance_dir,
            &state_guard.data_dir,
            &instance,
            &app,
            running_instances,
            stdin_handles,
            db,
            running_tunnels,
        )
        .await?;
    } else {
        // Step 2: Checking Java / Loading account
        emit_progress("checking_java", 2);

        // Launch client (requires account)
        let mut account = Account::get_by_id(&state_guard.db, &account_id)
            .await
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::Auth("Account not found".to_string()))?;

        // Decrypt tokens if they're encrypted (not offline accounts)
        if account.access_token != "offline" {
            if crypto::is_encrypted(&account.access_token) {
                account.access_token =
                    crypto::decrypt(&state_guard.encryption_key, &account.access_token).map_err(
                        |e| AppError::Encryption(format!("Failed to decrypt access token: {}", e)),
                    )?;
            }
            if crypto::is_encrypted(&account.refresh_token) {
                account.refresh_token =
                    crypto::decrypt(&state_guard.encryption_key, &account.refresh_token).map_err(
                        |e| AppError::Encryption(format!("Failed to decrypt refresh token: {}", e)),
                    )?;
            }

            // Check if token is expired or about to expire (within 5 minutes)
            // and refresh it automatically
            let should_refresh = if let Ok(expires_at) =
                chrono::DateTime::parse_from_rfc3339(&account.expires_at)
            {
                let now = chrono::Utc::now();
                let expires_at_utc = expires_at.with_timezone(&chrono::Utc);
                // Refresh if token expires within 5 minutes
                expires_at_utc < now + chrono::Duration::minutes(5)
            } else {
                // If we can't parse the expiration date, try to refresh anyway
                tracing::warn!(
                    "Could not parse token expiration date: {}",
                    account.expires_at
                );
                true
            };

            if should_refresh {
                tracing::info!(
                    "Token expired or about to expire for account {}, refreshing...",
                    account.username
                );

                // Refresh the token
                match refresh_token_internal(
                    &state_guard.http_client,
                    &state_guard.db,
                    &state_guard.encryption_key,
                    &account,
                )
                .await
                {
                    Ok(refreshed_account) => {
                        tracing::info!(
                            "Token refreshed successfully for account {}",
                            refreshed_account.username
                        );
                        account = refreshed_account;
                    }
                    Err(e) => {
                        tracing::error!("Failed to refresh token: {}", e);
                        return Err(AppError::Auth(format!(
                            "Session expired. Please re-login to your Microsoft account. ({})",
                            e
                        )));
                    }
                }
            }
        }

        // Step 3: Loading version details
        emit_progress("building_args", 3);

        // Load version details from instance
        let version_file = instance_dir.join("client").join("version.json");
        let version_content = tokio::fs::read_to_string(&version_file)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read version file: {}", e)))?;
        let version: versions::VersionDetails = serde_json::from_str(&version_content)
            .map_err(|e| AppError::Io(format!("Failed to parse version file: {}", e)))?;

        // Step 4: Starting the game
        emit_progress("starting", 4);

        // Launch Minecraft client
        runner::launch_minecraft(
            &instance_dir,
            &state_guard.data_dir,
            &instance,
            &version,
            &account,
            None, // Use default Java
            &app,
            running_instances,
            db,
        )
        .await?;
    }

    Ok(())
}

/// Check if an instance is currently running
#[tauri::command]
pub async fn is_instance_running(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<bool> {
    let state_guard = state.read().await;
    let running = state_guard.running_instances.read().await;
    Ok(running.contains_key(&instance_id))
}

/// Stop a running instance
#[tauri::command]
pub async fn stop_instance(state: State<'_, SharedState>, instance_id: String) -> AppResult<()> {
    let state_guard = state.read().await;
    let running = state_guard.running_instances.read().await;

    if let Some(&pid) = running.get(&instance_id) {
        // Kill the process
        #[cfg(unix)]
        {
            use std::process::Command;
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;
            let mut cmd = Command::new("taskkill");
            cmd.args(["/F", "/PID", &pid.to_string()]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.output();
        }
        Ok(())
    } else {
        Err(AppError::Instance("Instance is not running".to_string()))
    }
}

/// Check if an instance is installed
#[tauri::command]
pub async fn is_instance_installed(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<bool> {
    let state_guard = state.read().await;

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Get instance directory
    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    Ok(installer::is_instance_installed(&instance_dir).await)
}

/// Check if Java is installed
/// OPTIMIZED: Runs file system checks in a blocking task to avoid blocking the async runtime
#[tauri::command]
pub async fn check_java(state: State<'_, SharedState>) -> AppResult<Option<java::JavaInfo>> {
    let state_guard = state.read().await;
    let data_dir = state_guard.data_dir.clone();
    drop(state_guard);

    // Run file system operations in a blocking task
    tokio::task::spawn_blocking(move || java::check_java_installed(&data_dir))
        .await
        .map_err(|e| AppError::Io(format!("Task join error: {}", e)))
}

/// Install Java 21 from Adoptium (legacy command)
#[tauri::command]
pub async fn install_java(state: State<'_, SharedState>) -> AppResult<java::JavaInfo> {
    let state_guard = state.read().await;
    java::install_java(&state_guard.http_client, &state_guard.data_dir).await
}

/// Get all detected Java installations
#[tauri::command]
pub async fn get_java_installations(
    state: State<'_, SharedState>,
) -> AppResult<Vec<java::JavaInstallation>> {
    let state_guard = state.read().await;
    Ok(java::detect_all_java_installations(&state_guard.data_dir))
}

/// Get available Java versions for installation
#[tauri::command]
pub async fn get_available_java_versions(
    state: State<'_, SharedState>,
) -> AppResult<Vec<java::AvailableJavaVersion>> {
    let state_guard = state.read().await;
    java::fetch_available_java_versions(&state_guard.http_client).await
}

/// Install a specific Java version
#[tauri::command]
pub async fn install_java_version(
    state: State<'_, SharedState>,
    major_version: u32,
) -> AppResult<java::JavaInstallation> {
    let state_guard = state.read().await;
    java::install_java_version(
        &state_guard.http_client,
        &state_guard.data_dir,
        major_version,
    )
    .await
}

/// Uninstall a bundled Java version
#[tauri::command]
pub async fn uninstall_java_version(
    state: State<'_, SharedState>,
    major_version: u32,
) -> AppResult<()> {
    let state_guard = state.read().await;
    java::uninstall_java_version(&state_guard.data_dir, major_version).await
}

/// Server resource stats
#[derive(serde::Serialize)]
pub struct ServerStats {
    pub cpu_usage: f32,
    pub memory_bytes: u64,
    pub memory_percent: f32,
    pub uptime_seconds: u64,
    pub pid: u32,
}

/// Get server resource usage stats
/// NOTE: This command should be called at most once every 2-3 seconds
/// to avoid excessive CPU usage from sysinfo refreshes
#[tauri::command]
pub async fn get_server_stats(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Option<ServerStats>> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    let state_guard = state.read().await;
    let running = state_guard.running_instances.read().await;

    if let Some(&pid_u32) = running.get(&instance_id) {
        // Create system with minimal info to reduce overhead
        let mut sys = System::new();
        let pid = Pid::from_u32(pid_u32);

        // Lightweight refresh - only what we need
        let refresh_kind = ProcessRefreshKind::new().with_cpu().with_memory();

        // Single refresh is sufficient when called periodically from frontend
        // Frontend should call this every 3+ seconds minimum
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, refresh_kind);

        if let Some(process) = sys.process(pid) {
            let total_memory = sys.total_memory();
            let memory_bytes = process.memory();
            let memory_percent = if total_memory > 0 {
                (memory_bytes as f64 / total_memory as f64 * 100.0) as f32
            } else {
                0.0
            };

            return Ok(Some(ServerStats {
                // Note: CPU usage is cumulative, so calling periodically will give accurate readings
                cpu_usage: process.cpu_usage(),
                memory_bytes,
                memory_percent,
                uptime_seconds: process.run_time(),
                pid: pid_u32,
            }));
        }
    }

    Ok(None)
}

/// Get server properties for an instance
#[tauri::command]
pub async fn get_server_properties(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<std::collections::HashMap<String, String>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);
    let properties_path = instance_dir.join("server.properties");

    let mut props = std::collections::HashMap::new();

    if properties_path.exists() {
        let content = fs::read_to_string(&properties_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read server.properties: {}", e)))?;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                props.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }

    Ok(props)
}

/// Save server properties for an instance
#[tauri::command]
pub async fn save_server_properties(
    state: State<'_, SharedState>,
    instance_id: String,
    properties: std::collections::HashMap<String, String>,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);
    let properties_path = instance_dir.join("server.properties");

    // Read existing file to preserve comments and order
    let mut lines: Vec<String> = Vec::new();
    let mut existing_keys: std::collections::HashSet<String> = std::collections::HashSet::new();

    if properties_path.exists() {
        let content = fs::read_to_string(&properties_path)
            .await
            .unwrap_or_default();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                lines.push(line.to_string());
            } else if let Some((key, _)) = trimmed.split_once('=') {
                let key = key.trim();
                if let Some(new_value) = properties.get(key) {
                    lines.push(format!("{}={}", key, new_value));
                    existing_keys.insert(key.to_string());
                } else {
                    lines.push(line.to_string());
                    existing_keys.insert(key.to_string());
                }
            } else {
                lines.push(line.to_string());
            }
        }
    }

    // Add new keys that weren't in the file
    for (key, value) in &properties {
        if !existing_keys.contains(key) {
            lines.push(format!("{}={}", key, value));
        }
    }

    let content = lines.join("\n");
    fs::write(&properties_path, content)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write server.properties: {}", e)))?;

    Ok(())
}

/// Send a command to a running server
#[tauri::command]
pub async fn send_server_command(
    state: State<'_, SharedState>,
    instance_id: String,
    command: String,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;

    let state_guard = state.read().await;
    let handles = state_guard.server_stdin_handles.read().await;

    if let Some(stdin_handle) = handles.get(&instance_id) {
        let mut stdin = stdin_handle.lock().await;
        let command_with_newline = format!("{}\n", command);
        stdin
            .write_all(command_with_newline.as_bytes())
            .await
            .map_err(|e| AppError::Io(format!("Failed to send command: {}", e)))?;
        stdin
            .flush()
            .await
            .map_err(|e| AppError::Io(format!("Failed to flush command: {}", e)))?;
        Ok(())
    } else {
        Err(AppError::Instance(
            "Server is not running or stdin not available".to_string(),
        ))
    }
}

/// Batch check which instances are running (returns list of running instance IDs)
#[tauri::command]
pub async fn get_running_instances(state: State<'_, SharedState>) -> AppResult<Vec<String>> {
    let state_guard = state.read().await;
    let running = state_guard.running_instances.read().await;
    Ok(running.keys().cloned().collect())
}

/// Batch check which instances are installed (takes game_dirs, returns map of id -> installed)
/// This avoids N database queries by using the game_dir directly from the frontend
#[tauri::command]
pub async fn check_instances_installed(
    state: State<'_, SharedState>,
    instances: Vec<(String, String)>, // Vec of (instance_id, game_dir)
) -> AppResult<std::collections::HashMap<String, bool>> {
    let state_guard = state.read().await;
    let instances_dir = state_guard.data_dir.join("instances");

    let mut result = std::collections::HashMap::new();

    for (instance_id, game_dir) in instances {
        let instance_path = instances_dir.join(&game_dir);
        let is_installed = installer::is_instance_installed(&instance_path).await;
        result.insert(instance_id, is_installed);
    }

    Ok(result)
}
