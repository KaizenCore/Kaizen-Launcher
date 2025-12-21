use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

// ===== Static Regex Patterns =====
// Compiled once at first use to avoid repeated compilation

// Fabric patterns
static FABRIC_NEW_MISSING_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Mod\s+'([^']+)'\s*\(([^)]+)\)\s+[\d.]+\s+requires\s+(?:version\s+([^\s]+)\s+or\s+later\s+of|any\s+version\s+of)\s+(\w+),\s*which\s+is\s+missing"
    ).expect("Invalid FABRIC_NEW_MISSING_REGEX")
});

static FABRIC_RECOMMENDS_MISSING_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Mod\s+'([^']+)'\s*\(([^)]+)\)\s+[\d.+\-\w]+\s+recommends\s+(?:version\s+([^\s]+)\s+or\s+later\s+of|any\s+(?:([\d]+\.x)\s+)?version\s+of)\s+([\w\-]+),\s*which\s+is\s+missing"
    ).expect("Invalid FABRIC_RECOMMENDS_MISSING_REGEX")
});

static FABRIC_RECOMMENDS_WRONG_VERSION_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Mod\s+'([^']+)'\s*\(([^)]+)\)\s+[\d.+\-\w]+\s+recommends\s+version\s+([^\s]+)\s+of\s+mod\s+'([^']+)'\s*\(([^)]+)\),\s*but\s+only\s+the\s+wrong\s+version\s+is\s+present:\s*([^!]+)"
    ).expect("Invalid FABRIC_RECOMMENDS_WRONG_VERSION_REGEX")
});

static FABRIC_INSTALL_SUGGESTION_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)-\s*Install\s+([\w\-]+),\s*(?:version\s+([^\s.]+(?:\.[^\s.]+)*)\s+or\s+later|any\s+(?:[\d]+\.x\s+)?version)\."
    ).expect("Invalid FABRIC_INSTALL_SUGGESTION_REGEX")
});

static FABRIC_OLD_MISSING_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Mod\s+'?([^']+)'?\s*\(([^)]+)\)\s+requires\s+(?:mod\s+)?'?([^',\s]+)'?,?\s*which\s+is\s+missing"
    ).expect("Invalid FABRIC_OLD_MISSING_REGEX")
});

static FABRIC_VERSION_MISMATCH_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Mod\s+'?([^']+)'?\s*\(([^)]+)\)\s+requires\s+(?:mod\s+)?'?([^']+)'?\s+(?:with\s+)?(?:version\s+)?([><=~^]+\s*[\d.x\-+a-zA-Z]+|\*|any),?\s*but\s+(?:only\s+)?(?:version\s+)?([\d.x\-+a-zA-Z]+)\s+is\s+(?:present|loaded|installed)"
    ).expect("Invalid FABRIC_VERSION_MISMATCH_REGEX")
});

static FABRIC_BREAKS_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Mod\s+'?([^']+)'?\s*(?:\(([^)]+)\))?\s+breaks\s+(?:mod\s+)?'?([^']+)'?"
    ).expect("Invalid FABRIC_BREAKS_REGEX")
});

static FABRIC_SIMPLE_REQUIRES_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:^|\s)requires\s+(?:mod\s+)?'?(\w+)'?\s*(?:,|$|\s*but)"
    ).expect("Invalid FABRIC_SIMPLE_REQUIRES_REGEX")
});

// Forge patterns
static FORGE_MISSING_MODS_SECTION_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)Missing\s+Mods?:\s*\n((?:\s*[\w-]+\s*:?\s*[^\n]*\n?)+)"
    ).expect("Invalid FORGE_MISSING_MODS_SECTION_REGEX")
});

static FORGE_MOD_LINE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*([\w-]+)\s*:?\s*(.*)$").expect("Invalid FORGE_MOD_LINE_REGEX")
});

static FORGE_MISSING_EXCEPTION_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)MissingModsException.*?Mod\s+(\w+)\s+requires\s+\{(\w+)\s*@\s*\[([^\]]+)\]"
    ).expect("Invalid FORGE_MISSING_EXCEPTION_REGEX")
});

static FORGE_DUPLICATE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)Duplicate\s+mods?\s+found.*?(\w+)").expect("Invalid FORGE_DUPLICATE_REGEX")
});

