//! Paper/Velocity/Waterfall/Folia API client
//! API: https://api.papermc.io/
//! Also handles: Purpur, Pufferfish, Spigot, Sponge

use crate::error::{AppError, AppResult};
use crate::modloader::LoaderVersion;
use serde::Deserialize;

const PAPER_API: &str = "https://api.papermc.io/v2";
const PURPUR_API: &str = "https://api.purpurmc.org/v2";
#[allow(dead_code)]
const PUFFERFISH_API: &str = "https://ci.pufferfish.host/job/Pufferfish-1.21";
const SPONGE_API: &str = "https://dl-api.spongepowered.org/v2";

#[derive(Debug, Clone, Copy)]
pub enum PaperProject {
    Paper,
    Velocity,
    Waterfall,
    Folia,
}

impl PaperProject {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Paper => "paper",
            Self::Velocity => "velocity",
            Self::Waterfall => "waterfall",
            Self::Folia => "folia",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ProjectVersions {
    #[allow(dead_code)]
    pub project_id: String,
    #[allow(dead_code)]
    pub project_name: String,
    pub versions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct VersionBuilds {
    #[allow(dead_code)]
    pub project_id: String,
    #[allow(dead_code)]
    pub version: String,
    pub builds: Vec<i32>,
}

#[derive(Debug, Deserialize)]
pub struct BuildInfo {
    #[allow(dead_code)]
    pub project_id: String,
    #[allow(dead_code)]
    pub version: String,
    #[allow(dead_code)]
    pub build: i32,
    #[allow(dead_code)]
    pub time: String,
    pub channel: String,
    pub downloads: BuildDownloads,
}

#[derive(Debug, Deserialize)]
pub struct BuildDownloads {
    pub application: DownloadInfo,
}

#[derive(Debug, Deserialize)]
pub struct DownloadInfo {
    pub name: String,
    #[allow(dead_code)]
    pub sha256: String,
}

/// Fetch available versions for a Paper project
pub async fn fetch_versions(
    client: &reqwest::Client,
    project: PaperProject,
) -> AppResult<Vec<String>> {
    let url = format!("{}/projects/{}", PAPER_API, project.as_str());

    let response = client.get(&url).send().await.map_err(|e| {
        AppError::Network(format!(
            "Failed to fetch {} versions: {}",
            project.as_str(),
            e
        ))
    })?;

    let data: ProjectVersions = response.json().await.map_err(|e| {
        AppError::Network(format!(
            "Failed to parse {} versions: {}",
            project.as_str(),
            e
        ))
    })?;

    Ok(data.versions)
}

/// Fetch builds for a specific version
pub async fn fetch_builds(
    client: &reqwest::Client,
    project: PaperProject,
    version: &str,
) -> AppResult<Vec<i32>> {
    let url = format!(
        "{}/projects/{}/versions/{}",
        PAPER_API,
        project.as_str(),
        version
    );

    let response = client.get(&url).send().await.map_err(|e| {
        AppError::Network(format!(
            "Failed to fetch {} builds: {}",
            project.as_str(),
            e
        ))
    })?;

    let data: VersionBuilds = response.json().await.map_err(|e| {
        AppError::Network(format!(
            "Failed to parse {} builds: {}",
            project.as_str(),
            e
        ))
    })?;

    Ok(data.builds)
}

/// Fetch info for a specific build
pub async fn fetch_build_info(
    client: &reqwest::Client,
    project: PaperProject,
    version: &str,
    build: i32,
) -> AppResult<BuildInfo> {
    let url = format!(
        "{}/projects/{}/versions/{}/builds/{}",
        PAPER_API,
        project.as_str(),
        version,
        build
    );

    let response = client.get(&url).send().await.map_err(|e| {
        AppError::Network(format!(
            "Failed to fetch {} build info: {}",
            project.as_str(),
            e
        ))
    })?;

    response.json().await.map_err(|e| {
        AppError::Network(format!(
            "Failed to parse {} build info: {}",
            project.as_str(),
            e
        ))
    })
}

/// Get the download URL for a specific build
pub fn get_download_url(
    project: PaperProject,
    version: &str,
    build: i32,
    filename: &str,
) -> String {
    format!(
        "{}/projects/{}/versions/{}/builds/{}/downloads/{}",
        PAPER_API,
        project.as_str(),
        version,
        build,
        filename
    )
}

/// Fetch loader versions for Paper/Velocity/Waterfall
pub async fn fetch_loader_versions(
    client: &reqwest::Client,
    project: PaperProject,
) -> AppResult<Vec<LoaderVersion>> {
    let versions = fetch_versions(client, project).await?;

    let mut loader_versions = Vec::new();

    // Get latest build for each version
    for version in versions.iter().take(10) {
        // Limit to 10 most recent
        if let Ok(builds) = fetch_builds(client, project, version).await {
            if let Some(&latest_build) = builds.last() {
                if let Ok(build_info) =
                    fetch_build_info(client, project, version, latest_build).await
                {
                    let download_url = get_download_url(
                        project,
                        version,
                        latest_build,
                        &build_info.downloads.application.name,
                    );

                    loader_versions.push(LoaderVersion {
                        version: format!("{}-{}", version, latest_build),
                        stable: build_info.channel == "default",
                        minecraft_version: Some(version.clone()),
                        download_url: Some(download_url),
                    });
                }
            }
        }
    }

    Ok(loader_versions)
}

/// Get Paper versions for a specific Minecraft version
pub async fn fetch_paper_for_mc(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Vec<LoaderVersion>> {
    let builds = fetch_builds(client, PaperProject::Paper, mc_version).await?;

    let mut versions = Vec::new();

    // Get latest 5 builds
    for &build in builds.iter().rev().take(5) {
        if let Ok(build_info) =
            fetch_build_info(client, PaperProject::Paper, mc_version, build).await
        {
            let download_url = get_download_url(
                PaperProject::Paper,
                mc_version,
                build,
                &build_info.downloads.application.name,
            );

            versions.push(LoaderVersion {
                version: format!("build-{}", build),
                stable: build_info.channel == "default",
                minecraft_version: Some(mc_version.to_string()),
                download_url: Some(download_url),
            });
        }
    }

    Ok(versions)
}

// ============= BungeeCord =============
// BungeeCord uses Jenkins for builds (now hosted on SpigotMC hub)

const BUNGEECORD_API: &str = "https://hub.spigotmc.org/jenkins/job/BungeeCord";

#[derive(Debug, Deserialize)]
pub struct BungeeCordBuild {
    pub number: i32,
    pub result: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct BungeeCordBuilds {
    pub builds: Vec<BungeeCordBuild>,
}

/// Fetch BungeeCord builds
pub async fn fetch_bungeecord_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    let url = format!("{}/api/json?tree=builds[number,result,url]", BUNGEECORD_API);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch BungeeCord builds: {}", e)))?;

    let data: BungeeCordBuilds = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse BungeeCord builds: {}", e)))?;

    Ok(data
        .builds
        .into_iter()
        .filter(|b| b.result.as_deref() == Some("SUCCESS"))
        .take(10)
        .map(|b| LoaderVersion {
            version: format!("#{}", b.number),
            stable: true,
            minecraft_version: None,
            download_url: Some(format!(
                "{}/artifact/bootstrap/target/BungeeCord.jar",
                b.url
            )),
        })
        .collect())
}

// ============= Purpur =============
// Purpur uses its own API similar to PaperMC

#[derive(Debug, Deserialize)]
pub struct PurpurVersions {
    pub versions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PurpurBuilds {
    pub builds: PurpurBuildsInfo,
}

#[derive(Debug, Deserialize)]
pub struct PurpurBuildsInfo {
    pub latest: String,
    pub all: Vec<String>,
}

/// Fetch Purpur versions
pub async fn fetch_purpur_versions(client: &reqwest::Client) -> AppResult<Vec<String>> {
    let url = format!("{}/purpur", PURPUR_API);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Purpur versions: {}", e)))?;

    let data: PurpurVersions = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Purpur versions: {}", e)))?;

    Ok(data.versions)
}

/// Fetch Purpur builds for a version
pub async fn fetch_purpur_builds(
    client: &reqwest::Client,
    version: &str,
) -> AppResult<Vec<LoaderVersion>> {
    let url = format!("{}/purpur/{}", PURPUR_API, version);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Purpur builds: {}", e)))?;

    let data: PurpurBuilds = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Purpur builds: {}", e)))?;

    // Get latest 5 builds
    let versions: Vec<LoaderVersion> = data
        .builds
        .all
        .iter()
        .rev()
        .take(5)
        .map(|build| LoaderVersion {
            version: format!("build-{}", build),
            stable: build == &data.builds.latest,
            minecraft_version: Some(version.to_string()),
            download_url: Some(format!(
                "{}/purpur/{}/{}/download",
                PURPUR_API, version, build
            )),
        })
        .collect();

    Ok(versions)
}

/// Fetch all Purpur loader versions
pub async fn fetch_purpur_loader_versions(
    client: &reqwest::Client,
) -> AppResult<Vec<LoaderVersion>> {
    let versions = fetch_purpur_versions(client).await?;
    let mut loader_versions = Vec::new();

    for version in versions.iter().rev().take(10) {
        if let Ok(builds) = fetch_purpur_builds(client, version).await {
            if let Some(latest) = builds.into_iter().next() {
                loader_versions.push(latest);
            }
        }
    }

    Ok(loader_versions)
}

// ============= Pufferfish =============
// Pufferfish uses Jenkins CI

#[derive(Debug, Deserialize)]
pub struct PufferfishBuild {
    pub number: i32,
    pub result: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct PufferfishBuilds {
    pub builds: Vec<PufferfishBuild>,
}

/// Fetch Pufferfish versions (from Jenkins)
pub async fn fetch_pufferfish_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    // Try multiple Pufferfish Jenkins jobs for different MC versions
    let jobs = [
        ("https://ci.pufferfish.host/job/Pufferfish-1.21", "1.21"),
        ("https://ci.pufferfish.host/job/Pufferfish-1.20", "1.20"),
    ];

    let mut all_versions = Vec::new();

    for (job_url, mc_version) in jobs {
        let url = format!("{}/api/json?tree=builds[number,result,url]", job_url);

        if let Ok(response) = client.get(&url).send().await {
            if let Ok(data) = response.json::<PufferfishBuilds>().await {
                let versions: Vec<LoaderVersion> = data
                    .builds
                    .into_iter()
                    .filter(|b| b.result.as_deref() == Some("SUCCESS"))
                    .take(5)
                    .map(|b| LoaderVersion {
                        version: format!("#{}", b.number),
                        stable: true,
                        minecraft_version: Some(mc_version.to_string()),
                        download_url: Some(format!(
                            "{}artifact/build/libs/pufferfish-paperclip-{}-R0.1-SNAPSHOT-reobf.jar",
                            b.url, mc_version
                        )),
                    })
                    .collect();
                all_versions.extend(versions);
            }
        }
    }

    Ok(all_versions)
}

// ============= Spigot =============
// Spigot requires BuildTools, so we provide download links to BuildTools
// Users need to run BuildTools themselves

const SPIGOT_BUILDTOOLS_URL: &str = "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar";

/// Get Spigot "versions" - actually just BuildTools info
pub async fn fetch_spigot_versions(_client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    // Spigot requires BuildTools, we can't directly download server jars
    // Return info about BuildTools instead
    Ok(vec![LoaderVersion {
        version: "BuildTools (latest)".to_string(),
        stable: true,
        minecraft_version: None,
        download_url: Some(SPIGOT_BUILDTOOLS_URL.to_string()),
    }])
}

// ============= Sponge =============
// Sponge uses its own download API

#[derive(Debug, Deserialize)]
pub struct SpongeVersions {
    pub artifacts: Vec<SpongeArtifact>,
}

#[derive(Debug, Deserialize)]
pub struct SpongeArtifact {
    #[serde(rename = "displayVersion")]
    pub display_version: Option<String>,
    pub version: String,
    #[serde(rename = "mcVersion")]
    pub mc_version: Option<String>,
    pub recommended: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum SpongeProject {
    SpongeVanilla,
    SpongeForge,
}

impl SpongeProject {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SpongeVanilla => "spongevanilla",
            Self::SpongeForge => "spongeforge",
        }
    }
}

/// Fetch Sponge versions
pub async fn fetch_sponge_versions(
    client: &reqwest::Client,
    project: SpongeProject,
) -> AppResult<Vec<LoaderVersion>> {
    let url = format!(
        "{}/groups/org.spongepowered/artifacts/{}/versions?limit=20&recommended=true",
        SPONGE_API,
        project.as_str()
    );

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Sponge versions: {}", e)))?;

    let data: SpongeVersions = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Sponge versions: {}", e)))?;

    Ok(data
        .artifacts
        .into_iter()
        .take(10)
        .map(|a| LoaderVersion {
            version: a.display_version.unwrap_or(a.version.clone()),
            stable: a.recommended,
            minecraft_version: a.mc_version,
            download_url: Some(format!(
                "https://repo.spongepowered.org/repository/maven-releases/org/spongepowered/{}/{}/{}-{}-universal.jar",
                project.as_str(),
                a.version,
                project.as_str(),
                a.version
            )),
        })
        .collect())
}
