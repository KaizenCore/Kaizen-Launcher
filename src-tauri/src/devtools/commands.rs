//! Tauri commands for developer tools
//! Includes dev mode toggle, bug reporting, and log viewer functionality

use crate::crypto;
use crate::db::settings;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::bug_report::{self, ActiveInstanceInfo, BugReport, SystemInfo};
use super::log_buffer::{self, LogEntry};

// ============================================================================
// Dev Mode Settings
// ============================================================================

/// Get the current dev mode setting
#[tauri::command]
pub async fn get_dev_mode_enabled(state: State<'_, SharedState>) -> AppResult<bool> {
    let state = state.read().await;
    let setting = settings::get_setting(&state.db, "dev_mode_enabled").await?;
    Ok(setting.map(|s| s == "true").unwrap_or(false))
}

/// Set the dev mode setting
#[tauri::command]
pub async fn set_dev_mode_enabled(state: State<'_, SharedState>, enabled: bool) -> AppResult<()> {
    let state = state.read().await;
    settings::set_setting(
        &state.db,
        "dev_mode_enabled",
        if enabled { "true" } else { "false" },
    )
    .await?;
    Ok(())
}

// ============================================================================
// Bug Report Webhook
// ============================================================================

/// Get the bug report webhook URL (decrypted)
#[tauri::command]
pub async fn get_bug_report_webhook(state: State<'_, SharedState>) -> AppResult<Option<String>> {
    let state = state.read().await;
    let encrypted = settings::get_setting(&state.db, "bug_report_webhook").await?;

    match encrypted {
        Some(enc) if crypto::is_encrypted(&enc) => {
            let decrypted = crypto::decrypt(&state.encryption_key, &enc)?;
            Ok(Some(decrypted))
        }
        Some(url) => Ok(Some(url)),
        None => Ok(None),
    }
}

/// Set the bug report webhook URL (encrypted)
#[tauri::command]
pub async fn set_bug_report_webhook(
    state: State<'_, SharedState>,
    url: Option<String>,
) -> AppResult<()> {
    let state = state.read().await;

    match url {
        Some(url) if !url.is_empty() => {
            // Validate the URL format
            if !bug_report::is_valid_webhook_url(&url) {
                return Err(AppError::DevTools(
                    "Invalid Discord webhook URL. Must start with https://discord.com/api/webhooks/"
                        .to_string(),
                ));
            }

            // Encrypt and store
            let encrypted = crypto::encrypt(&state.encryption_key, &url)?;
            settings::set_setting(&state.db, "bug_report_webhook", &encrypted).await?;
        }
        _ => {
            // Delete the setting
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind("bug_report_webhook")
                .execute(&state.db)
                .await?;
        }
    }

    Ok(())
}

/// Test the webhook connection by sending a test message
#[tauri::command]
pub async fn test_bug_report_webhook(state: State<'_, SharedState>) -> AppResult<()> {
    let state = state.read().await;

    // Get the webhook URL
    let encrypted = settings::get_setting(&state.db, "bug_report_webhook").await?;
    let webhook_url = match encrypted {
        Some(enc) if crypto::is_encrypted(&enc) => crypto::decrypt(&state.encryption_key, &enc)?,
        Some(url) => url,
        None => {
            return Err(AppError::DevTools(
                "Bug report webhook not configured".to_string(),
            ))
        }
    };

    // Send a test message
    let payload = serde_json::json!({
        "username": "Kaizen Bug Reporter",
        "avatar_url": "https://raw.githubusercontent.com/KaizenCore/Kaizen-Launcher/main/src-tauri/icons/icon.png",
        "embeds": [{
            "title": "Webhook Test",
            "description": "Bug report webhook is configured correctly!",
            "color": 0x22c55e,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "footer": {
                "text": "Kaizen Launcher"
            }
        }]
    });

    let response = state
        .http_client
        .post(&webhook_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::DevTools(format!("Failed to send test message: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::DevTools(format!(
            "Webhook test failed: HTTP {}",
            response.status()
        )));
    }

    Ok(())
}

// ============================================================================
// Log Buffer
// ============================================================================

/// Get recent logs from the in-memory buffer
#[tauri::command]
pub async fn get_recent_logs(count: Option<usize>) -> AppResult<Vec<LogEntry>> {
    Ok(log_buffer::get_recent_logs(count.unwrap_or(100)))
}

/// Clear the log buffer
#[tauri::command]
pub async fn clear_log_buffer() -> AppResult<()> {
    log_buffer::clear_logs();
    Ok(())
}

/// Add a frontend log entry to the buffer
/// This allows the main app window to send console logs to the backend buffer
#[tauri::command]
pub async fn add_frontend_log(
    level: String,
    target: String,
    message: String,
) -> AppResult<()> {
    let entry = LogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        level,
        target,
        message,
    };
    log_buffer::push_log(entry);
    Ok(())
}

// ============================================================================
// System Info
// ============================================================================

