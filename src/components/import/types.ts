// Types for external launcher import

export type LauncherType =
  | "minecraft_official"
  | "modrinth_app"
  | "prism_launcher"
  | "multi_mc"
  | "curse_forge"

export interface DetectedLauncher {
  launcher_type: LauncherType
  name: string
  path: string
  instance_count: number
  is_detected: boolean
}

export interface DetectedInstance {
  id: string
  launcher: LauncherType
  name: string
  path: string
  mc_version: string
  loader: string | null
  loader_version: string | null
  is_server: boolean
  icon_path: string | null
  last_played: string | null
  mod_count: number | null
  estimated_size: number | null
  raw_metadata: unknown
}

export interface ParsedLauncher {
  launcher: DetectedLauncher
  instances: DetectedInstance[]
}

export interface ModFile {
  filename: string
  path: string
  sha1: string | null
  sha512: string | null
  size: number
  modrinth_project_id: string | null
  modrinth_version_id: string | null
  modrinth_project_name: string | null
}

export interface ContentInfo {
  available: boolean
  count: number
  size_bytes: number
}

export interface WorldInfo {
  name: string
  folder_name: string
  size_bytes: number
}

export interface ImportableContent {
  mods: ContentInfo
  config: ContentInfo
  resourcepacks: ContentInfo
  shaderpacks: ContentInfo
  worlds: WorldInfo[]
}

export interface ImportOptions {
  new_name: string | null
  copy_mods: boolean
  copy_config: boolean
  copy_resourcepacks: boolean
  copy_shaderpacks: boolean
  copy_worlds: string[]
  redownload_from_modrinth: boolean
}

export interface ImportProgress {
  stage: string
  current: number
  total: number
  message: string
  instance_id: string | null
}

export type ImportStep = "detection" | "selection" | "options" | "importing" | "complete"

// Launcher icons and display info
export const LAUNCHER_INFO: Record<LauncherType, { icon: string; color: string; displayName: string }> = {
  minecraft_official: {
    icon: "🎮",
    color: "text-green-500",
    displayName: "Minecraft Launcher",
  },
  modrinth_app: {
    icon: "🟢",
    color: "text-emerald-500",
    displayName: "Modrinth App",
  },
  prism_launcher: {
    icon: "🔷",
    color: "text-blue-500",
    displayName: "Prism Launcher",
  },
  multi_mc: {
    icon: "📦",
    color: "text-purple-500",
    displayName: "MultiMC",
  },
  curse_forge: {
    icon: "🔥",
    color: "text-orange-500",
    displayName: "CurseForge",
  },
}
