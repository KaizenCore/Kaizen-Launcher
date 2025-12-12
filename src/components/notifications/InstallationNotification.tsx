import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Download, Loader2, CheckCircle, ChevronRight, X, Package } from "lucide-react"
import { listen } from "@tauri-apps/api/event"
import { cn } from "@/lib/utils"
import { useInstallationStore, InstallProgress, ModpackProgress } from "@/stores/installationStore"
import { useTranslation } from "@/i18n"

export function InstallationNotification() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const installations = useInstallationStore((state) => state.installations)
  const completeInstallation = useInstallationStore((state) => state.completeInstallation)

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
    const unlistenModpack = listen<ModpackProgress & { instance_id?: string; project_id?: string }>(
      "modpack-progress",
      (event) => {
        const store = useInstallationStore.getState()
        const instanceId = event.payload.instance_id
        const projectId = event.payload.project_id

        // Try instance_id first, then project_id (using modpack_ prefix)
        const trackingId = instanceId || (projectId ? `modpack_${projectId}` : null)

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
      }
    )

    return () => {
      unlistenInstall.then((fn) => fn())
      unlistenModpack.then((fn) => fn())
    }
  }, [])

  if (installations.size === 0) return null

  const installationsArray = Array.from(installations.values())

  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 w-96">
      {installationsArray.map((installation) => {
        const isModpack = installation.type === "modpack"
        const progress = installation.progress
        const modpackProgress = installation.modpackProgress
        const isComplete = progress?.stage === "complete"

        // Calculate percentage based on installation type and step
        let percentage = 0
        let currentMessage = t("instances.installing")

        if (isModpack) {
          if (installation.step === "modpack") {
            // Modpack download: 0-50%
            if (modpackProgress) {
              percentage = Math.round(modpackProgress.progress / 2)
              currentMessage = modpackProgress.message
            }
          } else if (installation.step === "minecraft") {
            // Minecraft installation: 50-100%
            if (progress && progress.total > 0) {
              percentage = 50 + Math.round((progress.current / progress.total) * 50)
              currentMessage = progress.message
            } else {
              // Transitioning - show 50% as we completed the modpack step
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
          <div
            key={installation.instanceId}
            className={cn(
              "bg-background/95 backdrop-blur border rounded-lg shadow-lg overflow-hidden transition-all duration-300",
              isComplete && "border-green-500/50"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {isComplete ? (
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                ) : isModpack ? (
                  <Package className="h-4 w-4 text-primary flex-shrink-0" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                )}
                <span className="text-sm font-medium truncate">
                  {installation.instanceName}
                </span>
                {isModpack && !isComplete && (
                  <span className="text-xs text-muted-foreground">
                    ({installation.step === "modpack" ? "1/2" : "2/2"})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => navigate(`/instances/${installation.instanceId}`)}
                  className="p-1 hover:bg-accent rounded transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                {isComplete && (
                  <button
                    onClick={() => completeInstallation(installation.instanceId)}
                    className="p-1 hover:bg-accent rounded transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress */}
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-muted-foreground truncate flex-1">
                  {currentMessage}
                </span>
                <span className={cn(
                  "font-mono font-medium flex-shrink-0",
                  isComplete ? "text-green-500" : "text-primary"
                )}>
                  {percentage}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300 rounded-full",
                    isComplete ? "bg-green-500" : "bg-primary"
                  )}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Stage indicator */}
              {!isComplete && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {isModpack ? (
                    <>
                      <Package className="h-3 w-3" />
                      <span>
                        {installation.step === "modpack"
                          ? t("modpack.downloadingMods")
                          : t("modpack.installingMinecraft")}
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="h-3 w-3" />
                      <span className="capitalize">{progress?.stage}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
