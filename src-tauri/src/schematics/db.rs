use crate::error::{AppError, AppResult};
use sqlx::{Row, SqlitePool};

use super::{
    Schematic, SchematicCloudSync, SchematicDimensions, SchematicFormat, SchematicInstanceLink,
    SchematicSource, SchematicStats, SyncStatus,
};

/// Get all schematics from the library
pub async fn get_all_schematics(db: &SqlitePool) -> AppResult<Vec<Schematic>> {
    let rows = sqlx::query(
        r#"
        SELECT id, name, filename, format, file_hash, file_size_bytes, library_path,
               width, height, length, author, description, mc_version,
               is_favorite, tags, created_at, updated_at
        FROM schematics
        ORDER BY name ASC
        "#,
    )
    .fetch_all(db)
    .await?;

    let schematics = rows
        .into_iter()
        .map(|row| row_to_schematic(&row))
        .collect();

    Ok(schematics)
}

/// Get a schematic by ID
pub async fn get_schematic_by_id(db: &SqlitePool, id: &str) -> AppResult<Option<Schematic>> {
    let row = sqlx::query(
        r#"
        SELECT id, name, filename, format, file_hash, file_size_bytes, library_path,
               width, height, length, author, description, mc_version,
               is_favorite, tags, created_at, updated_at
        FROM schematics
        WHERE id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| row_to_schematic(&r)))
}

/// Get a schematic by file hash
pub async fn get_schematic_by_hash(db: &SqlitePool, hash: &str) -> AppResult<Option<Schematic>> {
    let row = sqlx::query(
        r#"
        SELECT id, name, filename, format, file_hash, file_size_bytes, library_path,
               width, height, length, author, description, mc_version,
               is_favorite, tags, created_at, updated_at
        FROM schematics
        WHERE file_hash = ?
        "#,
    )
    .bind(hash)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| row_to_schematic(&r)))
}

/// Convert a database row to a Schematic struct
fn row_to_schematic(row: &sqlx::sqlite::SqliteRow) -> Schematic {
    let width: Option<i64> = row.try_get("width").ok();
    let height: Option<i64> = row.try_get("height").ok();
    let length: Option<i64> = row.try_get("length").ok();

    let dimensions = match (width, height, length) {
        (Some(w), Some(h), Some(l)) => Some(SchematicDimensions {
            width: w as i32,
            height: h as i32,
            length: l as i32,
        }),
        _ => None,
    };

    let tags_str: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();

    let format_str: String = row.get("format");
    let is_favorite: i32 = row.try_get("is_favorite").unwrap_or(0);
    let file_size: i64 = row.get("file_size_bytes");

    Schematic {
        id: row.get("id"),
        name: row.get("name"),
        filename: row.get("filename"),
        format: SchematicFormat::from_extension(&format_str).unwrap_or(SchematicFormat::Schem),
        file_hash: row.get("file_hash"),
        file_size_bytes: file_size as u64,
        library_path: row.try_get("library_path").ok(),
        dimensions,
        author: row.try_get("author").ok(),
        description: row.try_get("description").ok(),
        mc_version: row.try_get("mc_version").ok(),
        is_favorite: is_favorite != 0,
        tags,
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    }
}

