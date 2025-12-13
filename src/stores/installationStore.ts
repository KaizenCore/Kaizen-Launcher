import { create } from "zustand"

// Progress from install-progress events (instance installation)
export interface InstallProgress {
  stage: string
  current: number
  total: number
  message: string
}

// Progress from modpack-progress events (modpack download)
export interface ModpackProgress {
  stage: string
  message: string
  progress: number // 0-100
}

export type InstallationType = "instance" | "modpack"

export interface Installation {
  instanceId: string
  instanceName: string
  type: InstallationType
  progress: InstallProgress | null
  modpackProgress: ModpackProgress | null  // For modpack downloads
  step: "modpack" | "minecraft" | null  // Which step we're on for modpacks
  startedAt: number
}

interface InstallationState {
  // Current installations (supports multiple)
  installations: Map<string, Installation>

  // Actions
  startInstallation: (instanceId: string, instanceName: string, type?: InstallationType) => void
  updateProgress: (instanceId: string, progress: InstallProgress) => void
  updateModpackProgress: (instanceId: string, progress: ModpackProgress) => void
  setStep: (instanceId: string, step: "modpack" | "minecraft" | null) => void
  migrateInstallation: (oldId: string, newId: string) => void
  completeInstallation: (instanceId: string) => void
  cancelInstallation: (instanceId: string) => void

  // Helpers
  isInstalling: (instanceId: string) => boolean
  getInstallation: (instanceId: string) => Installation | undefined
  hasActiveInstallations: () => boolean
}

export const useInstallationStore = create<InstallationState>()((set, get) => ({
  installations: new Map(),

  startInstallation: (instanceId, instanceName, type = "instance") => {
    console.log(`[InstallStore] Starting ${type} installation: ${instanceName} (${instanceId})`)
    set((state) => {
      const newInstallations = new Map(state.installations)
      newInstallations.set(instanceId, {
        instanceId,
        instanceName,
        type,
        progress: null,
        modpackProgress: null,
        step: type === "modpack" ? "modpack" : null,
        startedAt: Date.now(),
      })
      return { installations: newInstallations }
    })
  },

  updateProgress: (instanceId, progress) => {
    set((state) => {
      const installation = state.installations.get(instanceId)
      if (!installation) return state

      const newInstallations = new Map(state.installations)
      newInstallations.set(instanceId, {
        ...installation,
        progress,
        step: installation.type === "modpack" ? "minecraft" : null,
      })
      return { installations: newInstallations }
    })
  },

  updateModpackProgress: (instanceId, progress) => {
    set((state) => {
      const installation = state.installations.get(instanceId)
      if (!installation) return state

      const newInstallations = new Map(state.installations)
      newInstallations.set(instanceId, {
        ...installation,
        modpackProgress: progress,
      })
      return { installations: newInstallations }
    })
  },

  setStep: (instanceId, step) => {
    set((state) => {
      const installation = state.installations.get(instanceId)
      if (!installation) return state

      const newInstallations = new Map(state.installations)
      newInstallations.set(instanceId, {
        ...installation,
        step,
      })
      return { installations: newInstallations }
    })
  },

  migrateInstallation: (oldId, newId) => {
    set((state) => {
      const installation = state.installations.get(oldId)
      if (!installation) return state

      const newInstallations = new Map(state.installations)
      newInstallations.delete(oldId)
      newInstallations.set(newId, {
        ...installation,
        instanceId: newId,
      })
      return { installations: newInstallations }
    })
  },

  completeInstallation: (instanceId) => {
    console.log(`[InstallStore] Installation completed: ${instanceId}`)
    set((state) => {
      const newInstallations = new Map(state.installations)
      newInstallations.delete(instanceId)
      return { installations: newInstallations }
    })
  },

  cancelInstallation: (instanceId) => {
    console.log(`[InstallStore] Installation cancelled: ${instanceId}`)
    set((state) => {
      const newInstallations = new Map(state.installations)
      newInstallations.delete(instanceId)
      return { installations: newInstallations }
    })
  },

  isInstalling: (instanceId) => {
    return get().installations.has(instanceId)
  },

  getInstallation: (instanceId) => {
    return get().installations.get(instanceId)
  },

  hasActiveInstallations: () => {
    return get().installations.size > 0
  },
}))
