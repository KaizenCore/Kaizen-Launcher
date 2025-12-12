use crate::db::accounts::Account;
use crate::error::{AppError, AppResult};
use crate::skins::{
    cache, mineskin, mojang, optifine, sources, Cape, CapeSource, PlayerSkinProfile,
    SearchSkinsResponse, Skin, SkinVariant,
};
use crate::state::SharedState;
use std::path::PathBuf;
use tokio::fs;

// ==================== Current User Skin ====================

/// Check if an account is offline (cannot use Mojang API)
fn is_offline_account(account: &Account) -> bool {
    account.refresh_token.is_empty()
        || account.refresh_token == "offline"
        || account.access_token == "offline"
        || account.access_token.len() < 50
}

/// Get current skin profile for an account
#[tauri::command]
pub async fn get_skin_profile(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> AppResult<PlayerSkinProfile> {
    let state = state.read().await;

    // Get account
    let account = Account::get_by_id(&state.db, &account_id)
        .await
        .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?
        .ok_or_else(|| AppError::Skin("Account not found".to_string()))?;

    // Check if offline account
    if is_offline_account(&account) {
        // For offline accounts, try to get OptiFine cape only
        let mut capes = vec![];
        if let Ok(Some(optifine_cape)) =
            optifine::get_cape(&state.http_client, &account.username).await
        {
            capes.push(optifine_cape);
        }

        return Ok(PlayerSkinProfile {
            uuid: account.uuid.clone(),
            username: account.username.clone(),
            current_skin: None,
            available_capes: capes,
            current_cape: None,
        });
    }

    // Decrypt access token
    let access_token = crate::crypto::decrypt(&state.encryption_key, &account.access_token)
        .map_err(|e| AppError::Skin(format!("Failed to decrypt token: {}", e)))?;

    // Fetch from Mojang API
    let (current_skin, available_capes, current_cape) =
        match mojang::get_profile_skins(&state.http_client, &access_token).await {
            Ok(result) => result,
            Err(_) => {
                // Token might be expired or invalid, treat as offline for now
                return Ok(PlayerSkinProfile {
                    uuid: account.uuid.clone(),
                    username: account.username.clone(),
                    current_skin: None,
                    available_capes: vec![],
                    current_cape: None,
                });
            }
        };

    // Also check for OptiFine cape
    let mut all_capes = available_capes;
    if let Ok(Some(optifine_cape)) = optifine::get_cape(&state.http_client, &account.username).await
    {
        all_capes.push(optifine_cape);
    }

    Ok(PlayerSkinProfile {
        uuid: account.uuid,
        username: account.username,
        current_skin,
        available_capes: all_capes,
        current_cape,
    })
}

/// Apply a skin from URL to the user's account
#[tauri::command]
pub async fn apply_skin(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    skin_url: String,
    variant: SkinVariant,
) -> AppResult<()> {
    let state = state.read().await;

    // Get account
    let account = Account::get_by_id(&state.db, &account_id)
        .await
        .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?
        .ok_or_else(|| AppError::Skin("Account not found".to_string()))?;

    // Check if offline account
    if is_offline_account(&account) {
        return Err(AppError::Skin(
            "Cannot change skin for offline accounts".to_string(),
        ));
    }

    // Decrypt access token
    let access_token = crate::crypto::decrypt(&state.encryption_key, &account.access_token)
        .map_err(|e| AppError::Skin(format!("Failed to decrypt token: {}", e)))?;

    // Upload skin from URL
    mojang::upload_skin_from_url(&state.http_client, &access_token, &skin_url, &variant).await?;

    Ok(())
}

/// Apply a skin from file to the user's account
#[tauri::command]
pub async fn apply_skin_from_file(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    file_path: String,
    variant: SkinVariant,
) -> AppResult<()> {
    let state = state.read().await;

    // Get account
    let account = Account::get_by_id(&state.db, &account_id)
        .await
        .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?
        .ok_or_else(|| AppError::Skin("Account not found".to_string()))?;

    // Check if offline account
    if is_offline_account(&account) {
        return Err(AppError::Skin(
            "Cannot change skin for offline accounts".to_string(),
        ));
    }

    // Read file
    let file_data = fs::read(&file_path)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to read skin file: {}", e)))?;

    // Validate PNG
    if file_data.len() < 8 || &file_data[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(AppError::Skin("Invalid PNG file".to_string()));
    }

    // Decrypt access token
    let access_token = crate::crypto::decrypt(&state.encryption_key, &account.access_token)
        .map_err(|e| AppError::Skin(format!("Failed to decrypt token: {}", e)))?;

    // Upload skin
    mojang::upload_skin(&state.http_client, &access_token, file_data, &variant).await?;

    Ok(())
}

/// Reset skin to default
#[tauri::command]
pub async fn reset_skin(state: tauri::State<'_, SharedState>, account_id: String) -> AppResult<()> {
    let state = state.read().await;

    // Get account
    let account = Account::get_by_id(&state.db, &account_id)
        .await
        .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?
        .ok_or_else(|| AppError::Skin("Account not found".to_string()))?;

    // Check if offline account
    if is_offline_account(&account) {
        return Err(AppError::Skin(
            "Cannot reset skin for offline accounts".to_string(),
        ));
    }

    // Decrypt access token
    let access_token = crate::crypto::decrypt(&state.encryption_key, &account.access_token)
        .map_err(|e| AppError::Skin(format!("Failed to decrypt token: {}", e)))?;

    mojang::reset_skin(&state.http_client, &access_token).await?;

    Ok(())
}

// ==================== Capes ====================

/// Get available capes for an account
#[tauri::command]
pub async fn get_available_capes(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> AppResult<Vec<Cape>> {
    let state = state.read().await;

    // Get account
    let account = Account::get_by_id(&state.db, &account_id)
        .await
        .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?
        .ok_or_else(|| AppError::Skin("Account not found".to_string()))?;

    // Check if offline account
    if is_offline_account(&account) {
        // Only check OptiFine for offline accounts
        if let Ok(Some(cape)) = optifine::get_cape(&state.http_client, &account.username).await {
            return Ok(vec![cape]);
        }
        return Ok(vec![]);
    }

    // Decrypt access token
    let access_token = crate::crypto::decrypt(&state.encryption_key, &account.access_token)
        .map_err(|e| AppError::Skin(format!("Failed to decrypt token: {}", e)))?;

    // Get Mojang capes
    let (_, mut capes, _) = match mojang::get_profile_skins(&state.http_client, &access_token).await
    {
        Ok(result) => result,
        Err(_) => (None, vec![], None),
    };

    // Also check OptiFine
    if let Ok(Some(cape)) = optifine::get_cape(&state.http_client, &account.username).await {
        capes.push(cape);
    }

    Ok(capes)
}

/// Get OptiFine cape for a username
#[tauri::command]
pub async fn get_optifine_cape(
    state: tauri::State<'_, SharedState>,
    username: String,
) -> AppResult<Option<Cape>> {
    let state = state.read().await;
    optifine::get_cape(&state.http_client, &username).await
}

/// Set active cape (or hide if cape_id is empty)
#[tauri::command]
pub async fn set_active_cape(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    cape_id: Option<String>,
) -> AppResult<()> {
    let state = state.read().await;

    // Get account
    let account = Account::get_by_id(&state.db, &account_id)
        .await
        .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?
        .ok_or_else(|| AppError::Skin("Account not found".to_string()))?;

    // Check if offline account
    if is_offline_account(&account) {
        return Err(AppError::Skin(
            "Cannot change cape for offline accounts".to_string(),
        ));
    }

    // Decrypt access token
    let access_token = crate::crypto::decrypt(&state.encryption_key, &account.access_token)
        .map_err(|e| AppError::Skin(format!("Failed to decrypt token: {}", e)))?;

    mojang::set_active_cape(&state.http_client, &access_token, cape_id.as_deref()).await?;

    Ok(())
}

// ==================== Community Skins ====================

/// Search community skins - searches by player username or MineSkin gallery
#[tauri::command]
pub async fn search_community_skins(
    state: tauri::State<'_, SharedState>,
    query: String,
    _page: u32,
) -> AppResult<SearchSkinsResponse> {
    let state = state.read().await;

    // If query looks like a username, search for player skin
    if !query.is_empty()
        && query.len() <= 16
        && query.chars().all(|c| c.is_alphanumeric() || c == '_')
    {
        // Try to find player skin first
        if let Ok(result) = sources::search_player_skins(&state.http_client, &query).await {
            if !result.skins.is_empty() {
                return Ok(result);
            }
        }
    }

    // Fallback to MineSkin gallery
    sources::fetch_mineskin_gallery(&state.http_client, 24, None).await
}

/// Get trending/popular skins - mix of MineSkin gallery and popular players
#[tauri::command]
pub async fn get_trending_skins(
    state: tauri::State<'_, SharedState>,
    _page: u32,
) -> AppResult<SearchSkinsResponse> {
    let state = state.read().await;

    // Get popular player skins
    let popular_result = sources::get_popular_player_skins(&state.http_client).await;

    // Get MineSkin gallery
    let mineskin_result = sources::fetch_mineskin_gallery(&state.http_client, 24, None).await;

    // Combine results
    let mut all_skins = Vec::new();

    if let Ok(popular) = popular_result {
        all_skins.extend(popular.skins);
    }

    if let Ok(mineskin) = mineskin_result {
        all_skins.extend(mineskin.skins);
    }

    Ok(SearchSkinsResponse {
        skins: all_skins,
        total: 0,
        page: 0,
        has_more: true,
    })
}

/// Get recent skins from MineSkin gallery
#[tauri::command]
pub async fn get_recent_skins(
    state: tauri::State<'_, SharedState>,
    _page: u32,
) -> AppResult<SearchSkinsResponse> {
    let state = state.read().await;
    sources::fetch_mineskin_gallery(&state.http_client, 24, None).await
}

/// Search for a specific player's skin by username
#[tauri::command]
pub async fn search_player_skin(
    state: tauri::State<'_, SharedState>,
    username: String,
) -> AppResult<Option<crate::skins::CommunitySkin>> {
    let state = state.read().await;
    sources::search_player_skin(&state.http_client, &username).await
}

/// Get all available capes for a player from multiple sources (Capes.dev)
#[tauri::command]
pub async fn get_all_player_capes(
    state: tauri::State<'_, SharedState>,
    username: String,
) -> AppResult<Vec<Cape>> {
    let state = state.read().await;

    let capes_response = sources::fetch_all_capes(&state.http_client, &username).await?;
    let mut capes = Vec::new();

    // Minecraft official cape
    if let Some(mc) = capes_response.minecraft {
        if mc.exists {
            if let Some(url) = mc.image_url.or(mc.cape_url) {
                capes.push(Cape {
                    id: format!("minecraft_{}", username),
                    name: "Minecraft".to_string(),
                    url,
                    source: CapeSource::Mojang,
                });
            }
        }
    }

    // OptiFine cape
    if let Some(of) = capes_response.optifine {
        if of.exists {
            if let Some(url) = of.image_url.or(of.cape_url) {
                capes.push(Cape {
                    id: format!("optifine_{}", username),
                    name: "OptiFine".to_string(),
                    url,
                    source: CapeSource::OptiFine,
                });
            }
        }
    }

    // LabyMod cape
    if let Some(laby) = capes_response.labymod {
        if laby.exists {
            if let Some(url) = laby.image_url.or(laby.cape_url) {
                capes.push(Cape {
                    id: format!("labymod_{}", username),
                    name: "LabyMod".to_string(),
                    url,
                    source: CapeSource::LabyMod,
                });
            }
        }
    }

    // MinecraftCapes cape
    if let Some(mcc) = capes_response.minecraftcapes {
        if mcc.exists {
            if let Some(url) = mcc.image_url.or(mcc.cape_url) {
                capes.push(Cape {
                    id: format!("minecraftcapes_{}", username),
                    name: "MinecraftCapes".to_string(),
                    url,
                    source: CapeSource::MinecraftCapes,
                });
            }
        }
    }

    // 5zig cape
    if let Some(fz) = capes_response.fivezig {
        if fz.exists {
            if let Some(url) = fz.image_url.or(fz.cape_url) {
                capes.push(Cape {
                    id: format!("5zig_{}", username),
                    name: "5zig".to_string(),
                    url,
                    source: CapeSource::FiveZig,
                });
            }
        }
    }

    Ok(capes)
}

// ==================== Favorites ====================

/// Favorite skin data for DB
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct FavoriteSkin {
    pub id: String,
    pub skin_id: String,
    pub name: String,
    pub url: String,
    pub thumbnail_url: String,
    pub variant: String,
    pub source: String,
    pub author: Option<String>,
    pub created_at: String,
}

/// Get all favorite skins
#[tauri::command]
pub async fn get_favorite_skins(
    state: tauri::State<'_, SharedState>,
) -> AppResult<Vec<FavoriteSkin>> {
    let state = state.read().await;

    let favorites = sqlx::query_as::<_, FavoriteSkin>(
        r#"
        SELECT id, skin_id, name, url, thumbnail_url, variant, source, author, created_at
        FROM skin_favorites
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?;

    Ok(favorites)
}

/// Add a skin to favorites
#[tauri::command]
pub async fn add_favorite_skin(
    state: tauri::State<'_, SharedState>,
    skin_id: String,
    name: String,
    url: String,
    thumbnail_url: String,
    variant: String,
    source: String,
    author: Option<String>,
) -> AppResult<String> {
    let state = state.read().await;

    // Generate unique ID
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO skin_favorites (id, skin_id, name, url, thumbnail_url, variant, source, author)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&skin_id)
    .bind(&name)
    .bind(&url)
    .bind(&thumbnail_url)
    .bind(&variant)
    .bind(&source)
    .bind(&author)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Skin(format!("Failed to add favorite: {}", e)))?;

    Ok(id)
}

/// Remove a skin from favorites
#[tauri::command]
pub async fn remove_favorite_skin(
    state: tauri::State<'_, SharedState>,
    id: String,
) -> AppResult<()> {
    let state = state.read().await;

    sqlx::query("DELETE FROM skin_favorites WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to remove favorite: {}", e)))?;

    Ok(())
}

