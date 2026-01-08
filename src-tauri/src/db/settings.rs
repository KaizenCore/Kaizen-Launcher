use crate::error::AppResult;
use crate::state::SharedState;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(FromRow)]
#[allow(dead_code)]
struct SettingRow {
    value: String,
}

#[derive(FromRow)]
#[allow(dead_code)]
struct SettingKeyValue {
    key: String,
    value: String,
}

#[allow(dead_code)]
pub async fn get_setting(db: &SqlitePool, key: &str) -> sqlx::Result<Option<String>> {
    let row = sqlx::query_as::<_, SettingRow>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await?;

    Ok(row.map(|r| r.value))
}

#[allow(dead_code)]
pub async fn set_setting(db: &SqlitePool, key: &str, value: &str) -> sqlx::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        "#,
    )
    .bind(key)
    .bind(value)
    .execute(db)
    .await?;
    Ok(())
}

#[allow(dead_code)]
pub async fn get_all_settings(db: &SqlitePool) -> sqlx::Result<Vec<(String, String)>> {
    let rows = sqlx::query_as::<_, SettingKeyValue>("SELECT key, value FROM settings")
        .fetch_all(db)
        .await?;

    Ok(rows.into_iter().map(|r| (r.key, r.value)).collect())
}

// ============================================================================
// Appearance Settings - Tauri Commands
// ============================================================================

/// Appearance settings structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    pub locale: String,
    pub theme: String,
    pub custom_theme: Option<CustomThemeSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomThemeSettings {
    pub primary_hue: i32,
    pub primary_saturation: i32,
    pub secondary_hue: i32,
    pub secondary_saturation: i32,
    pub active_preset_id: Option<String>,
}

/// Get all appearance settings at once
#[tauri::command]
pub async fn get_appearance_settings(
    state: tauri::State<'_, SharedState>,
) -> AppResult<AppearanceSettings> {
    let state = state.read().await;

    let locale = get_setting(&state.db, "appearance_locale")
        .await?
        .unwrap_or_else(|| "en".to_string());

    let theme = get_setting(&state.db, "appearance_theme")
        .await?
        .unwrap_or_else(|| "system".to_string());

    let custom_theme = if let Some(json) = get_setting(&state.db, "appearance_custom_theme").await?
    {
        serde_json::from_str(&json).ok()
    } else {
        None
    };

    Ok(AppearanceSettings {
        locale,
        theme,
        custom_theme,
    })
}

/// Save a single appearance setting
#[tauri::command]
pub async fn save_appearance_setting(
    state: tauri::State<'_, SharedState>,
    key: String,
    value: String,
) -> AppResult<()> {
    let state = state.read().await;

    let db_key = format!("appearance_{}", key);
    set_setting(&state.db, &db_key, &value).await?;

    Ok(())
}

/// Save custom theme settings
#[tauri::command]
pub async fn save_custom_theme_settings(
    state: tauri::State<'_, SharedState>,
    settings: CustomThemeSettings,
) -> AppResult<()> {
    let state = state.read().await;

    let json = serde_json::to_string(&settings)?;
    set_setting(&state.db, "appearance_custom_theme", &json).await?;

    Ok(())
}

// ============================================================================
// Easy Mode Settings - Tauri Commands
// ============================================================================

/// Get the current easy mode setting
/// Defaults to true for novice-friendly experience
#[tauri::command]
pub async fn get_easy_mode_enabled(
    state: tauri::State<'_, SharedState>,
) -> AppResult<bool> {
    let state = state.read().await;
    let setting = get_setting(&state.db, "easy_mode_enabled").await?;
    Ok(setting.map(|s| s == "true").unwrap_or(true))
}

/// Set the easy mode setting
#[tauri::command]
pub async fn set_easy_mode_enabled(
    state: tauri::State<'_, SharedState>,
    enabled: bool,
) -> AppResult<()> {
    let state = state.read().await;
    set_setting(
        &state.db,
        "easy_mode_enabled",
        if enabled { "true" } else { "false" },
    )
    .await?;
    Ok(())
}

// ============================================================================
// Generic Settings Commands - For storing arbitrary key-value pairs
// ============================================================================

/// Get a generic setting value by key
#[tauri::command]
pub async fn get_setting_value(
    state: tauri::State<'_, SharedState>,
    key: String,
) -> AppResult<Option<String>> {
    let state = state.read().await;
    let value = get_setting(&state.db, &key).await?;
    Ok(value)
}

/// Set a generic setting value
#[tauri::command]
pub async fn set_setting_value(
    state: tauri::State<'_, SharedState>,
    key: String,
    value: String,
) -> AppResult<()> {
    let state = state.read().await;
    set_setting(&state.db, &key, &value).await?;
    Ok(())
}
