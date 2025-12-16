use crate::error::{AppError, AppResult};
use fastnbt::Value;
use flate2::read::GzDecoder;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use super::{SchematicDimensions, SchematicFormat};

/// Metadata extracted from a schematic file
#[derive(Debug, Clone)]
pub struct SchematicMetadata {
    pub dimensions: Option<SchematicDimensions>,
    pub author: Option<String>,
    pub mc_version: Option<String>,
    pub format_version: Option<i32>,
}

impl Default for SchematicMetadata {
    fn default() -> Self {
        Self {
            dimensions: None,
            author: None,
            mc_version: None,
            format_version: None,
        }
    }
}

/// Extract metadata from a schematic file (sync version for internal use)
fn extract_metadata_sync(path: &Path) -> AppResult<SchematicMetadata> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let format = SchematicFormat::from_extension(ext)
        .ok_or_else(|| AppError::Schematic(format!("Unknown schematic format: {}", ext)))?;

    // Read and decompress file
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Schematic(format!("Failed to open file: {}", e)))?;

    let nbt = read_nbt_compound(file)?;

    match format {
        SchematicFormat::Schem => parse_sponge_schematic(&nbt),
        SchematicFormat::Schematic => parse_legacy_schematic(&nbt),
        SchematicFormat::Litematic => parse_litematic(&nbt),
        SchematicFormat::Nbt => parse_structure_nbt(&nbt),
    }
}

/// Extract metadata from a schematic file (async-safe, runs on blocking thread pool)
pub fn extract_metadata(path: &Path) -> AppResult<SchematicMetadata> {
    // This is called from sync context (import_schematic uses unwrap_or_default)
    // For the sync call path, just run directly
    extract_metadata_sync(path)
}

/// Extract metadata from a schematic file (async version, runs on blocking thread pool)
/// Use this for batch operations to avoid blocking the async runtime
#[allow(dead_code)]
pub async fn extract_metadata_async(path: std::path::PathBuf) -> AppResult<SchematicMetadata> {
    tokio::task::spawn_blocking(move || extract_metadata_sync(&path))
        .await
        .map_err(|e| AppError::Schematic(format!("Task join error: {}", e)))?
}

/// Read NBT compound from a potentially gzip-compressed file
fn read_nbt_compound<R: Read>(reader: R) -> AppResult<HashMap<String, Value>> {
    // Try gzip first (most common for schematics)
    let mut gz_reader = GzDecoder::new(reader);
    let mut data = Vec::new();

    match gz_reader.read_to_end(&mut data) {
        Ok(_) => {
            // Successfully read gzipped data
            fastnbt::from_bytes(&data)
                .map_err(|e| AppError::Schematic(format!("Failed to parse NBT: {}", e)))
        }
        Err(_) => {
            // Try reading as uncompressed
            Err(AppError::Schematic(
                "Failed to read schematic file (not gzip compressed or corrupted)".to_string(),
            ))
        }
    }
}