/// Insert a new schematic
pub async fn insert_schematic(db: &SqlitePool, schematic: &Schematic) -> AppResult<()> {
    let format = schematic.format.as_str();
    let file_size = schematic.file_size_bytes as i64;
    let (width, height, length): (Option<i64>, Option<i64>, Option<i64>) = schematic
        .dimensions
        .as_ref()
        .map(|d| {
            (
                Some(d.width as i64),
                Some(d.height as i64),
                Some(d.length as i64),
            )
        })
        .unwrap_or((None, None, None));
    let is_favorite: i32 = if schematic.is_favorite { 1 } else { 0 };
    let tags = serde_json::to_string(&schematic.tags).unwrap_or_else(|_| "[]".to_string());

    sqlx::query(
        r#"
        INSERT INTO schematics (
            id, name, filename, format, file_hash, file_size_bytes, library_path,
            width, height, length, author, description, mc_version,
            is_favorite, tags, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&schematic.id)
    .bind(&schematic.name)
    .bind(&schematic.filename)
    .bind(format)
    .bind(&schematic.file_hash)
    .bind(file_size)
    .bind(&schematic.library_path)
    .bind(width)
    .bind(height)
    .bind(length)
    .bind(&schematic.author)
    .bind(&schematic.description)
    .bind(&schematic.mc_version)
    .bind(is_favorite)
    .bind(&tags)
    .bind(&schematic.created_at)
    .bind(&schematic.updated_at)
    .execute(db)
    .await?;

    Ok(())
}

/// Update a schematic
pub async fn update_schematic(db: &SqlitePool, schematic: &Schematic) -> AppResult<()> {
    let format = schematic.format.as_str();
    let file_size = schematic.file_size_bytes as i64;
    let (width, height, length): (Option<i64>, Option<i64>, Option<i64>) = schematic
        .dimensions
        .as_ref()
        .map(|d| {
            (
                Some(d.width as i64),
                Some(d.height as i64),
                Some(d.length as i64),
            )
        })
        .unwrap_or((None, None, None));
    let is_favorite: i32 = if schematic.is_favorite { 1 } else { 0 };
    let tags = serde_json::to_string(&schematic.tags).unwrap_or_else(|_| "[]".to_string());

    sqlx::query(
        r#"
        UPDATE schematics SET
            name = ?, filename = ?, format = ?, file_hash = ?, file_size_bytes = ?,
            library_path = ?, width = ?, height = ?, length = ?,
            author = ?, description = ?, mc_version = ?,
            is_favorite = ?, tags = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&schematic.name)
    .bind(&schematic.filename)
    .bind(format)
    .bind(&schematic.file_hash)
    .bind(file_size)
    .bind(&schematic.library_path)
    .bind(width)
    .bind(height)
    .bind(length)
    .bind(&schematic.author)
    .bind(&schematic.description)
    .bind(&schematic.mc_version)
    .bind(is_favorite)
    .bind(&tags)
    .bind(&schematic.updated_at)
    .bind(&schematic.id)
    .execute(db)
    .await?;

    Ok(())
}

/// Delete a schematic
pub async fn delete_schematic(db: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM schematics WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Toggle favorite status
pub async fn toggle_favorite(db: &SqlitePool, id: &str) -> AppResult<bool> {
    let row = sqlx::query("SELECT is_favorite FROM schematics WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::Schematic("Schematic not found".to_string()))?;

    let current: i32 = row.try_get("is_favorite").unwrap_or(0);
    let new_favorite: i32 = if current != 0 { 0 } else { 1 };
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query("UPDATE schematics SET is_favorite = ?, updated_at = ? WHERE id = ?")
        .bind(new_favorite)
        .bind(&now)
        .bind(id)
        .execute(db)
        .await?;

    Ok(new_favorite != 0)
}

/// Update tags
pub async fn update_tags(db: &SqlitePool, id: &str, tags: &[String]) -> AppResult<()> {
    let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query("UPDATE schematics SET tags = ?, updated_at = ? WHERE id = ?")
        .bind(&tags_json)
        .bind(&now)
        .bind(id)
        .execute(db)
        .await?;

    Ok(())
}

/// Get schematic stats
pub async fn get_stats(db: &SqlitePool) -> AppResult<SchematicStats> {
    let stats_row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as total_count,
            COALESCE(SUM(file_size_bytes), 0) as total_size,
            COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) as favorites_count
        FROM schematics
        "#,
    )
    .fetch_one(db)
    .await?;

    let total_count: i32 = stats_row.try_get("total_count").unwrap_or(0);
    let total_size: i64 = stats_row.try_get("total_size").unwrap_or(0);
    let favorites_count: i32 = stats_row.try_get("favorites_count").unwrap_or(0);

    let format_rows = sqlx::query(
        r#"
        SELECT format, COUNT(*) as count
        FROM schematics
        GROUP BY format
        "#,
    )
    .fetch_all(db)
    .await?;

    let instance_count_row = sqlx::query(
        r#"
        SELECT COUNT(DISTINCT instance_id) as count
        FROM schematic_instance_links
        "#,
    )
    .fetch_one(db)
    .await?;

    let mut formats = std::collections::HashMap::new();
    for row in format_rows {
        let format: String = row.get("format");
        let count: i32 = row.try_get("count").unwrap_or(0);
        formats.insert(format, count as u32);
    }

    let instances_with_schematics: i32 = instance_count_row.try_get("count").unwrap_or(0);

    Ok(SchematicStats {
        total_schematics: total_count as u32,
        total_size_bytes: total_size as u64,
        favorites_count: favorites_count as u32,
        formats,
        instances_with_schematics: instances_with_schematics as u32,
    })
}

// ========== Instance Links ==========

/// Get all links for a schematic
pub async fn get_schematic_links(
    db: &SqlitePool,
    schematic_id: &str,
) -> AppResult<Vec<SchematicInstanceLink>> {
    let rows = sqlx::query(
        r#"
        SELECT id, schematic_id, instance_id, instance_path, source, sync_status, last_synced_at, created_at
        FROM schematic_instance_links
        WHERE schematic_id = ?
        "#,
    )
    .bind(schematic_id)
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row_to_link(&row)).collect())
}

/// Get ALL links (for batch operations - avoids N+1 queries)
pub async fn get_all_links(db: &SqlitePool) -> AppResult<Vec<SchematicInstanceLink>> {
    let rows = sqlx::query(
        r#"
        SELECT id, schematic_id, instance_id, instance_path, source, sync_status, last_synced_at, created_at
        FROM schematic_instance_links
        "#,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row_to_link(&row)).collect())
}

/// Get all links for an instance
pub async fn get_instance_links(
    db: &SqlitePool,
    instance_id: &str,
) -> AppResult<Vec<SchematicInstanceLink>> {
    let rows = sqlx::query(
        r#"
        SELECT id, schematic_id, instance_id, instance_path, source, sync_status, last_synced_at, created_at
        FROM schematic_instance_links
        WHERE instance_id = ?
        "#,
    )
    .bind(instance_id)
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row_to_link(&row)).collect())
}