static FORGE_VERSION_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:requires|needs)\s+(?:Minecraft\s+)?Forge\s+(?:version\s+)?([\d.]+)"
    ).expect("Invalid FORGE_VERSION_REGEX")
});

/// Represents a detected issue from parsing server/client logs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedIssue {
    /// Type of issue detected
    pub issue_type: IssueType,
    /// Human-readable description of the issue
    pub description: String,
    /// The mod that has the issue (if applicable)
    pub mod_id: Option<String>,
    /// The mod name (if available)
    pub mod_name: Option<String>,
    /// Required dependency mod ID
    pub required_mod_id: Option<String>,
    /// Required dependency mod name
    pub required_mod_name: Option<String>,
    /// Required version (if version mismatch)
    pub required_version: Option<String>,
    /// Current version (if version mismatch)
    pub current_version: Option<String>,
    /// Suggested action to fix the issue
    pub suggested_action: SuggestedAction,
    /// Raw log line(s) that triggered this detection
    pub raw_log: String,
}

/// Type of issue detected in logs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IssueType {
    /// A required mod is missing
    MissingDependency,
    /// A recommended mod is missing (optional but suggested)
    MissingRecommendation,
    /// A mod has wrong version
    VersionMismatch,
    /// A recommended mod has wrong version
    RecommendedVersionMismatch,
    /// Two mods are incompatible
    ModConflict,
    /// A mod is not compatible with the current Minecraft version
    MinecraftVersionMismatch,
    /// A mod is not compatible with the current loader version
    LoaderVersionMismatch,
    /// Duplicate mod detected
    DuplicateMod,
    /// Generic/unknown error
    Unknown,
}

/// Suggested action to fix the issue
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedAction {
    /// Install the missing dependency
    InstallDependency,
    /// Update the mod to a newer version
    UpdateMod,
    /// Remove the mod
    RemoveMod,
    /// Remove one of the conflicting mods
    ResolveConflict,
    /// Remove duplicate mod
    RemoveDuplicate,
    /// No automatic fix available
    ManualFix,
}

/// Parse log content and detect issues
pub fn parse_log_for_issues(log_content: &str, loader_type: &str) -> Vec<DetectedIssue> {
    let mut issues = Vec::new();

    match loader_type.to_lowercase().as_str() {
        "fabric" | "quilt" => {
            issues.extend(parse_fabric_issues(log_content));
        }
        "forge" | "neoforge" => {
            issues.extend(parse_forge_issues(log_content));
        }
        _ => {
            // Try all parsers for unknown loaders
            issues.extend(parse_fabric_issues(log_content));
            issues.extend(parse_forge_issues(log_content));
        }
    }

    // Deduplicate issues
    issues.sort_by(|a, b| a.description.cmp(&b.description));
    issues.dedup_by(|a, b| {
        a.issue_type == b.issue_type
            && a.mod_id == b.mod_id
            && a.required_mod_id == b.required_mod_id
    });

    issues
}

