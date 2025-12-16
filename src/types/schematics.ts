// Schematic format types
export type SchematicFormat = "schem" | "schematic" | "litematic" | "nbt"

// Sync status between library and instances
export type SyncStatus = "synced" | "pending_to_library" | "pending_to_instance" | "conflict"

// Source of the schematic
export type SchematicSource = "library" | "instance" | "both"

// Conflict resolution options
export type ConflictResolution = "keep_library" | "keep_instance" | "keep_both"

// Schematic dimensions extracted from NBT
export interface SchematicDimensions {
  width: number
  height: number
  length: number
}

// Main schematic record
export interface Schematic {
  id: string
  name: string
  filename: string
  format: SchematicFormat
  file_hash: string
  file_size_bytes: number
  library_path: string | null
  dimensions: SchematicDimensions | null
  author: string | null
  author_locked: boolean // True if author was extracted from file (cannot be modified)
  description: string | null
  mc_version: string | null
  is_favorite: boolean
  tags: string[]
  created_at: string
  updated_at: string
}

// Link between schematic and instance
export interface SchematicInstanceLink {
  id: string
  schematic_id: string
  instance_id: string
  instance_path: string
  source: SchematicSource
  sync_status: SyncStatus
  last_synced_at: string | null
  created_at: string
}

// Schematic with instance relationships
export interface SchematicWithInstances {
  schematic: Schematic
  instances: Array<{
    instance_id: string
    instance_name: string
    instance_path: string
    sync_status: SyncStatus
  }>
}

// Conflict between library and instance versions
export interface SchematicConflict {
  schematic_id: string
  schematic_name: string
  instance_id: string
  instance_name: string
  library_hash: string
  instance_hash: string
  library_modified: string
  instance_modified: string
  library_size: number
  instance_size: number
}

// Statistics for the schematics library
export interface SchematicStats {
  total_schematics: number
  total_size_bytes: number
  formats: Record<string, number>
  instances_with_schematics: number
  favorites_count: number
}

// Detected schematic in instance (before import)
export interface DetectedSchematic {
  path: string
  filename: string
  format: SchematicFormat
  file_hash: string
  file_size_bytes: number
  in_library: boolean
}

// Instance info for schematic operations
export interface InstanceInfo {
  id: string
  name: string
  is_server: boolean
}

// Sharing provider options
export type SharingProvider = "bore" | "cloudflare"

// Active schematic share
export interface SchematicShare {
  share_id: string
  instance_name: string  // Actually schematic name
  package_path: string
  local_port: number
  public_url: string | null
  download_count: number
  uploaded_bytes: number
  started_at: string
  file_size: number
  provider: SharingProvider
  has_password: boolean
}

// Share info from URL preview
export interface SchematicShareInfo {
  filename: string
  file_size: number
  needs_password: boolean
}

// Download progress event
export interface SchematicDownloadProgress {
  stage: "downloading" | "complete"
  progress: number
  filename: string
}
