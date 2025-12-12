// NameMC web scraping integration for skin browsing
// Prepared for future integration but not yet used in commands
#![allow(dead_code)]

use crate::error::{AppError, AppResult};
use crate::skins::{CommunitySkin, SearchSkinsResponse, SkinSource, SkinVariant};
use regex::Regex;
use std::sync::LazyLock;

const NAMEMC_BASE: &str = "https://namemc.com";
const NAMEMC_SKIN_BASE: &str = "https://s.namemc.com/i";

// Rate limiting: track last request time
static SKIN_HASH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"/skin/([a-f0-9]+)"#).unwrap());

/// Search skins on NameMC
/// Note: NameMC doesn't have an official API, this uses web scraping
pub async fn search_skins(
    client: &reqwest::Client,
    query: &str,
    page: u32,
) -> AppResult<SearchSkinsResponse> {
    let url = format!(
        "{}/minecraft-skins/search?q={}&page={}",
        NAMEMC_BASE,
        urlencoding::encode(query),
        page
    );

    let html = fetch_page(client, &url).await?;
    parse_skin_page(&html, page)
}

/// Get trending skins from NameMC
pub async fn get_trending_skins(
    client: &reqwest::Client,
    page: u32,
) -> AppResult<SearchSkinsResponse> {
    let url = format!("{}/minecraft-skins/trending?page={}", NAMEMC_BASE, page);
    let html = fetch_page(client, &url).await?;
    parse_skin_page(&html, page)
}

/// Get recent skins from NameMC
pub async fn get_recent_skins(
    client: &reqwest::Client,
    page: u32,
) -> AppResult<SearchSkinsResponse> {
    let url = format!("{}/minecraft-skins/new?page={}", NAMEMC_BASE, page);
    let html = fetch_page(client, &url).await?;
    parse_skin_page(&html, page)
}

/// Fetch a page with proper headers
async fn fetch_page(client: &reqwest::Client, url: &str) -> AppResult<String> {
    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Referer", "https://namemc.com/")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .header("Sec-Fetch-User", "?1")
        .header("Upgrade-Insecure-Requests", "1")
        .header("Cache-Control", "max-age=0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to fetch NameMC page: {}", e)))?;

    // Handle rate limiting / blocking gracefully - return empty results instead of error
    if !response.status().is_success() {
        log::warn!(
            "NameMC returned status {}, returning empty results",
            response.status()
        );
        return Ok(String::new());
    }

    response
        .text()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to read NameMC response: {}", e)))
}

/// Parse the HTML page to extract skin data
fn parse_skin_page(html: &str, page: u32) -> AppResult<SearchSkinsResponse> {
    let mut skins = Vec::new();

    // Find all skin hashes using regex
    for cap in SKIN_HASH_REGEX.captures_iter(html) {
        if let Some(hash) = cap.get(1) {
            let hash_str = hash.as_str();

            // Build skin URLs
            let thumbnail_url = format!("{}/{}.png", NAMEMC_SKIN_BASE, hash_str);
            let skin_url = format!(
                "https://texture.namemc.com/{}/{}.png",
                &hash_str[..2],
                hash_str
            );

            // Avoid duplicates
            if skins.iter().any(|s: &CommunitySkin| s.id == hash_str) {
                continue;
            }

            skins.push(CommunitySkin {
                id: hash_str.to_string(),
                name: format!("Skin {}", &hash_str[..8]),
                url: skin_url,
                thumbnail_url,
                variant: SkinVariant::Classic, // NameMC doesn't reliably expose this
                source: SkinSource::NameMC,
                author: None,
                downloads: None,
                likes: None,
            });
        }
    }

    // Limit to 24 skins per page (typical NameMC grid size)
    skins.truncate(24);

    let has_more = skins.len() >= 24;

    Ok(SearchSkinsResponse {
        total: if has_more {
            ((page + 1) * 24) as u64
        } else {
            ((page - 1) * 24 + skins.len() as u32) as u64
        },
        skins,
        page,
        has_more,
    })
}

/// Get direct skin URL from hash
pub fn get_skin_url(hash: &str) -> String {
    format!(
        "https://texture.namemc.com/{}/{}.png",
        &hash[..2.min(hash.len())],
        hash
    )
}

/// Get thumbnail URL from hash
pub fn get_thumbnail_url(hash: &str) -> String {
    format!("{}/{}.png", NAMEMC_SKIN_BASE, hash)
}