/// Parse Sponge Schematic format (v2/v3) - .schem files
/// Structure v2: Width, Height, Length at root
/// Structure v3: Everything inside "Schematic" compound at root
fn parse_sponge_schematic(nbt: &HashMap<String, Value>) -> AppResult<SchematicMetadata> {
    let mut metadata = SchematicMetadata::default();

    // Sponge Schematic v3 wraps everything in a "Schematic" compound
    // v2 has data at root level
    let data = if let Some(Value::Compound(schematic)) = nbt.get("Schematic") {
        schematic
    } else {
        nbt
    };

    // Get dimensions
    let width = get_i16_or_i32(data, "Width");
    let height = get_i16_or_i32(data, "Height");
    let length = get_i16_or_i32(data, "Length");

    if let (Some(w), Some(h), Some(l)) = (width, height, length) {
        metadata.dimensions = Some(SchematicDimensions {
            width: w,
            height: h,
            length: l,
        });
    }

    // Get version
    if let Some(Value::Int(v)) = data.get("Version") {
        metadata.format_version = Some(*v);
    }

    // Get metadata compound
    if let Some(Value::Compound(meta)) = data.get("Metadata") {
        // Author - check multiple possible keys used by different tools
        let author_keys = ["Author", "author", "WESchematicAuthor", "Creator", "creator"];
        for key in author_keys {
            if let Some(Value::String(author)) = meta.get(key) {
                if !author.is_empty() {
                    metadata.author = Some(author.clone());
                    break;
                }
            }
        }

        // Check for name as author fallback
        if metadata.author.is_none() {
            if let Some(Value::String(name)) = meta.get("Name") {
                if !name.is_empty() {
                    metadata.author = Some(name.clone());
                }
            }
        }
    }

    // Also check for author at root level (some tools put it there)
    if metadata.author.is_none() {
        let root_author_keys = ["Author", "author", "Creator", "creator"];
        for key in root_author_keys {
            if let Some(Value::String(author)) = data.get(key) {
                if !author.is_empty() {
                    metadata.author = Some(author.clone());
                    break;
                }
            }
        }
    }

    // DataVersion can indicate Minecraft version
    if let Some(Value::Int(data_ver)) = data.get("DataVersion") {
        metadata.mc_version = data_version_to_mc_version(*data_ver);
    }

    Ok(metadata)
}

/// Parse legacy WorldEdit schematic format - .schematic files
/// Structure:
/// - Width, Height, Length as shorts
/// - Materials string
fn parse_legacy_schematic(nbt: &HashMap<String, Value>) -> AppResult<SchematicMetadata> {
    let mut metadata = SchematicMetadata::default();

    // Get dimensions (stored as shorts in legacy format)
    let width = get_i16_or_i32(nbt, "Width");
    let height = get_i16_or_i32(nbt, "Height");
    let length = get_i16_or_i32(nbt, "Length");

    if let (Some(w), Some(h), Some(l)) = (width, height, length) {
        metadata.dimensions = Some(SchematicDimensions {
            width: w,
            height: h,
            length: l,
        });
    }

    // Legacy format uses "Materials" to indicate version
    if let Some(Value::String(materials)) = nbt.get("Materials") {
        if materials == "Alpha" {
            metadata.mc_version = Some("1.12.2 or earlier".to_string());
        }
    }

    Ok(metadata)
}

/// Parse Litematica format - .litematic files
/// Structure:
/// - Metadata compound with author, timeCreated, totalBlocks, enclosingSize
/// - Regions compound with sub-regions
fn parse_litematic(nbt: &HashMap<String, Value>) -> AppResult<SchematicMetadata> {
    let mut metadata = SchematicMetadata::default();

    // Get metadata compound
    if let Some(Value::Compound(meta)) = nbt.get("Metadata") {
        // Author
        if let Some(Value::String(author)) = meta.get("Author") {
            metadata.author = Some(author.clone());
        }

        // Enclosing size for dimensions
        if let Some(Value::Compound(size)) = meta.get("EnclosingSize") {
            let x = get_i32(size, "x");
            let y = get_i32(size, "y");
            let z = get_i32(size, "z");

            if let (Some(x), Some(y), Some(z)) = (x, y, z) {
                metadata.dimensions = Some(SchematicDimensions {
                    width: x,
                    height: y,
                    length: z,
                });
            }
        }
    }

    // MinecraftDataVersion for MC version
    if let Some(Value::Int(data_ver)) = nbt.get("MinecraftDataVersion") {
        metadata.mc_version = data_version_to_mc_version(*data_ver);
    }

    // Version field
    if let Some(Value::Int(v)) = nbt.get("Version") {
        metadata.format_version = Some(*v);
    }

    Ok(metadata)
}