/// Convert a database row to a SchematicInstanceLink struct
fn row_to_link(row: &sqlx::sqlite::SqliteRow) -> SchematicInstanceLink {
    let source_str: String = row.try_get("source").unwrap_or_else(|_| "library".to_string());
    let sync_str: String = row.try_get("sync_status").unwrap_or_else(|_| "synced".to_string());

    SchematicInstanceLink {
        id: row.get("id"),
        schematic_id: row.get("schematic_id"),
        instance_id: row.get("instance_id"),
        instance_path: row.get("instance_path"),
        source: SchematicSource::from_str(&source_str),
        sync_status: SyncStatus::from_str(&sync_str),
        last_synced_at: row.try_get("last_synced_at").ok(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    }
}

/// Insert a new link
pub async fn insert_link(db: &SqlitePool, link: &SchematicInstanceLink) -> AppResult<()> {
    let source = link.source.as_str();
    let sync_status = link.sync_status.as_str();

    sqlx::query(
        r#"
        INSERT INTO schematic_instance_links (
            id, schematic_id, instance_id, instance_path, source, sync_status, last_synced_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(schematic_id, instance_id) DO UPDATE SET
            instance_path = excluded.instance_path,
            source = excluded.source,
            sync_status = excluded.sync_status,
            last_synced_at = excluded.last_synced_at
        "#,
    )
    .bind(&link.id)
    .bind(&link.schematic_id)
    .bind(&link.instance_id)
    .bind(&link.instance_path)
    .bind(source)
    .bind(sync_status)
    .bind(&link.last_synced_at)
    .bind(&link.created_at)
    .execute(db)
    .await?;

    Ok(())
}

/// Update link sync status
pub async fn update_link_status(
    db: &SqlitePool,
    schematic_id: &str,
    instance_id: &str,
    status: SyncStatus,
) -> AppResult<()> {
    let status_str = status.as_str();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        UPDATE schematic_instance_links
        SET sync_status = ?, last_synced_at = ?
        WHERE schematic_id = ? AND instance_id = ?
        "#,
    )
    .bind(status_str)
    .bind(&now)
    .bind(schematic_id)
    .bind(instance_id)
    .execute(db)
    .await?;

    Ok(())
}

/// Delete a link
pub async fn delete_link(db: &SqlitePool, schematic_id: &str, instance_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM schematic_instance_links WHERE schematic_id = ? AND instance_id = ?")
        .bind(schematic_id)
        .bind(instance_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Delete all links for a schematic
pub async fn delete_all_links_for_schematic(db: &SqlitePool, schematic_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM schematic_instance_links WHERE schematic_id = ?")
        .bind(schematic_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Get all conflicts
pub async fn get_conflicts(db: &SqlitePool) -> AppResult<Vec<SchematicInstanceLink>> {
    let rows = sqlx::query(
        r#"
        SELECT id, schematic_id, instance_id, instance_path, source, sync_status, last_synced_at, created_at
        FROM schematic_instance_links
        WHERE sync_status = 'conflict'
        "#,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row_to_link(&row)).collect())
}

// ========== Cloud Sync ==========

/// Get cloud sync status for a schematic
pub async fn get_cloud_sync(
    db: &SqlitePool,
    schematic_id: &str,
) -> AppResult<Option<SchematicCloudSync>> {
    let row = sqlx::query(
        r#"
        SELECT id, schematic_id, remote_path, sync_status, last_synced_at, error_message, created_at
        FROM schematic_cloud_sync
        WHERE schematic_id = ?
        "#,
    )
    .bind(schematic_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| SchematicCloudSync {
        id: row.get("id"),
        schematic_id: row.get("schematic_id"),
        remote_path: row.try_get("remote_path").ok(),
        sync_status: row
            .try_get("sync_status")
            .unwrap_or_else(|_| "pending".to_string()),
        last_synced_at: row.try_get("last_synced_at").ok(),
        error_message: row.try_get("error_message").ok(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    }))
}

/// Insert or update cloud sync record
pub async fn upsert_cloud_sync(db: &SqlitePool, sync: &SchematicCloudSync) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO schematic_cloud_sync (id, schematic_id, remote_path, sync_status, last_synced_at, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(schematic_id) DO UPDATE SET
            remote_path = excluded.remote_path,
            sync_status = excluded.sync_status,
            last_synced_at = excluded.last_synced_at,
            error_message = excluded.error_message
        "#,
    )
    .bind(&sync.id)
    .bind(&sync.schematic_id)
    .bind(&sync.remote_path)
    .bind(&sync.sync_status)
    .bind(&sync.last_synced_at)
    .bind(&sync.error_message)
    .bind(&sync.created_at)
    .execute(db)
    .await?;

    Ok(())
}

/// Delete cloud sync record
pub async fn delete_cloud_sync(db: &SqlitePool, schematic_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM schematic_cloud_sync WHERE schematic_id = ?")
        .bind(schematic_id)
        .execute(db)
        .await?;
    Ok(())
}
