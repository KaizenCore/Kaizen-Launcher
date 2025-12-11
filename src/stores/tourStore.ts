import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface TourStep {
  id: string
  targetSelector: string
  title: string
  description: string
  position?: "top" | "bottom" | "left" | "right"
}

interface TourState {
  isActive: boolean
  currentStepIndex: number
  steps: TourStep[]
  instanceId: string | null
  pendingTourInstanceId: string | null
  setPendingTour: (instanceId: string) => void
  clearPendingTour: () => void
  startTour: (instanceId: string, steps: TourStep[]) => void
  nextStep: () => void
  prevStep: () => void
  skipTour: () => void
  endTour: () => void
}

export const useTourStore = create<TourState>()(
  persist(
    (set, get) => ({
      isActive: false,
      currentStepIndex: 0,
      steps: [],
      instanceId: null,
      pendingTourInstanceId: null,

      setPendingTour: (instanceId) => {
        set({ pendingTourInstanceId: instanceId })
      },

      clearPendingTour: () => {
        set({ pendingTourInstanceId: null })
      },

      startTour: (instanceId, steps) => {
        set({
          isActive: true,
          currentStepIndex: 0,
          steps,
          instanceId,
          pendingTourInstanceId: null,
        })
      },

      nextStep: () => {
        const { currentStepIndex, steps } = get()
        if (currentStepIndex < steps.length - 1) {
          set({ currentStepIndex: currentStepIndex + 1 })
        } else {
          get().endTour()
        }
      },

      prevStep: () => {
        const { currentStepIndex } = get()
        if (currentStepIndex > 0) {
          set({ currentStepIndex: currentStepIndex - 1 })
        }
      },

      skipTour: () => {
        set({
          isActive: false,
          currentStepIndex: 0,
          steps: [],
          instanceId: null,
        })
      },

      endTour: () => {
        set({
          isActive: false,
          currentStepIndex: 0,
          steps: [],
          instanceId: null,
        })
      },
    }),
    {
      name: "kaizen-tour",
      partialize: (state) => ({ pendingTourInstanceId: state.pendingTourInstanceId }),
    }
  )
)
