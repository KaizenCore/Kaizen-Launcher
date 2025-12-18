import { create } from "zustand"

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000

// Max cache entries per type to prevent memory bloat
const MAX_CACHE_ENTRIES = 100

interface CacheEntry<T> {
  data: T
  timestamp: number
}

interface SearchCacheKey {
  query: string
  projectType: string
  loader: string | null
  mcVersion: string | null
  categories: string[]
  sort: string
  offset: number
}

interface BrowseCacheState {
  // Search results cache: key -> { results, total_hits, timestamp }
  searchCache: Map<string, CacheEntry<{ results: unknown[]; total_hits: number }>>

  // Project versions cache: projectId -> { versions, timestamp }
  versionsCache: Map<string, CacheEntry<unknown[]>>

  // Installed IDs cache: instanceId -> { ids, timestamp }
  installedCache: Map<string, CacheEntry<string[]>>

  // Actions
  getCachedSearch: (key: SearchCacheKey) => { results: unknown[]; total_hits: number } | null
  setCachedSearch: (key: SearchCacheKey, data: { results: unknown[]; total_hits: number }) => void

  getCachedVersions: (projectId: string) => unknown[] | null
  setCachedVersions: (projectId: string, versions: unknown[]) => void

  getCachedInstalled: (instanceId: string) => string[] | null
  setCachedInstalled: (instanceId: string, ids: string[]) => void

  // Invalidation
  invalidateInstalled: (instanceId: string) => void
  invalidateSearch: (projectType?: string) => void
  clearAll: () => void
}

// Generate a consistent cache key from search parameters
function generateSearchKey(key: SearchCacheKey): string {
  return JSON.stringify({
    q: key.query,
    t: key.projectType,
    l: key.loader,
    v: key.mcVersion,
    c: [...key.categories].sort(),
    s: key.sort,
    o: key.offset,
  })
}

// Check if a cache entry is still valid
function isValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  if (!entry) return false
  return Date.now() - entry.timestamp < CACHE_TTL
}

// Prune old entries from a map to prevent memory bloat
function pruneMap<T>(map: Map<string, CacheEntry<T>>, maxEntries: number): void {
  if (map.size <= maxEntries) return

  // Sort by timestamp and remove oldest
  const entries = Array.from(map.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
    .slice(0, maxEntries)

  map.clear()
  entries.forEach(([k, v]) => map.set(k, v))
}

export const useBrowseCacheStore = create<BrowseCacheState>((set, get) => ({
  searchCache: new Map(),
  versionsCache: new Map(),
  installedCache: new Map(),

  getCachedSearch: (key) => {
    const cacheKey = generateSearchKey(key)
    const entry = get().searchCache.get(cacheKey)
    if (isValid(entry)) {
      console.log("[BrowseCache] Search cache HIT:", key.projectType, key.query || "(empty)")
      return entry.data
    }
    console.log("[BrowseCache] Search cache MISS:", key.projectType, key.query || "(empty)")
    return null
  },

  setCachedSearch: (key, data) => {
    const cacheKey = generateSearchKey(key)
    set((state) => {
      const newCache = new Map(state.searchCache)
      newCache.set(cacheKey, { data, timestamp: Date.now() })
      pruneMap(newCache, MAX_CACHE_ENTRIES)
      return { searchCache: newCache }
    })
    console.log("[BrowseCache] Search cached:", key.projectType, key.query || "(empty)", `(${data.results.length} results)`)
  },

  getCachedVersions: (projectId) => {
    const entry = get().versionsCache.get(projectId)
    if (isValid(entry)) {
      console.log("[BrowseCache] Versions cache HIT:", projectId)
      return entry.data
    }
    return null
  },

  setCachedVersions: (projectId, versions) => {
    set((state) => {
      const newCache = new Map(state.versionsCache)
      newCache.set(projectId, { data: versions, timestamp: Date.now() })
      pruneMap(newCache, MAX_CACHE_ENTRIES)
      return { versionsCache: newCache }
    })
    console.log("[BrowseCache] Versions cached:", projectId, `(${versions.length} versions)`)
  },

  getCachedInstalled: (instanceId) => {
    const entry = get().installedCache.get(instanceId)
    if (isValid(entry)) {
      console.log("[BrowseCache] Installed cache HIT:", instanceId)
      return entry.data
    }
    return null
  },

  setCachedInstalled: (instanceId, ids) => {
    set((state) => {
      const newCache = new Map(state.installedCache)
      newCache.set(instanceId, { data: ids, timestamp: Date.now() })
      return { installedCache: newCache }
    })
    console.log("[BrowseCache] Installed cached:", instanceId, `(${ids.length} items)`)
  },

  invalidateInstalled: (instanceId) => {
    set((state) => {
      const newCache = new Map(state.installedCache)
      newCache.delete(instanceId)
      return { installedCache: newCache }
    })
    console.log("[BrowseCache] Invalidated installed cache for:", instanceId)
  },

  invalidateSearch: (projectType) => {
    if (projectType) {
      // Invalidate only searches for this project type
      set((state) => {
        const newCache = new Map(state.searchCache)
        for (const [key] of newCache) {
          if (key.includes(`"t":"${projectType}"`)) {
            newCache.delete(key)
          }
        }
        return { searchCache: newCache }
      })
      console.log("[BrowseCache] Invalidated search cache for:", projectType)
    } else {
      // Invalidate all search cache
      set({ searchCache: new Map() })
      console.log("[BrowseCache] Invalidated all search cache")
    }
  },

  clearAll: () => {
    set({
      searchCache: new Map(),
      versionsCache: new Map(),
      installedCache: new Map(),
    })
    console.log("[BrowseCache] Cleared all caches")
  },
}))