/// Parse Fabric/Quilt loader error messages
fn parse_fabric_issues(log_content: &str) -> Vec<DetectedIssue> {
    let mut issues = Vec::new();

    // Pattern 1: New Fabric format (0.16+)
    // "Mod 'FancyMenu' (fancymenu) 3.7.0 requires version 1.0.0 or later of melody, which is missing!"
    // "Mod 'Forge Config Screens' (forgeconfigscreens) 8.0.2 requires any version of modmenu, which is missing!"
    for cap in FABRIC_NEW_MISSING_REGEX.captures_iter(log_content) {
        let mod_name = cap.get(1).map(|m| m.as_str().to_string());
        let mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let required_version = cap.get(3).map(|m| m.as_str().to_string()); // None for "any version"
        let required_mod_id = cap.get(4).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::MissingDependency,
            description: format!(
                "Mod '{}' requires '{}' which is not installed",
                mod_name.as_deref().unwrap_or("unknown"),
                required_mod_id.as_deref().unwrap_or("unknown")
            ),
            mod_id: mod_id.clone(),
            mod_name: mod_name.clone(),
            required_mod_id: required_mod_id.clone(),
            required_mod_name: None,
            required_version,
            current_version: None,
            suggested_action: SuggestedAction::InstallDependency,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern 2: Fabric "recommends" format - missing recommended mod
    // "Mod 'Alloy Forgery' (alloy_forgery) 2.1.2+1.20 recommends version 12.0.0 or later of roughlyenoughitems, which is missing!"
    // "Mod 'Debugify' (debugify) 1.20.1+2.0 recommends any 3.x version of yet-another-config-lib, which is missing!"
    // "Mod 'Debugify' (debugify) 1.20.1+2.0 recommends any version of modmenu, which is missing!"
    for cap in FABRIC_RECOMMENDS_MISSING_REGEX.captures_iter(log_content) {
        let mod_name = cap.get(1).map(|m| m.as_str().to_string());
        let mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let required_version = cap.get(3).map(|m| m.as_str().to_string())
            .or_else(|| cap.get(4).map(|m| m.as_str().to_string())); // "3.x" format
        let required_mod_id = cap.get(5).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::MissingRecommendation,
            description: format!(
                "Mod '{}' recommends '{}' for optimal experience",
                mod_name.as_deref().unwrap_or("unknown"),
                required_mod_id.as_deref().unwrap_or("unknown")
            ),
            mod_id: mod_id.clone(),
            mod_name: mod_name.clone(),
            required_mod_id: required_mod_id.clone(),
            required_mod_name: None,
            required_version,
            current_version: None,
            suggested_action: SuggestedAction::InstallDependency,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern 3: Fabric "recommends" format - wrong version installed
    // "Mod 'Spellblades and Such' (spellbladenext) 2.3.0+1.20.1 recommends version 1.2.0+1.20.1 of mod 'Paladins & Priests (RPG Series)' (paladins), but only the wrong version is present: 1.4.0+1.20.1!"
    for cap in FABRIC_RECOMMENDS_WRONG_VERSION_REGEX.captures_iter(log_content) {
        let mod_name = cap.get(1).map(|m| m.as_str().to_string());
        let mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let required_version = cap.get(3).map(|m| m.as_str().to_string());
        let required_mod_name = cap.get(4).map(|m| m.as_str().to_string());
        let required_mod_id = cap.get(5).map(|m| m.as_str().to_string());
        let current_version = cap.get(6).map(|m| m.as_str().trim().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::RecommendedVersionMismatch,
            description: format!(
                "Mod '{}' recommends '{}' version {} but {} is installed",
                mod_name.as_deref().unwrap_or("unknown"),
                required_mod_name.as_deref().unwrap_or("unknown"),
                required_version.as_deref().unwrap_or("?"),
                current_version.as_deref().unwrap_or("?")
            ),
            mod_id: mod_id.clone(),
            mod_name: mod_name.clone(),
            required_mod_id: required_mod_id.clone(),
            required_mod_name,
            required_version,
            current_version,
            suggested_action: SuggestedAction::UpdateMod,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern 4: Fabric "Install X" suggestion format
    // "- Install melody, version 1.0.0 or later."
    // "- Install modmenu, any version."
    for cap in FABRIC_INSTALL_SUGGESTION_REGEX.captures_iter(log_content) {
        let required_mod_id = cap.get(1).map(|m| m.as_str().to_string());
        let required_version = cap.get(2).map(|m| m.as_str().to_string());

        // Only add if not already captured by the more detailed regex
        let already_exists = issues.iter().any(|i| i.required_mod_id == required_mod_id);
        if !already_exists {
            issues.push(DetectedIssue {
                issue_type: IssueType::MissingDependency,
                description: format!(
                    "Missing required mod: '{}'",
                    required_mod_id.as_deref().unwrap_or("unknown")
                ),
                mod_id: None,
                mod_name: None,
                required_mod_id: required_mod_id.clone(),
                required_mod_name: None,
                required_version,
                current_version: None,
                suggested_action: SuggestedAction::InstallDependency,
                raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
            });
        }
    }

    // Pattern 5: Old Fabric format (fallback)
    // "Mod 'fancymenu' (fancymenu) requires mod melody, which is missing!"
    for cap in FABRIC_OLD_MISSING_REGEX.captures_iter(log_content) {
        let mod_name = cap.get(1).map(|m| m.as_str().to_string());
        let mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let required_mod_id = cap.get(3).map(|m| m.as_str().to_string());

        // Only add if not already captured
        let already_exists = issues.iter().any(|i| i.required_mod_id == required_mod_id);
        if !already_exists {
            issues.push(DetectedIssue {
                issue_type: IssueType::MissingDependency,
                description: format!(
                    "Mod '{}' requires '{}' which is not installed",
                    mod_name.as_deref().unwrap_or("unknown"),
                    required_mod_id.as_deref().unwrap_or("unknown")
                ),
                mod_id: mod_id.clone(),
                mod_name: mod_name.clone(),
                required_mod_id: required_mod_id.clone(),
                required_mod_name: None,
                required_version: None,
                current_version: None,
                suggested_action: SuggestedAction::InstallDependency,
                raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
            });
        }
    }

    // Pattern 6: Version mismatch
    // "Mod X requires mod Y with version >= Z, but only A is present"
    for cap in FABRIC_VERSION_MISMATCH_REGEX.captures_iter(log_content) {
        let mod_name = cap.get(1).map(|m| m.as_str().to_string());
        let mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let required_mod_id = cap.get(3).map(|m| m.as_str().to_string());
        let required_version = cap.get(4).map(|m| m.as_str().to_string());
        let current_version = cap.get(5).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::VersionMismatch,
            description: format!(
                "Mod '{}' requires '{}' version {} but {} is installed",
                mod_name.as_deref().unwrap_or("unknown"),
                required_mod_id.as_deref().unwrap_or("unknown"),
                required_version.as_deref().unwrap_or("?"),
                current_version.as_deref().unwrap_or("?")
            ),
            mod_id: mod_id.clone(),
            mod_name: mod_name.clone(),
            required_mod_id: required_mod_id.clone(),
            required_mod_name: None,
            required_version,
            current_version,
            suggested_action: SuggestedAction::UpdateMod,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern 7: "Mod X breaks mod Y" (incompatibility)
    for cap in FABRIC_BREAKS_REGEX.captures_iter(log_content) {
        let mod_name = cap.get(1).map(|m| m.as_str().to_string());
        let mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let conflicting_mod = cap.get(3).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::ModConflict,
            description: format!(
                "Mod '{}' is incompatible with '{}'",
                mod_name.as_deref().unwrap_or("unknown"),
                conflicting_mod.as_deref().unwrap_or("unknown")
            ),
            mod_id: mod_id.clone(),
            mod_name: mod_name.clone(),
            required_mod_id: conflicting_mod.clone(),
            required_mod_name: None,
            required_version: None,
            current_version: None,
            suggested_action: SuggestedAction::ResolveConflict,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern 8: Simple "requires mod X" or "requires X" without the full sentence
    // Only use simple pattern if we didn't find anything with the detailed patterns
    if issues.is_empty() {
        for cap in FABRIC_SIMPLE_REQUIRES_REGEX.captures_iter(log_content) {
            let required_mod_id = cap.get(1).map(|m| m.as_str().to_string());

            // Check if this line contains "missing" to confirm it's about a missing mod
            let raw = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            if log_content.contains("missing") || log_content.contains("not loaded") {
                issues.push(DetectedIssue {
                    issue_type: IssueType::MissingDependency,
                    description: format!(
                        "Missing required mod: '{}'",
                        required_mod_id.as_deref().unwrap_or("unknown")
                    ),
                    mod_id: None,
                    mod_name: None,
                    required_mod_id: required_mod_id.clone(),
                    required_mod_name: None,
                    required_version: None,
                    current_version: None,
                    suggested_action: SuggestedAction::InstallDependency,
                    raw_log: raw.to_string(),
                });
            }
        }
    }

    issues
}

/// Parse Forge/NeoForge loader error messages
fn parse_forge_issues(log_content: &str) -> Vec<DetectedIssue> {
    let mut issues = Vec::new();

    // Pattern: "Missing Mods:" followed by list
    // Example: "Missing Mods:\n\tmodid : modname"
    if let Some(cap) = FORGE_MISSING_MODS_SECTION_REGEX.captures(log_content) {
        let mods_section = cap.get(1).map(|m| m.as_str()).unwrap_or("");

        for line in mods_section.lines() {
            if let Some(mod_cap) = FORGE_MOD_LINE_REGEX.captures(line.trim()) {
                let mod_id = mod_cap.get(1).map(|m| m.as_str().to_string());
                let mod_name = mod_cap.get(2).map(|m| m.as_str().trim().to_string());

                if mod_id.as_ref().is_some_and(|id| !id.is_empty()) {
                    issues.push(DetectedIssue {
                        issue_type: IssueType::MissingDependency,
                        description: format!(
                            "Missing required mod: '{}'",
                            mod_name.as_ref().filter(|s| !s.is_empty())
                                .or(mod_id.as_ref())
                                .unwrap_or(&"unknown".to_string())
                        ),
                        mod_id: None,
                        mod_name: None,
                        required_mod_id: mod_id.clone(),
                        required_mod_name: mod_name.filter(|s| !s.is_empty()),
                        required_version: None,
                        current_version: None,
                        suggested_action: SuggestedAction::InstallDependency,
                        raw_log: line.to_string(),
                    });
                }
            }
        }
    }

    // Pattern: MissingModsException with mod requirements
    // Example: "net.minecraftforge.fml.common.MissingModsException: Mod modid requires {othermod @ [1.0,)}"
    for cap in FORGE_MISSING_EXCEPTION_REGEX.captures_iter(log_content) {
        let mod_id = cap.get(1).map(|m| m.as_str().to_string());
        let required_mod_id = cap.get(2).map(|m| m.as_str().to_string());
        let required_version = cap.get(3).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::MissingDependency,
            description: format!(
                "Mod '{}' requires '{}' version {}",
                mod_id.as_deref().unwrap_or("unknown"),
                required_mod_id.as_deref().unwrap_or("unknown"),
                required_version.as_deref().unwrap_or("any")
            ),
            mod_id: mod_id.clone(),
            mod_name: None,
            required_mod_id: required_mod_id.clone(),
            required_mod_name: None,
            required_version,
            current_version: None,
            suggested_action: SuggestedAction::InstallDependency,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern: Duplicate mods
    for cap in FORGE_DUPLICATE_REGEX.captures_iter(log_content) {
        let mod_id = cap.get(1).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::DuplicateMod,
            description: format!(
                "Duplicate mod detected: '{}'",
                mod_id.as_deref().unwrap_or("unknown")
            ),
            mod_id: mod_id.clone(),
            mod_name: None,
            required_mod_id: None,
            required_mod_name: None,
            required_version: None,
            current_version: None,
            suggested_action: SuggestedAction::RemoveDuplicate,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    // Pattern: Mod requires specific Forge version
    for cap in FORGE_VERSION_REGEX.captures_iter(log_content) {
        let required_version = cap.get(1).map(|m| m.as_str().to_string());

        issues.push(DetectedIssue {
            issue_type: IssueType::LoaderVersionMismatch,
            description: format!(
                "A mod requires Forge version {}",
                required_version.as_deref().unwrap_or("unknown")
            ),
            mod_id: None,
            mod_name: None,
            required_mod_id: Some("forge".to_string()),
            required_mod_name: Some("Minecraft Forge".to_string()),
            required_version,
            current_version: None,
            suggested_action: SuggestedAction::ManualFix,
            raw_log: cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default(),
        });
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fabric_new_format_missing_dependency() {
        // New Fabric 0.16+ format
        let log = "Mod 'FancyMenu' (fancymenu) 3.7.0 requires version 1.0.0 or later of melody, which is missing!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::MissingDependency);
        assert_eq!(issues[0].mod_id, Some("fancymenu".to_string()));
        assert_eq!(issues[0].mod_name, Some("FancyMenu".to_string()));
        assert_eq!(issues[0].required_mod_id, Some("melody".to_string()));
        assert_eq!(issues[0].required_version, Some("1.0.0".to_string()));
    }

    #[test]
    fn test_fabric_new_format_any_version() {
        // New Fabric format with "any version"
        let log = "Mod 'Forge Config Screens' (forgeconfigscreens) 8.0.2 requires any version of modmenu, which is missing!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::MissingDependency);
        assert_eq!(issues[0].mod_id, Some("forgeconfigscreens".to_string()));
        assert_eq!(issues[0].required_mod_id, Some("modmenu".to_string()));
        assert_eq!(issues[0].required_version, None); // "any version" has no version requirement
    }

    #[test]
    fn test_fabric_install_suggestion() {
        let log = "- Install melody, version 1.0.0 or later.\n- Install modmenu, any version.";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 2);
        assert!(issues.iter().any(|i| i.required_mod_id == Some("melody".to_string())));
        assert!(issues.iter().any(|i| i.required_mod_id == Some("modmenu".to_string())));
    }

    #[test]
    fn test_fabric_old_format_missing_dependency() {
        // Old Fabric format (fallback)
        let log = "Mod 'FancyMenu' (fancymenu) requires mod melody, which is missing!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::MissingDependency);
        assert_eq!(issues[0].required_mod_id, Some("melody".to_string()));
    }

    #[test]
    fn test_fabric_version_mismatch() {
        let log = "Mod 'SomeLib' (somelib) requires mod fabric-api with version >= 0.50.0, but only version 0.48.0 is present";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::VersionMismatch);
    }

    #[test]
    fn test_forge_missing_mods() {
        let log = "Missing Mods:\n\tmelody : Melody Library\n\tmodmenu : ModMenu";
        let issues = parse_forge_issues(log);

        assert_eq!(issues.len(), 2);
        assert!(issues.iter().all(|i| i.issue_type == IssueType::MissingDependency));
    }

    #[test]
    fn test_forge_duplicate() {
        let log = "Duplicate mods found: somemod";
        let issues = parse_forge_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::DuplicateMod);
    }

    #[test]
    fn test_fabric_recommends_missing_version() {
        // Recommends with version requirement
        let log = "Mod 'Alloy Forgery' (alloy_forgery) 2.1.2+1.20 recommends version 12.0.0 or later of roughlyenoughitems, which is missing!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::MissingRecommendation);
        assert_eq!(issues[0].mod_id, Some("alloy_forgery".to_string()));
        assert_eq!(issues[0].mod_name, Some("Alloy Forgery".to_string()));
        assert_eq!(issues[0].required_mod_id, Some("roughlyenoughitems".to_string()));
        assert_eq!(issues[0].required_version, Some("12.0.0".to_string()));
    }

    #[test]
    fn test_fabric_recommends_any_x_version() {
        // Recommends with "any 3.x version" format
        let log = "Mod 'Debugify' (debugify) 1.20.1+2.0 recommends any 3.x version of yet-another-config-lib, which is missing!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::MissingRecommendation);
        assert_eq!(issues[0].mod_id, Some("debugify".to_string()));
        assert_eq!(issues[0].required_mod_id, Some("yet-another-config-lib".to_string()));
        assert_eq!(issues[0].required_version, Some("3.x".to_string()));
    }

    #[test]
    fn test_fabric_recommends_any_version() {
        // Recommends with "any version" format
        let log = "Mod 'Debugify' (debugify) 1.20.1+2.0 recommends any version of modmenu, which is missing!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::MissingRecommendation);
        assert_eq!(issues[0].required_mod_id, Some("modmenu".to_string()));
        assert_eq!(issues[0].required_version, None);
    }

    #[test]
    fn test_fabric_recommends_wrong_version() {
        // Recommends but wrong version is installed
        let log = "Mod 'Spellblades and Such' (spellbladenext) 2.3.0+1.20.1 recommends version 1.2.0+1.20.1 of mod 'Paladins & Priests (RPG Series)' (paladins), but only the wrong version is present: 1.4.0+1.20.1!";
        let issues = parse_fabric_issues(log);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issue_type, IssueType::RecommendedVersionMismatch);
        assert_eq!(issues[0].mod_id, Some("spellbladenext".to_string()));
        assert_eq!(issues[0].required_mod_id, Some("paladins".to_string()));
        assert_eq!(issues[0].required_mod_name, Some("Paladins & Priests (RPG Series)".to_string()));
        assert_eq!(issues[0].required_version, Some("1.2.0+1.20.1".to_string()));
        assert_eq!(issues[0].current_version, Some("1.4.0+1.20.1".to_string()));
    }
}