/// Collect system information for bug reports
#[tauri::command]
pub async fn get_system_info_for_report(state: State<'_, SharedState>) -> AppResult<SystemInfo> {
    let state = state.read().await;

    // Get memory info
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    // Get running instances
    let running = state.running_instances.read().await;

    // Get all instances from DB
    let instances = crate::db::instances::Instance::get_all(&state.db).await?;

    let active_instances: Vec<ActiveInstanceInfo> = instances
        .into_iter()
        .map(|i| ActiveInstanceInfo {
            name: i.name,
            mc_version: i.mc_version,
            loader: i.loader,
            is_running: running.contains_key(&i.id),
        })
        .collect();

    Ok(SystemInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        os_version: sysinfo::System::os_version().unwrap_or_else(|| "Unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        available_memory_mb: sys.available_memory() / 1024 / 1024,
        active_instances,
    })
}

// ============================================================================
// Bug Report Submission
// ============================================================================

/// Submit a bug report to the configured Discord webhook
#[tauri::command]
pub async fn submit_bug_report(
    state: State<'_, SharedState>,
    user_message: Option<String>,
    screenshot_base64: Option<String>,
    include_logs: Option<bool>,
) -> AppResult<()> {
    let state = state.read().await;

    // Get webhook URL
    let encrypted = settings::get_setting(&state.db, "bug_report_webhook").await?;
    let webhook_url = match encrypted {
        Some(enc) if crypto::is_encrypted(&enc) => crypto::decrypt(&state.encryption_key, &enc)?,
        Some(url) => url,
        None => {
            return Err(AppError::DevTools(
                "Bug report webhook not configured".to_string(),
            ))
        }
    };

    // Collect system info
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let running = state.running_instances.read().await;
    let instances = crate::db::instances::Instance::get_all(&state.db).await?;

    let system_info = SystemInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        os_version: sysinfo::System::os_version().unwrap_or_else(|| "Unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        available_memory_mb: sys.available_memory() / 1024 / 1024,
        active_instances: instances
            .into_iter()
            .map(|i| ActiveInstanceInfo {
                name: i.name,
                mc_version: i.mc_version,
                loader: i.loader,
                is_running: running.contains_key(&i.id),
            })
            .collect(),
    };

    // Get logs if requested (default: true)
    let log_lines = if include_logs.unwrap_or(true) {
        log_buffer::get_recent_logs(100)
            .into_iter()
            .map(|e| format!("[{}] {} {}: {}", e.timestamp, e.level, e.target, e.message))
            .collect()
    } else {
        Vec::new()
    };

    let report = BugReport {
        user_message,
        system_info,
        log_lines,
        screenshot_base64,
    };

    bug_report::send_bug_report(&state.http_client, &webhook_url, &report).await?;

    tracing::info!("Bug report submitted successfully");
    Ok(())
}

// ============================================================================
// Log Viewer Window
// ============================================================================

/// Open the log viewer in a separate window
#[tauri::command]
pub async fn open_log_viewer_window(app: AppHandle) -> AppResult<()> {
    // Check if window already exists
    if let Some(window) = app.get_webview_window("log-viewer") {
        window
            .set_focus()
            .map_err(|e| AppError::DevTools(format!("Failed to focus log viewer: {}", e)))?;
        return Ok(());
    }

    // Create new window
    WebviewWindowBuilder::new(&app, "log-viewer", WebviewUrl::App("/log-viewer".into()))
        .title("Kaizen Launcher - Log Viewer")
        .inner_size(900.0, 600.0)
        .min_inner_size(600.0, 400.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| AppError::DevTools(format!("Failed to create log viewer window: {}", e)))?;

    Ok(())
}

/// Close the log viewer window
#[tauri::command]
pub async fn close_log_viewer_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("log-viewer") {
        window
            .close()
            .map_err(|e| AppError::DevTools(format!("Failed to close log viewer: {}", e)))?;
    }
    Ok(())
}

// ============================================================================
// Documentation Window
// ============================================================================

/// Open the documentation in a separate window
#[tauri::command]
pub async fn open_documentation_window(app: AppHandle) -> AppResult<()> {
    // Check if window already exists
    if let Some(window) = app.get_webview_window("documentation") {
        window
            .set_focus()
            .map_err(|e| AppError::DevTools(format!("Failed to focus documentation: {}", e)))?;
        return Ok(());
    }

    // Create new window
    WebviewWindowBuilder::new(&app, "documentation", WebviewUrl::App("/documentation".into()))
        .title("Kaizen Launcher - Documentation")
        .inner_size(1000.0, 700.0)
        .min_inner_size(600.0, 400.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| AppError::DevTools(format!("Failed to create documentation window: {}", e)))?;

    Ok(())
}

/// Close the documentation window
#[tauri::command]
pub async fn close_documentation_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("documentation") {
        window
            .close()
            .map_err(|e| AppError::DevTools(format!("Failed to close documentation: {}", e)))?;
    }
    Ok(())
}