/// Check if a skin is favorited
#[tauri::command]
pub async fn is_skin_favorited(
    state: tauri::State<'_, SharedState>,
    skin_id: String,
) -> AppResult<Option<String>> {
    let state = state.read().await;

    let result: Option<(String,)> =
        sqlx::query_as("SELECT id FROM skin_favorites WHERE skin_id = ?")
            .bind(&skin_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| AppError::Skin(format!("Database error: {}", e)))?;

    Ok(result.map(|(id,)| id))
}

// ==================== Custom Skin Upload ====================

/// Generate skin from URL using MineSkin
#[tauri::command]
pub async fn upload_skin_from_url(
    state: tauri::State<'_, SharedState>,
    url: String,
    variant: SkinVariant,
) -> AppResult<mineskin::MineSkinResult> {
    let state = state.read().await;
    mineskin::generate_from_url(&state.http_client, &url, &variant, None).await
}

/// Generate skin from file using MineSkin
#[tauri::command]
pub async fn upload_skin_from_file_mineskin(
    state: tauri::State<'_, SharedState>,
    file_path: String,
    variant: SkinVariant,
) -> AppResult<mineskin::MineSkinResult> {
    let state = state.read().await;

    // Read file
    let file_data = fs::read(&file_path)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to read skin file: {}", e)))?;

    // Validate PNG
    if file_data.len() < 8 || &file_data[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(AppError::Skin("Invalid PNG file".to_string()));
    }

    mineskin::generate_from_file(&state.http_client, file_data, &variant, None).await
}

