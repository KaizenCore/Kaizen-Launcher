import { create } from "zustand"

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
  packagePath: string
  magnetUri: string | null
  peerCount: number
  uploadedBytes: number
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
}

export const useSharingStore = create<SharingState>()((set, get) => ({
  exportProgress: null,
  currentExport: null,
  activeSeeds: new Map(),

  importProgress: null,
  currentImport: null,
  activeDownloads: new Map(),

  setExportProgress: (progress) => set({ exportProgress: progress }),
  setCurrentExport: (exportData) => set({ currentExport: exportData }),

  addSeed: (seed) => {
    set((state) => {
      const newSeeds = new Map(state.activeSeeds)
      newSeeds.set(seed.exportId, seed)
      return { activeSeeds: newSeeds }
    })
  },

  removeSeed: (exportId) => {
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

  setImportProgress: (progress) => set({ importProgress: progress }),
  setCurrentImport: (manifest) => set({ currentImport: manifest }),

  addDownload: (magnetUri, session) => {
    set((state) => {
      const newDownloads = new Map(state.activeDownloads)
      newDownloads.set(magnetUri, session)
      return { activeDownloads: newDownloads }
    })
  },

  removeDownload: (magnetUri) => {
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
}))
