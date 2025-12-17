import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Download,
  Loader2,
  CheckCircle,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Package,
  X,
} from "lucide-react"
import { listen } from "@tauri-apps/api/event"
import { cn } from "@/lib/utils"
import {
  useInstallationStore,
  InstallProgress,
  ModpackProgress,
  Installation,
} from "@/stores/installationStore"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"

function InstallationItem({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const completeInstallation = useInstallationStore(
    (state) => state.completeInstallation
  )

  const isModpack = installation.type === "modpack"
  const progress = installation.progress
  const modpackProgress = installation.modpackProgress
  const isComplete = progress?.stage === "complete"

  // Calculate percentage based on installation type and step
  let percentage = 0
  let currentMessage = t("instances.installing")
  let fileCounter: string | null = null

  if (isModpack) {
    if (installation.step === "modpack") {
      // Modpack download: 0-50%
      if (modpackProgress) {
        percentage = Math.round(modpackProgress.progress / 2)
        currentMessage = modpackProgress.message

        // Show file counter if available
        if (installation.fileProgress) {
          fileCounter = `${installation.fileProgress.current}/${installation.fileProgress.total}`
        }
      }
    } else if (installation.step === "minecraft") {
      // Minecraft installation: 50-100%
      if (progress && progress.total > 0) {
        percentage = 50 + Math.round((progress.current / progress.total) * 50)
        currentMessage = progress.message
      } else {
        percentage = 50
        currentMessage = t("modpack.installingMinecraft")
      }
    }
  } else {
    // Regular instance installation
    if (progress && progress.total > 0) {
      percentage = Math.round((progress.current / progress.total) * 100)
      currentMessage = progress.message
    }
  }

  return (
    <div className="px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          {isComplete ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : isModpack ? (
            <Package className="h-5 w-5 text-primary" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate text-sm">
                {installation.instanceName}
              </span>
              {isModpack && !isComplete && (
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  ({installation.step === "modpack" ? "1/2" : "2/2"})
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-xs font-mono font-medium flex-shrink-0",
                isComplete ? "text-green-500" : "text-primary"
              )}
            >
              {percentage}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-300 rounded-full",
                isComplete
                  ? "bg-green-500"
                  : "bg-gradient-to-r from-primary to-primary/80"
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>

          {/* Detailed message */}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <span className="truncate">{currentMessage}</span>
            {fileCounter && (
              <span className="flex-shrink-0 font-mono">({fileCounter})</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => navigate(`/instances/${installation.instanceId}`)}
            className="p-1.5 hover:bg-accent rounded transition-colors"
            title={t("common.viewDetails")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {isComplete && (
            <button
              onClick={() => completeInstallation(installation.instanceId)}
              className="p-1.5 hover:bg-accent rounded transition-colors"
              title={t("common.dismiss")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function InstallationFooter() {
  const { t } = useTranslation()
  const [isMinimized, setIsMinimized] = useState(false)
  const installations = useInstallationStore((state) => state.installations)


  // Listen for installation progress events globally
  useEffect(() => {
    // Listen for instance installation progress
    const unlistenInstall = listen<InstallProgress & { instance_id?: string }>(
      "install-progress",
      (event) => {
        const store = useInstallationStore.getState()
        const instanceId = event.payload.instance_id

        if (instanceId) {
          store.updateProgress(instanceId, event.payload)

          if (event.payload.stage === "complete") {
            setTimeout(() => {
              useInstallationStore.getState().completeInstallation(instanceId)
            }, 3000)
          }
        } else {
          // Fallback: update all active installations
          store.installations.forEach((_, id) => {
            store.updateProgress(id, event.payload)
            if (event.payload.stage === "complete") {
              setTimeout(() => {
                useInstallationStore.getState().completeInstallation(id)
              }, 3000)
            }
          })
        }
      }
    )

    // Listen for modpack download progress
    const unlistenModpack = listen<
      ModpackProgress & { instance_id?: string; project_id?: string }
    >("modpack-progress", (event) => {
      const store = useInstallationStore.getState()
      const instanceId = event.payload.instance_id
      const projectId = event.payload.project_id

      // Determine the correct tracking ID
      // Priority: check if modpack_<projectId> exists first (initial tracking),
      // then check instanceId (after migration)
      let trackingId: string | null = null

      if (projectId) {
        const modpackTrackingId = `modpack_${projectId}`
        if (store.installations.has(modpackTrackingId)) {
          trackingId = modpackTrackingId
        }
      }

      if (!trackingId && instanceId && store.installations.has(instanceId)) {
        trackingId = instanceId
      }

      // Fallback: try modpack prefix if nothing found
      if (!trackingId && projectId) {
        trackingId = `modpack_${projectId}`
      }

      if (trackingId) {
        store.updateModpackProgress(trackingId, event.payload)
      } else {
        // Fallback: update all modpack installations
        store.installations.forEach((installation, id) => {
          if (installation.type === "modpack" && installation.step === "modpack") {
            store.updateModpackProgress(id, event.payload)
          }
        })
      }
    })

    return () => {
      unlistenInstall.then((fn) => fn())
      unlistenModpack.then((fn) => fn())
    }
  }, [])

  if (installations.size === 0) return null

  const installationsArray = Array.from(installations.values())
  const activeCount = installationsArray.filter(
    (i) => i.progress?.stage !== "complete"
  ).length

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40",
        "bg-background/95 backdrop-blur-md border-t shadow-lg",
        "transition-transform duration-300 ease-out",
        isMinimized ? "translate-y-[calc(100%-40px)]" : "translate-y-0"
      )}
    >
      {/* Header bar - always visible */}
      <div
        className="h-10 flex items-center justify-between px-4 bg-muted/50 cursor-pointer select-none"
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2">
          <Download
            className={cn(
              "h-4 w-4",
              activeCount > 0 && "animate-pulse text-primary"
            )}
          />
          <span className="text-sm font-medium">
            {t("installation.inProgress", { count: installations.size })}
          </span>
          {activeCount > 0 && (
            <span className="text-xs text-muted-foreground">
              ({activeCount} {t("common.active")})
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={(e) => {
            e.stopPropagation()
            setIsMinimized(!isMinimized)
          }}
        >
          {isMinimized ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Expanded content */}
      {!isMinimized && (
        <div className="max-h-64 overflow-y-auto">
          {installationsArray.map((installation) => (
            <InstallationItem
              key={installation.instanceId}
              installation={installation}
            />
          ))}
        </div>
      )}
    </div>
  )
}
