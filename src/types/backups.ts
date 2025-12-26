// Types for instance backup management

export interface InstanceBackupInfo {
  filename: string;
  timestamp: string;
  size_bytes: number;
  instance_id: string;
  instance_name: string;
  mc_version: string;
  loader: string | null;
  is_server: boolean;
}

export interface GlobalInstanceBackupInfo {
  instance_id: string;
  instance_name: string;
  filename: string;
  timestamp: string;
  size_bytes: number;
  mc_version: string;
  loader: string | null;
  is_server: boolean;
}

export interface InstanceBackupStats {
  total_size: number;
  backup_count: number;
  instance_count: number;
}

export interface InstanceBackupContents {
  mods_count: number;
  mods_size: number;
  config_count: number;
  config_size: number;
  worlds_count: number;
  worlds_size: number;
  libraries_size: number;
  assets_size: number;
  other_size: number;
}

export interface InstanceBackupMetadata {
  id: string;
  name: string;
  mc_version: string;
  loader: string | null;
  loader_version: string | null;
  is_server: boolean;
  is_proxy: boolean;
  memory_min_mb: number;
  memory_max_mb: number;
  jvm_args: string;
  server_port: number;
}

export interface InstanceBackupManifest {
  version: string;
  kaizen_version: string;
  created_at: string;
  instance: InstanceBackupMetadata;
  contents: InstanceBackupContents;
  total_size_bytes: number;
}

export type RestoreMode = "replace" | "create_new";

export interface InstanceBackupProgressEvent {
  instance_id: string;
  progress: number;
  stage: string;
  message: string;
}
