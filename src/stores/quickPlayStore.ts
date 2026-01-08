import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"

interface QuickPlayModpack {
  projectId: string
  name: string
  iconUrl: string | null
}

interface ModpackVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  downloads: number
  date_published: string
}

interface Instance {
  id: string
  name: string
  mc_version: string
  loader: string | null
  modrinth_project_id: string | null
}

interface VersionCache {
  versions: ModpackVersion[]
  timestamp: number
  projectId: string
}

interface InstanceCache {
  instance: Instance | null
  isInstalled: boolean
  timestamp: number
  key: string // projectId_mcVersion
}

type InstallStage = "idle" | "modpack" | "minecraft" | "ready" | "launching"

interface QuickPlayState {
  // Default modpack (persisted in backend)
  defaultModpack: QuickPlayModpack
  loading: boolean
  loaded: boolean

  // Version cache
  versionCache: VersionCache | null
  versionsLoading: boolean

  // Selected version
  selectedVersionId: string | null

  // Instance cache (keyed by projectId_mcVersion)
  instanceCache: Map<string, InstanceCache>
  instanceCheckLoading: boolean

  // Current instance state (persists between tab switches)
  currentInstance: Instance | null
  installStage: InstallStage

  // Account state
  activeAccountId: string | null
  accountChecked: boolean

  // Actions
  load: () => Promise<void>
  setDefaultModpack: (modpack: QuickPlayModpack) => Promise<void>
  loadVersions: (projectId: string, forceRefresh?: boolean) => Promise<ModpackVersion[]>
  setSelectedVersion: (versionId: string) => void
  checkInstance: (projectId: string, modpackName: string, mcVersion: string, forceRefresh?: boolean) => Promise<{ instance: Instance | null; isInstalled: boolean }>
  updateInstanceCache: (projectId: string, mcVersion: string, instance: Instance | null, isInstalled: boolean) => void
  setCurrentInstance: (instance: Instance | null) => void
  setInstallStage: (stage: InstallStage) => void
  checkAccount: () => Promise<void>
}

// Cache duration: 10 minutes
const CACHE_DURATION = 10 * 60 * 1000
// Instance cache duration: 2 minutes (shorter since install status can change)
const INSTANCE_CACHE_DURATION = 2 * 60 * 1000

// Fabulously Optimized as the initial default
const FABULOUSLY_OPTIMIZED: QuickPlayModpack = {
  projectId: "1KVo5zza",
  name: "Fabulously Optimized",
  iconUrl: "https://cdn.modrinth.com/data/1KVo5zza/9f1ded4949c2a9db5ca382d3bcc912c7245486b4_96.webp",
}

