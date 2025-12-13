mod auth;
pub mod cache;
mod cloud_storage;
pub mod crypto;
mod db;
mod devtools;
mod discord;
mod download;
mod error;
mod instance;
mod launcher;
mod minecraft;
mod modloader;
mod modpacks;
mod modrinth;
mod sharing;
mod skins;
mod state;
mod tunnel;
mod updater;
mod utils;

use sharing::RunningShares;
use state::{AppState, SharedState};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use tracing::info;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize the logging system with file and console output
fn init_logging(data_dir: &std::path::Path) -> anyhow::Result<()> {
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)?;

    // File appender with rotation
    let file_appender = tracing_appender::rolling::daily(&logs_dir, "kaizen.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Keep the guard alive for the lifetime of the app
    std::mem::forget(_guard);

    // Build the subscriber with both console and file output
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,hyper=warn,reqwest=warn"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_target(true).with_thread_ids(true))
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(true)
                .with_thread_ids(true),
        )
        .init();

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Initialize app state
            let runtime = tokio::runtime::Runtime::new().map_err(|e| {
                eprintln!("Failed to create Tokio runtime: {}", e);
                tauri::Error::Io(std::io::Error::other(format!(
                    "Failed to create runtime: {}",
                    e
                )))
            })?;

            let state = runtime
                .block_on(async { AppState::new().await })
                .map_err(|e| {
                    eprintln!("Failed to initialize app state: {}", e);
                    tauri::Error::Io(std::io::Error::other(format!(
                        "Failed to initialize app state: {}",
                        e
                    )))
                })?;

            // Initialize logging after we have the data directory
            if let Err(e) = init_logging(&state.data_dir) {
                eprintln!("Failed to initialize logging: {}", e);
            }

            info!("Kaizen Launcher starting up");
            info!("Data directory: {:?}", state.data_dir);

            let shared_state: SharedState = Arc::new(RwLock::new(state));
            app.handle().manage(shared_state.clone());

            // Initialize RunningShares state for tunnel-based sharing
            let running_shares: RunningShares = Arc::new(RwLock::new(HashMap::new()));
            app.handle().manage(running_shares);

            info!("Application initialized successfully");

            // Initialize Discord Rich Presence (Idle state)
            tauri::async_runtime::spawn(async move {
                let state = shared_state.read().await;
                discord::hooks::set_idle_activity(&state.db).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth commands
            auth::commands::get_accounts,
            auth::commands::get_active_account,
            auth::commands::set_active_account,
            auth::commands::delete_account,
            auth::commands::login_microsoft_start,
            auth::commands::login_microsoft_complete,
            auth::commands::refresh_account_token,
            auth::commands::create_offline_account,
            // Instance commands
            instance::commands::get_instances,
            instance::commands::get_instance,
            instance::commands::create_instance,
            instance::commands::delete_instance,
            instance::commands::update_instance_settings,
            instance::commands::get_instance_mods,
            instance::commands::toggle_mod,
            instance::commands::delete_mod,
            instance::commands::open_mods_folder,
            instance::commands::open_instance_folder,
            instance::commands::get_system_memory,
            instance::commands::get_instance_logs,
            instance::commands::read_instance_log,
            instance::commands::open_logs_folder,
            instance::commands::get_instance_config_files,
            instance::commands::read_config_file,
            instance::commands::save_config_file,
            instance::commands::open_config_folder,
            instance::commands::update_instance_icon,
            instance::commands::clear_instance_icon,
            instance::commands::get_instance_icon,
            instance::commands::get_instance_icons,
            instance::commands::get_installed_modpack_ids,
            instance::commands::get_instances_by_modpack,
            instance::commands::get_total_mod_count,
            instance::commands::get_storage_info,
            instance::commands::get_instances_storage,
            instance::commands::open_data_folder,
            instance::commands::clear_cache,
            instance::commands::get_instances_directory,
            instance::commands::set_instances_directory,
            instance::commands::open_instances_folder,
            instance::commands::get_used_server_ports,
            instance::commands::get_instance_resourcepacks,
            instance::commands::get_instance_shaders,
            instance::commands::get_instance_datapacks,
            // World management commands
            instance::commands::get_instance_worlds,
            instance::commands::get_world_backups,
            instance::commands::backup_world,
            instance::commands::restore_world_backup,
            instance::commands::delete_world,
            instance::commands::duplicate_world,
            instance::commands::rename_world,
            instance::commands::open_world_folder,
            instance::commands::delete_world_backup,
            instance::commands::get_instance_auto_backup,
            instance::commands::set_instance_auto_backup,
            instance::commands::auto_backup_worlds,
            // Global backup management commands
            instance::commands::get_all_backups,
            instance::commands::get_backup_stats,
            instance::commands::restore_backup_to_other_instance,
            // Server from client feature
            instance::commands::analyze_mods_for_server,
            instance::commands::create_server_from_client,
            instance::commands::check_server_dependencies,
            instance::commands::analyze_instance_logs,
            // Minecraft version commands
            minecraft::commands::get_minecraft_versions,
            minecraft::commands::get_minecraft_version_details,
            minecraft::commands::refresh_minecraft_versions,
            // Launcher commands
            launcher::commands::install_instance,
            launcher::commands::launch_instance,
            launcher::commands::is_instance_installed,
            launcher::commands::is_instance_running,
            launcher::commands::stop_instance,
            launcher::commands::get_running_instances,
            launcher::commands::check_instances_installed,
            launcher::commands::check_java,
            launcher::commands::install_java,
            launcher::commands::send_server_command,
            launcher::commands::get_server_properties,
            launcher::commands::save_server_properties,
            launcher::commands::get_server_stats,
            launcher::commands::get_java_installations,
            launcher::commands::get_available_java_versions,
            launcher::commands::install_java_version,
            launcher::commands::uninstall_java_version,
            // Download commands
            download::commands::get_download_queue,
            // Modloader commands
            modloader::commands::get_loader_versions,
            modloader::commands::is_loader_supported,
            modloader::commands::get_recommended_loader_version,
            modloader::commands::get_loader_mc_versions,
            modloader::commands::get_available_loaders,
            // Modrinth commands
            modrinth::commands::search_modrinth_mods,
            modrinth::commands::get_modrinth_mod_versions,
            modrinth::commands::install_modrinth_mod,
            modrinth::commands::get_modrinth_mod_details,
            modrinth::commands::get_mod_dependencies,
            modrinth::commands::install_modrinth_mods_batch,
            modrinth::commands::get_installed_mod_ids,
            modrinth::commands::install_modrinth_modpack,
            modrinth::commands::check_mod_updates,
            modrinth::commands::update_mod,
            modrinth::commands::lookup_mod_by_hash,
            modrinth::commands::enrich_instance_mods,
            modrinth::commands::analyze_mods_for_server_detailed,
            // Tunnel commands
            tunnel::commands::check_tunnel_agent,
            tunnel::commands::install_tunnel_agent,
            tunnel::commands::get_tunnel_config,
            tunnel::commands::save_tunnel_config,
            tunnel::commands::update_playit_secret,
            tunnel::commands::save_tunnel_url,
            tunnel::commands::start_tunnel,
            tunnel::commands::stop_tunnel,
            tunnel::commands::get_tunnel_status,
            tunnel::commands::is_tunnel_running,
            tunnel::commands::delete_tunnel_config,
            // DevTools commands
            devtools::get_app_metrics,
            devtools::is_dev_mode,
            // Cloud storage commands
            cloud_storage::commands::get_oauth_availability,
            cloud_storage::commands::get_cloud_storage_config,
            cloud_storage::commands::save_cloud_storage_config,
            cloud_storage::commands::delete_cloud_storage_config,
            cloud_storage::commands::test_cloud_connection,
            cloud_storage::commands::cloud_oauth_start_google,
            cloud_storage::commands::cloud_oauth_complete_google,
            cloud_storage::commands::cloud_oauth_start_dropbox,
            cloud_storage::commands::cloud_oauth_complete_dropbox,
            cloud_storage::commands::upload_backup_to_cloud,
            cloud_storage::commands::upload_all_pending_backups,
            cloud_storage::commands::get_backup_sync_status,
            cloud_storage::commands::get_all_cloud_backups,
            cloud_storage::commands::list_remote_backups,
            cloud_storage::commands::delete_backup_sync_record,
            cloud_storage::commands::mark_backup_for_upload,
            // Discord commands
            discord::commands::get_discord_config,
            discord::commands::save_discord_config,
            discord::commands::test_discord_rpc,
            discord::commands::test_discord_webhook,
            discord::commands::get_instance_webhook_config,
            discord::commands::save_instance_webhook_config,
            discord::commands::delete_instance_webhook_config,
            // Sharing commands
            sharing::commands::get_exportable_content,
            sharing::commands::prepare_export,
            sharing::commands::cleanup_export,
            sharing::commands::validate_import_package,
            sharing::commands::import_instance,
            sharing::commands::get_sharing_temp_dir,
            // Tunnel-based sharing commands
            sharing::commands::start_share,
            sharing::commands::stop_share,
            sharing::commands::get_active_shares,
            sharing::commands::stop_all_shares,
            sharing::commands::download_and_import_share,
            sharing::commands::fetch_share_manifest,
            sharing::commands::restore_shares,
            sharing::commands::get_shares_for_package,
            // Skin manager commands
            skins::commands::get_skin_profile,
            skins::commands::apply_skin,
            skins::commands::apply_skin_from_file,
            skins::commands::reset_skin,
            skins::commands::get_available_capes,
            skins::commands::get_optifine_cape,
            skins::commands::set_active_cape,
            skins::commands::search_community_skins,
            skins::commands::get_trending_skins,
            skins::commands::get_recent_skins,
            skins::commands::search_player_skin,
            skins::commands::get_all_player_capes,
            skins::commands::upload_skin_from_url,
            skins::commands::upload_skin_from_file_mineskin,
            skins::commands::get_cached_skins,
            skins::commands::cache_skin,
            skins::commands::delete_cached_skin,
            skins::commands::get_skin_cache_size,
            skins::commands::cleanup_skin_cache,
            skins::commands::download_skin_image,
            // Skin favorites commands
            skins::commands::get_favorite_skins,
            skins::commands::add_favorite_skin,
            skins::commands::remove_favorite_skin,
            skins::commands::is_skin_favorited,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
