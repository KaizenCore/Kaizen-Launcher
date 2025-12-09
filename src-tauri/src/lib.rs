mod auth;
pub mod cache;
pub mod crypto;
mod db;
mod download;
mod error;
mod instance;
mod launcher;
mod minecraft;
mod modloader;
mod modpacks;
mod modrinth;
mod state;
mod tunnel;
mod updater;
mod utils;

use state::{AppState, SharedState};
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
            app.handle().manage(shared_state);

            info!("Application initialized successfully");

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
            instance::commands::get_installed_modpack_ids,
            instance::commands::get_instances_by_modpack,
            instance::commands::get_total_mod_count,
            instance::commands::get_storage_info,
            instance::commands::get_instances_storage,
            instance::commands::open_data_folder,
            instance::commands::clear_cache,
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
            // Tunnel commands
            tunnel::commands::check_tunnel_agent,
            tunnel::commands::install_tunnel_agent,
            tunnel::commands::get_tunnel_config,
            tunnel::commands::save_tunnel_config,
            tunnel::commands::update_playit_secret,
            tunnel::commands::start_tunnel,
            tunnel::commands::stop_tunnel,
            tunnel::commands::get_tunnel_status,
            tunnel::commands::is_tunnel_running,
            tunnel::commands::delete_tunnel_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
