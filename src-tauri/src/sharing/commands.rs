//! Tauri commands for instance sharing

use crate::db::instances::Instance;
use crate::error::AppResult;
use crate::sharing::manifest::{ExportOptions, ExportableContent, PreparedExport, SharingManifest};
use crate::sharing::{export, import};
use crate::state::SharedState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Get exportable content for an instance (for UI selection)
#[tauri::command]
pub async fn get_exportable_content(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<ExportableContent> {
    let state = state.read().await;
    let instances_dir = state.get_instances_dir().await;

    export::get_exportable_content(&state.db, &instances_dir, &instance_id).await
}

/// Prepare an export package
#[tauri::command]
pub async fn prepare_export(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
    options: ExportOptions,
) -> AppResult<PreparedExport> {
    let state = state.read().await;
    let instances_dir = state.get_instances_dir().await;

    export::prepare_export(
        &app,
        &state.db,
        &instances_dir,
        &state.data_dir,
        &instance_id,
        options,
    )
    .await
}

/// Cleanup export temp files
#[tauri::command]
pub async fn cleanup_export(state: State<'_, SharedState>, export_id: String) -> AppResult<()> {
    let state = state.read().await;
    export::cleanup_export(&state.data_dir, &export_id).await
}

/// Validate an import package
#[tauri::command]
pub async fn validate_import_package(package_path: String) -> AppResult<SharingManifest> {
    let path = PathBuf::from(&package_path);
    import::validate_import_package(&path).await
}

/// Import an instance from a package
#[tauri::command]
pub async fn import_instance(
    state: State<'_, SharedState>,
    app: AppHandle,
    package_path: String,
    new_name: Option<String>,
) -> AppResult<Instance> {
    let state = state.read().await;
    let instances_dir = state.get_instances_dir().await;
    let path = PathBuf::from(&package_path);

    import::import_instance(&app, &state.db, &instances_dir, &path, new_name).await
}

/// Get the sharing temp directory path
#[tauri::command]
pub async fn get_sharing_temp_dir(state: State<'_, SharedState>) -> AppResult<String> {
    let state = state.read().await;
    let temp_dir = export::get_sharing_temp_dir(&state.data_dir);
    Ok(temp_dir.to_string_lossy().to_string())
}
