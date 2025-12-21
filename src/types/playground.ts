// Instance types (matching backend)
export interface Instance {
  id: string;
  name: string;
  icon_path: string | null;
  mc_version: string;
  loader: string | null;
  loader_version: string | null;
  java_path: string | null;
  memory_min_mb: number;
  memory_max_mb: number;
  jvm_args: string;
  game_dir: string;
  created_at: string;
  last_played: string | null;
  total_playtime_seconds: number;
  is_server: boolean;
  is_proxy: boolean;
  server_port: number;
  modrinth_project_id: string | null;
}

// Dependency info from mod metadata
export interface DependencyInfo {
  project_id: string;
  version_id: string | null;
  dependency_type: "required" | "optional" | "incompatible" | "embedded";
}

// Extended mod info with dependency graph data
export interface ModInfoWithDependencies {
  name: string;
  version: string;
  filename: string;
  enabled: boolean;
  icon_url: string | null;
  project_id: string | null;
  dependencies: DependencyInfo[];
  dependents: string[]; // project_ids that depend on this mod
  server_side: string | null;
  client_side: string | null;
}

// Missing dependency info
export interface MissingDependency {
  mod_name: string;
  mod_project_id: string;
  dependency_project_id: string;
  dependency_type: "required" | "optional";
}

// Mod conflict info
export interface ModConflict {
  mod_a: string;
  mod_b: string;
  reason: string;
}

// Validation result from backend
export interface ModValidationResult {
  missing_required: MissingDependency[];
  conflicts: ModConflict[];
  warnings: string[];
}

// Playground settings (persisted)
export interface PlaygroundSettings {
  lastInstanceId: string | null;
  showOptionalDependencies: boolean;
  autoLayoutMods: boolean;
}