/// Parse vanilla structure NBT format - .nbt files
/// Structure:
/// - size list with [x, y, z]
/// - author string (optional)
/// - DataVersion int
fn parse_structure_nbt(nbt: &HashMap<String, Value>) -> AppResult<SchematicMetadata> {
    let mut metadata = SchematicMetadata::default();

    // Get size from list
    if let Some(Value::List(size_list)) = nbt.get("size") {
        if size_list.len() >= 3 {
            let x = match &size_list[0] {
                Value::Int(v) => Some(*v),
                _ => None,
            };
            let y = match &size_list[1] {
                Value::Int(v) => Some(*v),
                _ => None,
            };
            let z = match &size_list[2] {
                Value::Int(v) => Some(*v),
                _ => None,
            };

            if let (Some(x), Some(y), Some(z)) = (x, y, z) {
                metadata.dimensions = Some(SchematicDimensions {
                    width: x,
                    height: y,
                    length: z,
                });
            }
        }
    }

    // Author
    if let Some(Value::String(author)) = nbt.get("author") {
        metadata.author = Some(author.clone());
    }

    // DataVersion for MC version
    if let Some(Value::Int(data_ver)) = nbt.get("DataVersion") {
        metadata.mc_version = data_version_to_mc_version(*data_ver);
    }

    Ok(metadata)
}

/// Helper to get i16 or i32 value (for width/height/length compatibility)
fn get_i16_or_i32(nbt: &HashMap<String, Value>, key: &str) -> Option<i32> {
    match nbt.get(key) {
        Some(Value::Short(v)) => Some(*v as i32),
        Some(Value::Int(v)) => Some(*v),
        _ => None,
    }
}

/// Helper to get i32 value
fn get_i32(nbt: &HashMap<String, Value>, key: &str) -> Option<i32> {
    match nbt.get(key) {
        Some(Value::Int(v)) => Some(*v),
        _ => None,
    }
}

/// Convert Minecraft DataVersion to version string
/// https://minecraft.wiki/w/Data_version
fn data_version_to_mc_version(data_version: i32) -> Option<String> {
    let version = match data_version {
        // 1.21.x
        4189.. => "1.21.4+",
        4082..=4188 => "1.21.3",
        4080..=4081 => "1.21.2",
        3955..=4079 => "1.21.1",
        3953..=3954 => "1.21",
        // 1.20.x
        3837..=3952 => "1.20.6",
        3700..=3836 => "1.20.5",
        3698..=3699 => "1.20.4",
        3578..=3697 => "1.20.3",
        3465..=3577 => "1.20.2",
        3463..=3464 => "1.20.1",
        3337..=3462 => "1.20",
        // 1.19.x
        3218..=3336 => "1.19.4",
        3120..=3217 => "1.19.3",
        3117..=3119 => "1.19.1",
        3105..=3116 => "1.19",
        // 1.18.x
        2975..=3104 => "1.18.2",
        2865..=2974 => "1.18.1",
        2860..=2864 => "1.18",
        // 1.17.x
        2730..=2859 => "1.17.1",
        2724..=2729 => "1.17",
        // 1.16.x
        2586..=2723 => "1.16.5",
        2584..=2585 => "1.16.4",
        2580..=2583 => "1.16.3",
        2578..=2579 => "1.16.2",
        2567..=2577 => "1.16.1",
        2566 => "1.16",
        // 1.15.x
        2230..=2565 => "1.15.2",
        2227..=2229 => "1.15.1",
        2225..=2226 => "1.15",
        // 1.14.x
        1976..=2224 => "1.14.4",
        1968..=1975 => "1.14.3",
        1963..=1967 => "1.14.2",
        1957..=1962 => "1.14.1",
        1952..=1956 => "1.14",
        // 1.13.x
        1631..=1951 => "1.13.2",
        1628..=1630 => "1.13.1",
        1519..=1627 => "1.13",
        // Older versions
        1343..=1518 => "1.12.2",
        1..=1342 => "1.12 or earlier",
        // Invalid or unknown data version
        _ => return None,
    };

    Some(version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_version_conversion() {
        assert_eq!(data_version_to_mc_version(3953), Some("1.21".to_string()));
        assert_eq!(data_version_to_mc_version(3463), Some("1.20.1".to_string()));
        assert_eq!(data_version_to_mc_version(3337), Some("1.20".to_string()));
        assert_eq!(data_version_to_mc_version(2860), Some("1.18".to_string()));
    }
}