// ==================== Cache ====================

/// Get cached skins
#[tauri::command]
pub async fn get_cached_skins(state: tauri::State<'_, SharedState>) -> AppResult<Vec<Skin>> {
    let state = state.read().await;
    cache::get_cached_skins(&state.data_dir).await
}

/// Cache a skin
#[tauri::command]
pub async fn cache_skin(state: tauri::State<'_, SharedState>, skin: Skin) -> AppResult<PathBuf> {
    let state_guard = state.read().await;

    // Download the skin image
    let response = state_guard
        .http_client
        .get(&skin.url)
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to download skin: {}", e)))?;

    let image_data = response
        .bytes()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to read skin data: {}", e)))?;

    cache::cache_skin(&state_guard.data_dir, &skin, &image_data).await
}

/// Delete a cached skin
#[tauri::command]
pub async fn delete_cached_skin(
    state: tauri::State<'_, SharedState>,
    skin_id: String,
) -> AppResult<()> {
    let state = state.read().await;
    cache::delete_cached_skin(&state.data_dir, &skin_id).await
}

/// Get cache size
#[tauri::command]
pub async fn get_skin_cache_size(state: tauri::State<'_, SharedState>) -> AppResult<u64> {
    let state = state.read().await;
    cache::get_cache_size(&state.data_dir).await
}

/// Cleanup old cache entries
#[tauri::command]
pub async fn cleanup_skin_cache(
    state: tauri::State<'_, SharedState>,
    max_age_days: u32,
) -> AppResult<u64> {
    let state = state.read().await;
    cache::cleanup_cache(&state.data_dir, max_age_days).await
}

/// Download skin image for preview (returns base64)
#[tauri::command]
pub async fn download_skin_image(
    state: tauri::State<'_, SharedState>,
    url: String,
) -> AppResult<String> {
    let state = state.read().await;

    let response = state
        .http_client
        .get(&url)
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to download skin: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Skin(format!(
            "Failed to download skin: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to read skin data: {}", e)))?;

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(STANDARD.encode(&bytes))
}