export const useQuickPlayStore = create<QuickPlayState>((set, get) => ({
  defaultModpack: FABULOUSLY_OPTIMIZED,
  loading: true,
  loaded: false,
  versionCache: null,
  versionsLoading: false,
  selectedVersionId: null,
  instanceCache: new Map(),
  instanceCheckLoading: false,
  currentInstance: null,
  installStage: "idle",
  activeAccountId: null,
  accountChecked: false,

  load: async () => {
    // Prevent multiple loads
    if (get().loaded) {
      return
    }

    try {
      const saved = await invoke<string | null>("get_setting_value", {
        key: "quick_play_modpack"
      })

      let modpack: QuickPlayModpack = FABULOUSLY_OPTIMIZED

      if (saved) {
        modpack = JSON.parse(saved) as QuickPlayModpack
      }

      // Always fetch fresh icon URL from Modrinth
      try {
        const projectInfo = await invoke<{ icon_url: string | null }>("get_modrinth_mod_details", {
          projectId: modpack.projectId
        })
        if (projectInfo?.icon_url) {
          modpack = { ...modpack, iconUrl: projectInfo.icon_url }
          // Save the updated icon URL
          await invoke("set_setting_value", {
            key: "quick_play_modpack",
            value: JSON.stringify(modpack),
          })
        }
      } catch (e) {
        // Silently fail - use cached icon URL
        console.warn("Failed to fetch project icon:", e)
      }

      set({ defaultModpack: modpack, loading: false, loaded: true })
    } catch (error) {
      console.error("Failed to load quick play settings:", error)
      set({ loading: false, loaded: true })
    }
  },

  setDefaultModpack: async (modpack: QuickPlayModpack) => {
    try {
      await invoke("set_setting_value", {
        key: "quick_play_modpack",
        value: JSON.stringify(modpack),
      })
      // Clear caches when modpack changes
      set({
        defaultModpack: modpack,
        versionCache: null,
        selectedVersionId: null,
        instanceCache: new Map(),
      })
    } catch (error) {
      console.error("Failed to save quick play modpack:", error)
      throw error
    }
  },

  loadVersions: async (projectId: string, forceRefresh = false) => {
    const { versionCache } = get()

    // Check if cache is valid
    if (
      !forceRefresh &&
      versionCache &&
      versionCache.projectId === projectId &&
      Date.now() - versionCache.timestamp < CACHE_DURATION
    ) {
      return versionCache.versions
    }

    set({ versionsLoading: true })

    try {
      const versions = await invoke<ModpackVersion[]>("get_modrinth_mod_versions", {
        projectId,
        gameVersion: null,
        loader: null,
        projectType: "modpack",
      })

      const newCache: VersionCache = {
        versions,
        timestamp: Date.now(),
        projectId,
      }

      // Auto-select first version if none selected
      const { selectedVersionId } = get()
      const newSelectedVersion = selectedVersionId && versions.some(v => v.id === selectedVersionId)
        ? selectedVersionId
        : versions[0]?.id || null

      set({
        versionCache: newCache,
        versionsLoading: false,
        selectedVersionId: newSelectedVersion,
      })

      return versions
    } catch (error) {
      console.error("Failed to load versions:", error)
      set({ versionsLoading: false })
      return []
    }
  },

  setSelectedVersion: (versionId: string) => {
    set({ selectedVersionId: versionId })
  },

  checkInstance: async (projectId: string, modpackName: string, mcVersion: string, forceRefresh = false) => {
    const cacheKey = `${projectId}_${mcVersion}`
    const { instanceCache } = get()
    const cached = instanceCache.get(cacheKey)

    // Check if cache is valid
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.timestamp < INSTANCE_CACHE_DURATION
    ) {
      return { instance: cached.instance, isInstalled: cached.isInstalled }
    }

    set({ instanceCheckLoading: true })

    try {
      // First try to find by modrinth_project_id
      let instances = await invoke<Instance[]>("get_instances_by_modpack", {
        projectId,
      })

      let existing: Instance | undefined = instances.find((i) => i.mc_version === mcVersion)

      // Fallback: search all instances by name pattern (for older instances)
      if (!existing) {
        const allInstances = await invoke<Instance[]>("get_instances")
        const expectedName = `${modpackName} ${mcVersion}`
        existing = allInstances.find((i) =>
          i.name === expectedName ||
          (i.name.includes(modpackName) && i.mc_version === mcVersion)
        )
      }

      // Check if installed
      let isInstalled = false
      if (existing) {
        isInstalled = await invoke<boolean>("is_instance_installed", {
          instanceId: existing.id,
        })
      }

      // Update cache
      const newCache = new Map(get().instanceCache)
      newCache.set(cacheKey, {
        instance: existing || null,
        isInstalled,
        timestamp: Date.now(),
        key: cacheKey,
      })

      set({ instanceCache: newCache, instanceCheckLoading: false })

      return { instance: existing || null, isInstalled }
    } catch (error) {
      console.error("Failed to check instance:", error)
      set({ instanceCheckLoading: false })
      return { instance: null, isInstalled: false }
    }
  },

  updateInstanceCache: (projectId: string, mcVersion: string, instance: Instance | null, isInstalled: boolean) => {
    const cacheKey = `${projectId}_${mcVersion}`
    const newCache = new Map(get().instanceCache)
    newCache.set(cacheKey, {
      instance,
      isInstalled,
      timestamp: Date.now(),
      key: cacheKey,
    })
    set({ instanceCache: newCache })
  },

  setCurrentInstance: (instance: Instance | null) => {
    set({ currentInstance: instance })
  },

  setInstallStage: (stage: InstallStage) => {
    set({ installStage: stage })
  },

  checkAccount: async () => {
    // Skip if already checked
    if (get().accountChecked) {
      return
    }

    try {
      const account = await invoke<{ id: string } | null>("get_active_account")
      set({ activeAccountId: account?.id || null, accountChecked: true })
    } catch {
      set({ activeAccountId: null, accountChecked: true })
    }
  },
}))
