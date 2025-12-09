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
