import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import type {
  ParsedLauncher,
  DetectedInstance,
  ImportOptions,
  ImportProgress,
  ImportableContent,
  ModFile,
  ImportStep,
} from "@/components/import/types"

interface ExternalImportState {
  // Detection state
  isScanning: boolean
  detectedLaunchers: ParsedLauncher[]
  scanError: string | null

  // Selection state
  selectedInstances: DetectedInstance[]

  // Import options
  importOptions: ImportOptions

  // Content preview
  importableContent: ImportableContent | null
  previewedMods: ModFile[]
  isLoadingContent: boolean

  // Import progress
  currentStep: ImportStep
  importProgress: ImportProgress | null
  importError: string | null
  importedInstances: string[]

  // Actions
  scanForLaunchers: () => Promise<void>
  selectInstance: (instance: DetectedInstance) => void
  deselectInstance: (instanceId: string) => void
  clearSelection: () => void
  setImportOptions: (options: Partial<ImportOptions>) => void
  loadImportableContent: (instancePath: string) => Promise<void>
  previewMods: (instancePath: string) => Promise<void>
  startImport: () => Promise<void>
  setCurrentStep: (step: ImportStep) => void
  setImportProgress: (progress: ImportProgress | null) => void
  reset: () => void
}

const defaultImportOptions: ImportOptions = {
  new_name: null,
  copy_mods: true,
  copy_config: true,
  copy_resourcepacks: true,
  copy_shaderpacks: true,
  copy_worlds: [],
  redownload_from_modrinth: true,
}

export const useExternalImportStore = create<ExternalImportState>()((set, get) => ({
  // Initial state
  isScanning: false,
  detectedLaunchers: [],
  scanError: null,
  selectedInstances: [],
  importOptions: { ...defaultImportOptions },
  importableContent: null,
  previewedMods: [],
  isLoadingContent: false,
  currentStep: "detection",
  importProgress: null,
  importError: null,
  importedInstances: [],

  // Scan for installed launchers
  scanForLaunchers: async () => {
    set({ isScanning: true, scanError: null })
    console.log("[ExternalImport] Scanning for launchers...")

    try {
      const launchers = await invoke<ParsedLauncher[]>("detect_external_launchers")
      console.log(`[ExternalImport] Found ${launchers.length} launchers`)
      set({ detectedLaunchers: launchers, isScanning: false })
    } catch (err) {
      console.error("[ExternalImport] Scan failed:", err)
      set({
        scanError: err instanceof Error ? err.message : String(err),
        isScanning: false,
      })
    }
  },

  // Selection management
  selectInstance: (instance) => {
    set((state) => {
      // Avoid duplicates
      if (state.selectedInstances.some((i) => i.id === instance.id)) {
        return state
      }
      return {
        selectedInstances: [...state.selectedInstances, instance],
      }
    })
  },

  deselectInstance: (instanceId) => {
    set((state) => ({
      selectedInstances: state.selectedInstances.filter((i) => i.id !== instanceId),
    }))
  },

  clearSelection: () => {
    set({ selectedInstances: [] })
  },

  // Import options
  setImportOptions: (options) => {
    set((state) => ({
      importOptions: { ...state.importOptions, ...options },
    }))
  },

  // Load importable content for preview
  loadImportableContent: async (instancePath) => {
    set({ isLoadingContent: true })
    console.log(`[ExternalImport] Loading content from: ${instancePath}`)

    try {
      const content = await invoke<ImportableContent>("get_importable_content", {
        instancePath,
      })
      console.log("[ExternalImport] Content loaded:", content)
      set({ importableContent: content, isLoadingContent: false })
    } catch (err) {
      console.error("[ExternalImport] Failed to load content:", err)
      set({ isLoadingContent: false })
    }
  },

  // Preview mods with Modrinth resolution
  previewMods: async (instancePath) => {
    console.log(`[ExternalImport] Previewing mods from: ${instancePath}`)

    try {
      const mods = await invoke<ModFile[]>("preview_external_mods", {
        instancePath,
      })
      console.log(`[ExternalImport] Found ${mods.length} mods`)
      set({ previewedMods: mods })
    } catch (err) {
      console.error("[ExternalImport] Failed to preview mods:", err)
      set({ previewedMods: [] })
    }
  },

  // Start import process
  startImport: async () => {
    const state = get()
    if (state.selectedInstances.length === 0) return

    set({ currentStep: "importing", importError: null, importedInstances: [] })
    console.log(`[ExternalImport] Starting import of ${state.selectedInstances.length} instance(s)`)

    const imported: string[] = []

    for (const instance of state.selectedInstances) {
      console.log(`[ExternalImport] Importing: ${instance.name}`)

      try {
        const result = await invoke<{ id: string }>("import_external_instance", {
          detected: instance,
          options: state.importOptions,
        })
        imported.push(result.id)
        console.log(`[ExternalImport] Successfully imported: ${instance.name}`)
      } catch (err) {
        console.error(`[ExternalImport] Failed to import ${instance.name}:`, err)
        set({
          importError: `Failed to import "${instance.name}": ${err}`,
          currentStep: "options",
        })
        return
      }
    }

    set({
      importedInstances: imported,
      currentStep: "complete",
      importProgress: null,
    })
    console.log(`[ExternalImport] Import complete: ${imported.length} instance(s)`)
  },

  setCurrentStep: (step) => {
    set({ currentStep: step })
  },

  setImportProgress: (progress) => {
    set({ importProgress: progress })
  },

  // Reset all state
  reset: () => {
    set({
      isScanning: false,
      detectedLaunchers: [],
      scanError: null,
      selectedInstances: [],
      importOptions: { ...defaultImportOptions },
      importableContent: null,
      previewedMods: [],
      isLoadingContent: false,
      currentStep: "detection",
      importProgress: null,
      importError: null,
      importedInstances: [],
    })
  },
}))
