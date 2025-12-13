//! Bug report generation and Discord webhook submission
//! Sends bug reports with system info, logs, and screenshots to Discord

use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};

/// System information included in bug reports
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub app_version: String,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub total_memory_mb: u64,
    pub available_memory_mb: u64,
    pub active_instances: Vec<ActiveInstanceInfo>,
}

/// Information about an active instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveInstanceInfo {
    pub name: String,
    pub mc_version: String,
    pub loader: Option<String>,
    pub is_running: bool,
}

/// Complete bug report data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BugReport {
    pub user_message: Option<String>,
    pub system_info: SystemInfo,
    pub log_lines: Vec<String>,
    pub screenshot_base64: Option<String>,
}

/// Send a bug report to a Discord webhook
/// Includes embed with system info and file attachments for logs/screenshot
pub async fn send_bug_report(
    client: &reqwest::Client,
    webhook_url: &str,
    report: &BugReport,
) -> AppResult<()> {
    // Build the Discord embed
    let embed = build_embed(report);

    // Build payload JSON
    let payload = serde_json::json!({
        "username": "Kaizen Bug Reporter",
        "avatar_url": "https://raw.githubusercontent.com/KaizenCore/Kaizen-Launcher/main/src-tauri/icons/icon.png",
        "embeds": [embed]
    });

    // Create multipart form
    let mut form = Form::new().text("payload_json", payload.to_string());

    // Add logs file if we have logs
    if !report.log_lines.is_empty() {
        let log_content = report.log_lines.join("\n");
        let log_part = Part::bytes(log_content.into_bytes())
            .file_name("logs.txt")
            .mime_str("text/plain")
            .map_err(|e| AppError::DevTools(format!("Failed to create log part: {}", e)))?;
        form = form.part("files[0]", log_part);
    }

    // Add screenshot if provided
    if let Some(screenshot_b64) = &report.screenshot_base64 {
        let screenshot_bytes = BASE64
            .decode(screenshot_b64)
            .map_err(|e| AppError::DevTools(format!("Invalid screenshot base64: {}", e)))?;

        let screenshot_part = Part::bytes(screenshot_bytes)
            .file_name("screenshot.png")
            .mime_str("image/png")
            .map_err(|e| AppError::DevTools(format!("Failed to create screenshot part: {}", e)))?;
        form = form.part("files[1]", screenshot_part);
    }

    // Send the request
    let response = client
        .post(webhook_url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::DevTools(format!("Failed to send bug report: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(AppError::DevTools(format!(
            "Discord webhook failed ({}): {}",
            status, body
        )));
    }

    Ok(())
}

/// Build a Discord embed for the bug report
fn build_embed(report: &BugReport) -> serde_json::Value {
    let mut fields = vec![
        serde_json::json!({
            "name": "App Version",
            "value": format!("`{}`", report.system_info.app_version),
            "inline": true
        }),
        serde_json::json!({
            "name": "OS",
            "value": format!("`{} {} ({})`",
                report.system_info.os,
                report.system_info.os_version,
                report.system_info.arch
            ),
            "inline": true
        }),
        serde_json::json!({
            "name": "RAM",
            "value": format!("`{} GB / {} GB`",
                (report.system_info.total_memory_mb - report.system_info.available_memory_mb) / 1024,
                report.system_info.total_memory_mb / 1024
            ),
            "inline": true
        }),
    ];

    // Add instances info if any
    if !report.system_info.active_instances.is_empty() {
        let instances_str = report
            .system_info
            .active_instances
            .iter()
            .take(5) // Limit to 5 to avoid embed limits
            .map(|i| {
                let running_indicator = if i.is_running { " [Running]" } else { "" };
                let loader_str = i
                    .loader
                    .as_ref()
                    .map(|l| format!(" + {}", l))
                    .unwrap_or_default();
                format!("- **{}** ({}{}){}", i.name, i.mc_version, loader_str, running_indicator)
            })
            .collect::<Vec<_>>()
            .join("\n");

        fields.push(serde_json::json!({
            "name": format!("Instances ({})", report.system_info.active_instances.len()),
            "value": instances_str,
            "inline": false
        }));
    }

    // Add log count
    if !report.log_lines.is_empty() {
        fields.push(serde_json::json!({
            "name": "Logs",
            "value": format!("`{} lines attached`", report.log_lines.len()),
            "inline": true
        }));
    }

    // Add screenshot indicator
    if report.screenshot_base64.is_some() {
        fields.push(serde_json::json!({
            "name": "Screenshot",
            "value": "`Attached`",
            "inline": true
        }));
    }

    serde_json::json!({
        "title": "Bug Report",
        "description": report.user_message.clone().unwrap_or_else(|| "_No description provided_".to_string()),
        "color": 0xef4444, // Red
        "fields": fields,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "footer": {
            "text": "Kaizen Launcher Bug Report",
            "icon_url": "https://raw.githubusercontent.com/KaizenCore/Kaizen-Launcher/main/src-tauri/icons/32x32.png"
        },
        "image": if report.screenshot_base64.is_some() {
            serde_json::json!({ "url": "attachment://screenshot.png" })
        } else {
            serde_json::Value::Null
        }
    })
}

/// Validate a Discord webhook URL
pub fn is_valid_webhook_url(url: &str) -> bool {
    url.starts_with("https://discord.com/api/webhooks/")
        || url.starts_with("https://discordapp.com/api/webhooks/")
        || url.starts_with("https://canary.discord.com/api/webhooks/")
        || url.starts_with("https://ptb.discord.com/api/webhooks/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webhook_url_validation() {
        assert!(is_valid_webhook_url(
            "https://discord.com/api/webhooks/123456/abcdef"
        ));
        assert!(is_valid_webhook_url(
            "https://discordapp.com/api/webhooks/123456/abcdef"
        ));
        assert!(is_valid_webhook_url(
            "https://canary.discord.com/api/webhooks/123/abc"
        ));
        assert!(!is_valid_webhook_url("https://example.com/webhook"));
        assert!(!is_valid_webhook_url("http://discord.com/api/webhooks/123"));
    }

    #[test]
    fn test_embed_building() {
        let report = BugReport {
            user_message: Some("Test bug".to_string()),
            system_info: SystemInfo {
                app_version: "1.0.0".to_string(),
                os: "Windows".to_string(),
                os_version: "10".to_string(),
                arch: "x86_64".to_string(),
                total_memory_mb: 16384,
                available_memory_mb: 8192,
                active_instances: vec![ActiveInstanceInfo {
                    name: "Test".to_string(),
                    mc_version: "1.20.4".to_string(),
                    loader: Some("Fabric".to_string()),
                    is_running: true,
                }],
            },
            log_lines: vec!["line1".to_string(), "line2".to_string()],
            screenshot_base64: None,
        };

        let embed = build_embed(&report);
        assert_eq!(embed["title"], "Bug Report");
        assert_eq!(embed["description"], "Test bug");
        assert_eq!(embed["color"], 0xef4444);
    }
}
