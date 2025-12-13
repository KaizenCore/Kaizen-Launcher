import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"

// Backend type for active shares
interface BackendActiveShare {
  share_id: string
  instance_name: string
  package_path: string
  local_port: number
  public_url: string | null
  download_count: number
  uploaded_bytes: number
  started_at: string
  file_size: number
  provider: "bore" | "cloudflare"
}

export interface SharingProgress {
  operation_id: string
  stage: string
  progress: number
  message: string
}

export interface ExportableContent {
  instance_id: string
  instance_name: string
  mods: { available: boolean; count: number; total_size_bytes: number }
  config: { available: boolean; count: number; total_size_bytes: number }
  resourcepacks: { available: boolean; count: number; total_size_bytes: number }
  shaderpacks: { available: boolean; count: number; total_size_bytes: number }
  worlds: {
    name: string
    folder_name: string
    size_bytes: number
    is_server_world: boolean
  }[]
}

export interface ExportOptions {
  include_mods: boolean
  include_config: boolean
  include_resourcepacks: boolean
  include_shaderpacks: boolean
  include_worlds: string[]
}

export interface SharingManifest {
  version: string
  kaizen_version: string
  created_at: string
  instance: {
    name: string
    mc_version: string
    loader: string | null
    loader_version: string | null
    is_server: boolean
    is_proxy: boolean
  }
  contents: {
    mods: { included: boolean; count: number }
    config: { included: boolean; count: number }
    resourcepacks: { included: boolean; count: number }
    shaderpacks: { included: boolean; count: number }
    saves: { included: boolean; worlds: { name: string }[] }
  }
  total_size_bytes: number
}

export interface PreparedExport {
  export_id: string
  package_path: string
  manifest: SharingManifest
}

export interface SeedSession {
  exportId: string
  instanceName: string
  packagePath: string
  magnetUri: string | null
  peerCount: number
  uploadedBytes: number
  startedAt: number
}

export interface DownloadSession {
  magnetUri: string
  progress: number
  downloadedBytes: number
  totalBytes: number
  peerCount: number
  speed: number
}

interface SharingState {
  // Export state
  exportProgress: SharingProgress | null
  currentExport: PreparedExport | null
  activeSeeds: Map<string, SeedSession>

  // Import state
  importProgress: SharingProgress | null
  currentImport: SharingManifest | null
  activeDownloads: Map<string, DownloadSession>

  // Actions
  setExportProgress: (progress: SharingProgress | null) => void
  setCurrentExport: (exportData: PreparedExport | null) => void
  addSeed: (seed: SeedSession) => void
  removeSeed: (exportId: string) => void
  updateSeed: (exportId: string, updates: Partial<SeedSession>) => void

  setImportProgress: (progress: SharingProgress | null) => void
  setCurrentImport: (manifest: SharingManifest | null) => void
  addDownload: (magnetUri: string, session: DownloadSession) => void
  removeDownload: (magnetUri: string) => void
  updateDownload: (magnetUri: string, updates: Partial<DownloadSession>) => void

  // Helpers
  isExporting: () => boolean
  isImporting: () => boolean

  // Sync with backend
  syncWithBackend: () => Promise<void>
}

export const useSharingStore = create<SharingState>()((set, get) => ({
  exportProgress: null,
  currentExport: null,
  activeSeeds: new Map(),

  importProgress: null,
  currentImport: null,
  activeDownloads: new Map(),

  setExportProgress: (progress) => {
    if (progress) {
      console.log(`[SharingStore] Export progress: ${progress.stage} - ${progress.progress}% - ${progress.message}`)
    }
    set({ exportProgress: progress })
  },
  setCurrentExport: (exportData) => {
    if (exportData) {
      console.log(`[SharingStore] Export prepared: ${exportData.manifest.instance.name}`)
    }
    set({ currentExport: exportData })
  },

  addSeed: (seed) => {
    console.log(`[SharingStore] Starting seed: ${seed.instanceName}`)
    set((state) => {
      const newSeeds = new Map(state.activeSeeds)
      newSeeds.set(seed.exportId, seed)
      return { activeSeeds: newSeeds }
    })
  },

  removeSeed: (exportId) => {
    console.log(`[SharingStore] Stopping seed: ${exportId}`)
    set((state) => {
      const newSeeds = new Map(state.activeSeeds)
      newSeeds.delete(exportId)
      return { activeSeeds: newSeeds }
    })
  },

  updateSeed: (exportId, updates) => {
    set((state) => {
      const seed = state.activeSeeds.get(exportId)
      if (!seed) return state
      const newSeeds = new Map(state.activeSeeds)
      newSeeds.set(exportId, { ...seed, ...updates })
      return { activeSeeds: newSeeds }
    })
  },

  setImportProgress: (progress) => {
    if (progress) {
      console.log(`[SharingStore] Import progress: ${progress.stage} - ${progress.progress}% - ${progress.message}`)
    }
    set({ importProgress: progress })
  },
  setCurrentImport: (manifest) => {
    if (manifest) {
      console.log(`[SharingStore] Import manifest loaded: ${manifest.instance.name}`)
    }
    set({ currentImport: manifest })
  },

  addDownload: (magnetUri, session) => {
    console.log(`[SharingStore] Starting download from peer`)
    set((state) => {
      const newDownloads = new Map(state.activeDownloads)
      newDownloads.set(magnetUri, session)
      return { activeDownloads: newDownloads }
    })
  },

  removeDownload: (magnetUri) => {
    console.log(`[SharingStore] Download removed`)
    set((state) => {
      const newDownloads = new Map(state.activeDownloads)
      newDownloads.delete(magnetUri)
      return { activeDownloads: newDownloads }
    })
  },

  updateDownload: (magnetUri, updates) => {
    set((state) => {
      const download = state.activeDownloads.get(magnetUri)
      if (!download) return state
      const newDownloads = new Map(state.activeDownloads)
      newDownloads.set(magnetUri, { ...download, ...updates })
      return { activeDownloads: newDownloads }
    })
  },

  isExporting: () => get().exportProgress !== null,
  isImporting: () => get().importProgress !== null,

  syncWithBackend: async () => {
    try {
      const shares = await invoke<BackendActiveShare[]>("get_active_shares")
      console.log(`[SharingStore] Synced ${shares.length} active shares from backend`)

      // Convert backend shares to seed sessions
      const newSeeds = new Map<string, SeedSession>()
      for (const share of shares) {
        newSeeds.set(share.share_id, {
          exportId: share.share_id,
          instanceName: share.instance_name,
          packagePath: share.package_path,
          magnetUri: share.public_url,
          peerCount: 0,
          uploadedBytes: share.uploaded_bytes,
          startedAt: new Date(share.started_at).getTime(),
        })
      }

      set({ activeSeeds: newSeeds })
    } catch (err) {
      console.error("[SharingStore] Failed to sync with backend:", err)
    }
  },
}))
