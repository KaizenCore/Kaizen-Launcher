import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useBrowseCacheStore } from "@/stores/browseCacheStore"

interface SearchParams {
  query: string
  projectType: string
  loader: string | null
  mcVersion: string | null
  categories: string[]
  sort: string
  offset: number
  limit: number
}

interface SearchResponse<T> {
  results: T[]
  total_hits: number
  offset: number
  limit: number
}

// Stable selectors - only select functions (which are stable in Zustand)
// This prevents re-renders when cache data changes
const selectGetCachedSearch = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.getCachedSearch
const selectSetCachedSearch = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.setCachedSearch
const selectGetCachedVersions = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.getCachedVersions
const selectSetCachedVersions = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.setCachedVersions
const selectGetCachedInstalled = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.getCachedInstalled
const selectSetCachedInstalled = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.setCachedInstalled
const selectInvalidateInstalled = (state: ReturnType<typeof useBrowseCacheStore.getState>) => state.invalidateInstalled

/**
 * Hook for cached Modrinth API calls
 * Provides search, versions, and installed IDs with automatic caching
 */
export function useBrowseCache<TResult, TVersion>() {
  // Use individual selectors for stable function references
  // This prevents re-renders when cache data (maps) change
  const getCachedSearch = useBrowseCacheStore(selectGetCachedSearch)
  const setCachedSearch = useBrowseCacheStore(selectSetCachedSearch)
  const getCachedVersions = useBrowseCacheStore(selectGetCachedVersions)
  const setCachedVersions = useBrowseCacheStore(selectSetCachedVersions)
  const getCachedInstalled = useBrowseCacheStore(selectGetCachedInstalled)
  const setCachedInstalled = useBrowseCacheStore(selectSetCachedInstalled)
  const invalidateInstalled = useBrowseCacheStore(selectInvalidateInstalled)

  /**
   * Search with caching
   */
  const searchWithCache = useCallback(
    async (params: SearchParams): Promise<SearchResponse<TResult>> => {
      const cacheKey = {
        query: params.query,
        projectType: params.projectType,
        loader: params.loader,
        mcVersion: params.mcVersion,
        categories: params.categories,
        sort: params.sort,
        offset: params.offset,
      }

      // Check cache first
      const cached = getCachedSearch(cacheKey)
      if (cached) {
        return {
          results: cached.results as TResult[],
          total_hits: cached.total_hits,
          offset: params.offset,
          limit: params.limit,
        }
      }

      // Fetch from API - query must be a string (empty string is valid)
      const result = await invoke<SearchResponse<TResult>>("search_modrinth_mods", {
        query: params.query,
        projectType: params.projectType,
        loader: params.loader,
        mcVersion: params.mcVersion,
        categories: params.categories.length > 0 ? params.categories : null,
        sort: params.sort,
        offset: params.offset,
        limit: params.limit,
      })

      // Cache the result
      setCachedSearch(cacheKey, {
        results: result.results,
        total_hits: result.total_hits,
      })

      return result
    },
    [getCachedSearch, setCachedSearch]
  )

  /**
   * Get project versions with caching
   */
  const getVersionsWithCache = useCallback(
    async (
      projectId: string,
      mcVersion?: string | null,
      loader?: string | null
    ): Promise<TVersion[]> => {
      // Check cache first (only for unfiltered requests)
      if (!mcVersion && !loader) {
        const cached = getCachedVersions(projectId)
        if (cached) {
          return cached as TVersion[]
        }
      }

      // Fetch from API
      const versions = await invoke<TVersion[]>("get_modrinth_mod_versions", {
        projectId,
        mcVersion: mcVersion || null,
        loader: loader || null,
      })

      // Cache unfiltered results
      if (!mcVersion && !loader) {
        setCachedVersions(projectId, versions)
      }

      return versions
    },
    [getCachedVersions, setCachedVersions]
  )

  /**
   * Get installed IDs with caching
   */
  const getInstalledWithCache = useCallback(
    async (instanceId: string, projectType: string): Promise<string[]> => {
      const cacheKey = `${instanceId}:${projectType}`

      // Check cache first
      const cached = getCachedInstalled(cacheKey)
      if (cached) {
        return cached
      }

      // Fetch from API
      const ids = await invoke<string[]>("get_installed_mod_ids", {
        instanceId,
        projectType,
      })

      // Cache the result
      setCachedInstalled(cacheKey, ids)

      return ids
    },
    [getCachedInstalled, setCachedInstalled]
  )

  /**
   * Invalidate installed cache after installing/uninstalling
   */
  const invalidateInstalledCache = useCallback(
    (instanceId: string, projectType: string) => {
      invalidateInstalled(`${instanceId}:${projectType}`)
    },
    [invalidateInstalled]
  )

  return {
    searchWithCache,
    getVersionsWithCache,
    getInstalledWithCache,
    invalidateInstalledCache,
  }
}
