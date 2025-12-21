/**
 * Shared types for Modrinth browse components
 */

// ============================================================================
// Search Result Types
// ============================================================================

export interface ModSearchResult {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
  game_versions: string[]
  loaders: string[]
}

export interface ModVersionInfo {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  downloads: number
  date_published: string
}

export interface ModSearchResponse {
  results: ModSearchResult[]
  total_hits: number
  offset: number
  limit: number
}

// ============================================================================
// View Modes
// ============================================================================

export type ViewMode = "grid" | "list" | "compact"

// ============================================================================
// Content Types
// ============================================================================

export type ContentType = "mod" | "resourcepack" | "shader" | "datapack" | "plugin" | "modpack"

// ============================================================================
// Sort Options
// ============================================================================

export const SORT_OPTIONS = [
  { value: "relevance", labelKey: "modrinth.sortRelevance" as const },
  { value: "downloads", labelKey: "modrinth.sortDownloads" as const },
  { value: "newest", labelKey: "modrinth.sortNewest" as const },
  { value: "updated", labelKey: "modrinth.sortUpdated" as const },
] as const

// ============================================================================
// Constants
// ============================================================================

export const ITEMS_PER_PAGE = 20
