import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import {
  Download,
  Loader2,
  FolderOpen,
  Check,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Package,
  Settings2,
  Image,
  Layers,
  Map,
  RefreshCw,
  HardDrive,
  Clock,
  FileArchive,
} from "lucide-react"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useExternalImportStore } from "@/stores/externalImportStore"
import {
  type DetectedInstance,
  type ParsedLauncher,
  type ImportProgress,
  type ImportStep,
  LAUNCHER_INFO,
} from "./types"

interface ExternalLauncherImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ""
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString()
  } catch {
    return ""
  }
}

// Step indicator component
function StepIndicator({ currentStep }: { currentStep: ImportStep }) {
  const steps: { key: ImportStep; label: string }[] = [
    { key: "detection", label: "1" },
    { key: "selection", label: "2" },
    { key: "options", label: "3" },
    { key: "importing", label: "4" },
  ]

  const getCurrentIndex = () => {
    return steps.findIndex((s) => s.key === currentStep)
  }

  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {steps.map((step, index) => {
        const isActive = step.key === currentStep
        const isCompleted = getCurrentIndex() > index || currentStep === "complete"

        return (
          <div key={step.key} className="flex items-center">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                isActive && "bg-primary text-primary-foreground",
                isCompleted && !isActive && "bg-green-500 text-white",
                !isActive && !isCompleted && "bg-muted text-muted-foreground"
              )}
            >
              {isCompleted && !isActive ? <Check className="h-4 w-4" /> : step.label}
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "w-8 h-0.5 mx-1",
                  getCurrentIndex() > index ? "bg-green-500" : "bg-muted"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// Launcher card component
function LauncherCard({
  launcher,
  isExpanded,
  onToggleExpand,
  selectedInstanceIds,
  onToggleInstance,
  onSelectAll,
  onDeselectAll,
}: {
  launcher: ParsedLauncher
  isExpanded: boolean
  onToggleExpand: () => void
  selectedInstanceIds: Set<string>
  onToggleInstance: (instance: DetectedInstance) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}) {
  const info = LAUNCHER_INFO[launcher.launcher.launcher_type] || {
    icon: "📁",
    color: "text-gray-500",
    displayName: launcher.launcher.name || "Unknown Launcher",
  }

  const selectedCount = launcher.instances.filter(i => selectedInstanceIds.has(i.id)).length
  const allSelected = selectedCount === launcher.instances.length && launcher.instances.length > 0

  return (
    <div
      className={cn(
        "border-2 rounded-xl transition-all duration-200 overflow-hidden",
        isExpanded ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      )}
    >
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center justify-center w-12 h-12 rounded-xl text-2xl",
            "bg-gradient-to-br from-muted to-muted/50"
          )}>
            {info.icon}
          </div>
          <div>
            <h4 className="font-semibold">{info.displayName}</h4>
            <p className="text-sm text-muted-foreground">
              {launcher.launcher.instance_count} instance{launcher.launcher.instance_count > 1 ? "s" : ""} disponible{launcher.launcher.instance_count > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
              {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
            </span>
          )}
          <ChevronRight
            className={cn("h-5 w-5 transition-transform duration-200", isExpanded && "rotate-90")}
          />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0">
          {/* Select all / Deselect all */}
          <div className="flex items-center justify-between mb-3 pb-3 border-b">
            <span className="text-sm text-muted-foreground">
              {selectedCount} / {launcher.instances.length} sélectionnée{launcher.instances.length > 1 ? "s" : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation()
                if (allSelected) {
                  onDeselectAll()
                } else {
                  onSelectAll()
                }
              }}
            >
              {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
            </Button>
          </div>

          {/* Instances list */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {launcher.instances.map((instance) => (
              <InstanceRow
                key={instance.id}
                instance={instance}
                isSelected={selectedInstanceIds.has(instance.id)}
                onToggle={() => onToggleInstance(instance)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Loader badge colors
const LOADER_COLORS: Record<string, string> = {
  fabric: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  forge: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  neoforge: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  quilt: "bg-purple-500/15 text-purple-500 border-purple-500/30",
}

// Instance row component
function InstanceRow({
  instance,
  isSelected,
  onToggle,
}: {
  instance: DetectedInstance
  isSelected: boolean
  onToggle: () => void
}) {
  const loaderColor = instance.loader
    ? LOADER_COLORS[instance.loader.toLowerCase()] || "bg-muted text-muted-foreground"
    : null

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200",
        isSelected
          ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
          : "border-transparent bg-card hover:border-primary/30 hover:bg-accent/50"
      )}
      onClick={onToggle}
    >
      {/* Selection indicator */}
      <div className={cn(
        "flex items-center justify-center w-5 h-5 rounded-md border-2 transition-all",
        isSelected
          ? "bg-primary border-primary"
          : "border-muted-foreground/30 group-hover:border-primary/50"
      )}>
        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>

      {/* Instance icon/initial */}
      <div className={cn(
        "flex items-center justify-center w-10 h-10 rounded-lg text-lg font-bold shrink-0",
        "bg-gradient-to-br from-muted to-muted/50"
      )}>
        {instance.name.charAt(0).toUpperCase()}
      </div>

      {/* Instance info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold truncate">{instance.name}</span>
          {instance.is_server && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-500 border border-blue-500/30">
              SERVER
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Version badge */}
          <span className={cn(
            "px-2 py-0.5 rounded-md text-xs font-medium",
            instance.mc_version !== "unknown"
              ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
              : "bg-muted text-muted-foreground"
          )}>
            {instance.mc_version !== "unknown" ? instance.mc_version : "Version ?"}
          </span>

          {/* Loader badge */}
          {instance.loader && (
            <span className={cn(
              "px-2 py-0.5 rounded-md text-xs font-medium capitalize border",
              loaderColor
            )}>
              {instance.loader}
            </span>
          )}

          {/* Mod count badge */}
          {instance.mod_count !== null && instance.mod_count > 0 && (
            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">
              <Package className="h-3 w-3 inline mr-1" />
              {instance.mod_count}
            </span>
          )}
        </div>
      </div>

      {/* Right side info */}
      <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground shrink-0">
        {instance.estimated_size && instance.estimated_size > 0 && (
          <div className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            {formatBytes(instance.estimated_size)}
          </div>
        )}
        {instance.last_played && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(instance.last_played)}
          </div>
        )}
      </div>
    </div>
  )
}

export function ExternalLauncherImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: ExternalLauncherImportDialogProps) {
  const { t } = useTranslation()
  const store = useExternalImportStore()

  // Local state
  const [expandedLauncher, setExpandedLauncher] = useState<string | null>(null)
  const [manualPath, setManualPath] = useState("")
  const [manualInstance, setManualInstance] = useState<DetectedInstance | null>(null)
  const [isParsingManual, setIsParsingManual] = useState(false)

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      store.reset()
      setExpandedLauncher(null)
      setManualPath("")
      setManualInstance(null)
      setIsParsingManual(false)
    }
  }, [open])

  // Scan for launchers when dialog opens
  useEffect(() => {
    if (open && store.currentStep === "detection" && store.detectedLaunchers.length === 0) {
      store.scanForLaunchers()
    }
  }, [open])

  // Listen for import progress events
  useEffect(() => {
    const unlisten = listen<ImportProgress>("import-progress", (event) => {
      store.setImportProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // Handle manual file/folder selection
  const handleSelectManual = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("externalImport.selectInstanceFolder"),
      })

      if (selected) {
        setManualPath(selected as string)
        setIsParsingManual(true)

        try {
          const instance = await invoke<DetectedInstance>("parse_external_path", {
            path: selected,
          })
          setManualInstance(instance)
        } catch (err) {
          console.error("Failed to parse manual path:", err)
          setManualInstance(null)
        } finally {
          setIsParsingManual(false)
        }
      }
    } catch (err) {
      console.error("Failed to select folder:", err)
    }
  }

  // Handle mrpack/zip file selection
  const handleSelectFile = async () => {
    try {
      const selected = await openDialog({
        filters: [{ name: "Modpack", extensions: ["mrpack", "zip"] }],
        multiple: false,
        title: t("externalImport.selectModpackFile"),
      })

      if (selected) {
        setManualPath(selected as string)
        setIsParsingManual(true)

        try {
          const instance = await invoke<DetectedInstance>("parse_external_path", {
            path: selected,
          })
          setManualInstance(instance)
        } catch (err) {
          console.error("Failed to parse file:", err)
          setManualInstance(null)
        } finally {
          setIsParsingManual(false)
        }
      }
    } catch (err) {
      console.error("Failed to select file:", err)
    }
  }

  // Toggle instance selection
  const toggleInstance = (instance: DetectedInstance) => {
    if (store.selectedInstances.some((i) => i.id === instance.id)) {
      store.deselectInstance(instance.id)
    } else {
      store.selectInstance(instance)
    }
  }

  // Add manual instance to selection
  const addManualInstance = () => {
    if (manualInstance) {
      store.selectInstance(manualInstance)
      setManualPath("")
      setManualInstance(null)
    }
  }

  // Navigate steps
  const goToStep = (step: ImportStep) => {
    store.setCurrentStep(step)
  }

  // Load content when entering options step
  useEffect(() => {
    if (
      store.currentStep === "options" &&
      store.selectedInstances.length === 1 &&
      !store.importableContent
    ) {
      const instance = store.selectedInstances[0]
      store.loadImportableContent(instance.path)
    }
  }, [store.currentStep])

  // Render detection step
  const renderDetectionStep = () => (
    <div className="space-y-4">
      {store.isScanning ? (
        <div className="flex flex-col items-center py-8">
          <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
          <p className="font-medium">{t("externalImport.scanning")}</p>
          <p className="text-sm text-muted-foreground">
            {t("externalImport.scanningDescription")}
          </p>
        </div>
      ) : (
        <>
          {/* Detected launchers */}
          {store.detectedLaunchers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("externalImport.detectedLaunchers")}</Label>
                <Button variant="ghost" size="sm" onClick={() => store.scanForLaunchers()}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {t("externalImport.rescan")}
                </Button>
              </div>
              <div className="space-y-2">
                {store.detectedLaunchers.map((launcher) => {
                  const isExpanded = expandedLauncher === launcher.launcher.launcher_type
                  const selectedInstanceIds = new Set(store.selectedInstances.map(i => i.id))

                  return (
                    <LauncherCard
                      key={launcher.launcher.launcher_type}
                      launcher={launcher}
                      isExpanded={isExpanded}
                      onToggleExpand={() =>
                        setExpandedLauncher(isExpanded ? null : launcher.launcher.launcher_type)
                      }
                      selectedInstanceIds={selectedInstanceIds}
                      onToggleInstance={toggleInstance}
                      onSelectAll={() => {
                        launcher.instances.forEach((instance) => {
                          if (!store.selectedInstances.some((i) => i.id === instance.id)) {
                            store.selectInstance(instance)
                          }
                        })
                      }}
                      onDeselectAll={() => {
                        launcher.instances.forEach((instance) => {
                          store.deselectInstance(instance.id)
                        })
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {store.detectedLaunchers.length === 0 && !store.scanError && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {t("externalImport.noLaunchersFound")}
              </p>
            </div>
          )}

          {store.scanError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{store.scanError}</span>
            </div>
          )}

          <Separator className="my-4" />

          {/* Manual selection */}
          <div className="space-y-3">
            <Label>{t("externalImport.manualSelection")}</Label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSelectManual} className="flex-1">
                <FolderOpen className="h-4 w-4 mr-2" />
                {t("externalImport.selectFolder")}
              </Button>
              <Button variant="outline" onClick={handleSelectFile} className="flex-1">
                <FileArchive className="h-4 w-4 mr-2" />
                {t("externalImport.selectFile")}
              </Button>
            </div>

            {isParsingManual && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("externalImport.parsing")}
              </div>
            )}

            {manualPath && manualInstance && (
              <div className="p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{manualInstance.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {manualInstance.mc_version}
                      {manualInstance.loader && ` - ${manualInstance.loader}`}
                    </p>
                  </div>
                  <Button size="sm" onClick={addManualInstance}>
                    <Check className="h-4 w-4 mr-1" />
                    {t("externalImport.add")}
                  </Button>
                </div>
              </div>
            )}

            {manualPath && !manualInstance && !isParsingManual && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{t("externalImport.unrecognizedFormat")}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  // Render selection step (summary)
  const renderSelectionStep = () => (
    <div className="space-y-4">
      <Label>{t("externalImport.selectedInstances")}</Label>
      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-2">
          {store.selectedInstances.map((instance) => (
            <InstanceRow
              key={instance.id}
              instance={instance}
              isSelected={true}
              onToggle={() => store.deselectInstance(instance.id)}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex justify-between text-sm pt-2 border-t">
        <span className="text-muted-foreground">{t("externalImport.totalSelected")}</span>
        <span className="font-medium">{store.selectedInstances.length}</span>
      </div>
    </div>
  )

  // Render options step
  const renderOptionsStep = () => (
    <div className="space-y-4">
      {/* Instance name (only for single import) */}
      {store.selectedInstances.length === 1 && (
        <div className="space-y-2">
          <Label>{t("externalImport.instanceName")}</Label>
          <Input
            value={store.importOptions.new_name || store.selectedInstances[0].name}
            onChange={(e) =>
              store.setImportOptions({
                new_name: e.target.value || null,
              })
            }
            placeholder={store.selectedInstances[0].name}
          />
        </div>
      )}

      {/* Content options */}
      <div className="space-y-3">
        <Label>{t("externalImport.contentToImport")}</Label>

        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="copy-mods"
              checked={store.importOptions.copy_mods}
              onCheckedChange={(checked) =>
                store.setImportOptions({ copy_mods: checked === true })
              }
            />
            <label htmlFor="copy-mods" className="flex items-center gap-2 cursor-pointer">
              <Package className="h-4 w-4 text-primary" />
              <span>Mods</span>
              {store.importableContent?.mods.available && (
                <span className="text-xs text-muted-foreground">
                  ({store.importableContent.mods.count})
                </span>
              )}
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="copy-config"
              checked={store.importOptions.copy_config}
              onCheckedChange={(checked) =>
                store.setImportOptions({ copy_config: checked === true })
              }
            />
            <label htmlFor="copy-config" className="flex items-center gap-2 cursor-pointer">
              <Settings2 className="h-4 w-4 text-primary" />
              <span>{t("externalImport.config")}</span>
              {store.importableContent?.config.available && (
                <span className="text-xs text-muted-foreground">
                  ({store.importableContent.config.count})
                </span>
              )}
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="copy-resourcepacks"
              checked={store.importOptions.copy_resourcepacks}
              onCheckedChange={(checked) =>
                store.setImportOptions({ copy_resourcepacks: checked === true })
              }
            />
            <label
              htmlFor="copy-resourcepacks"
              className="flex items-center gap-2 cursor-pointer"
            >
              <Image className="h-4 w-4 text-primary" />
              <span>{t("externalImport.resourcepacks")}</span>
              {store.importableContent?.resourcepacks.available && (
                <span className="text-xs text-muted-foreground">
                  ({store.importableContent.resourcepacks.count})
                </span>
              )}
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="copy-shaderpacks"
              checked={store.importOptions.copy_shaderpacks}
              onCheckedChange={(checked) =>
                store.setImportOptions({ copy_shaderpacks: checked === true })
              }
            />
            <label
              htmlFor="copy-shaderpacks"
              className="flex items-center gap-2 cursor-pointer"
            >
              <Layers className="h-4 w-4 text-primary" />
              <span>{t("externalImport.shaderpacks")}</span>
              {store.importableContent?.shaderpacks.available && (
                <span className="text-xs text-muted-foreground">
                  ({store.importableContent.shaderpacks.count})
                </span>
              )}
            </label>
          </div>
        </div>
      </div>

      {/* Worlds selection */}
      {store.importableContent?.worlds && store.importableContent.worlds.length > 0 && (
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Map className="h-4 w-4" />
            {t("externalImport.worlds")}
          </Label>
          <div className="space-y-2 pl-4">
            {store.importableContent.worlds.map((world) => (
              <div key={world.folder_name} className="flex items-center space-x-2">
                <Checkbox
                  id={`world-${world.folder_name}`}
                  checked={store.importOptions.copy_worlds.includes(world.folder_name)}
                  onCheckedChange={(checked) => {
                    const newWorlds = checked
                      ? [...store.importOptions.copy_worlds, world.folder_name]
                      : store.importOptions.copy_worlds.filter(
                          (w) => w !== world.folder_name
                        )
                    store.setImportOptions({ copy_worlds: newWorlds })
                  }}
                />
                <label
                  htmlFor={`world-${world.folder_name}`}
                  className="flex items-center justify-between flex-1 cursor-pointer"
                >
                  <span>{world.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(world.size_bytes)}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modrinth re-download option */}
      <div className="p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="redownload-modrinth"
            checked={store.importOptions.redownload_from_modrinth}
            onCheckedChange={(checked) =>
              store.setImportOptions({ redownload_from_modrinth: checked === true })
            }
          />
          <label
            htmlFor="redownload-modrinth"
            className="flex-1 cursor-pointer"
          >
            <span className="font-medium">{t("externalImport.redownloadFromModrinth")}</span>
            <p className="text-xs text-muted-foreground mt-1">
              {t("externalImport.redownloadDescription")}
            </p>
          </label>
        </div>
      </div>

      {store.importError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{store.importError}</span>
        </div>
      )}
    </div>
  )

  // Render importing step
  const renderImportingStep = () => (
    <div className="py-8 space-y-4">
      <div className="flex flex-col items-center">
        <Download className="h-12 w-12 text-primary mb-4 animate-bounce" />
        <p className="font-medium">
          {store.importProgress?.stage || t("externalImport.importing")}
        </p>
        <p className="text-sm text-muted-foreground">{store.importProgress?.message || ""}</p>
      </div>
      <Progress
        value={
          store.importProgress
            ? (store.importProgress.current / store.importProgress.total) * 100
            : 0
        }
        className="h-2"
      />
    </div>
  )

  // Render complete step
  const renderCompleteStep = () => (
    <div className="py-8 space-y-4">
      <div className="flex flex-col items-center">
        <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-green-500" />
        </div>
        <p className="font-medium text-green-500">{t("externalImport.importSuccess")}</p>
        <p className="text-sm text-muted-foreground">
          {t("externalImport.importedCount", { count: store.importedInstances.length })}
        </p>
      </div>
    </div>
  )

  // Render content based on current step
  const renderContent = () => {
    switch (store.currentStep) {
      case "detection":
        return renderDetectionStep()
      case "selection":
        return renderSelectionStep()
      case "options":
        return renderOptionsStep()
      case "importing":
        return renderImportingStep()
      case "complete":
        return renderCompleteStep()
      default:
        return null
    }
  }

  // Get step title
  const getStepTitle = () => {
    switch (store.currentStep) {
      case "detection":
        return t("externalImport.stepDetection")
      case "selection":
        return t("externalImport.stepSelection")
      case "options":
        return t("externalImport.stepOptions")
      case "importing":
        return t("externalImport.stepImporting")
      case "complete":
        return t("externalImport.stepComplete")
      default:
        return ""
    }
  }

  // Handle dialog close
  const handleClose = () => {
    if (store.currentStep === "complete") {
      onSuccess?.()
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t("externalImport.title")}
          </DialogTitle>
          <DialogDescription>{getStepTitle()}</DialogDescription>
        </DialogHeader>

        {store.currentStep !== "complete" && store.currentStep !== "importing" && (
          <StepIndicator currentStep={store.currentStep} />
        )}

        {renderContent()}

        <DialogFooter>
          {store.currentStep === "detection" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => goToStep("selection")}
                disabled={store.selectedInstances.length === 0}
              >
                {t("common.next")}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}

          {store.currentStep === "selection" && (
            <>
              <Button variant="outline" onClick={() => goToStep("detection")}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t("common.back")}
              </Button>
              <Button onClick={() => goToStep("options")}>
                {t("common.next")}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}

          {store.currentStep === "options" && (
            <>
              <Button variant="outline" onClick={() => goToStep("selection")}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t("common.back")}
              </Button>
              <Button onClick={() => store.startImport()}>
                <Download className="h-4 w-4 mr-2" />
                {t("externalImport.startImport")}
              </Button>
            </>
          )}

          {store.currentStep === "importing" && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t("externalImport.importing")}
            </Button>
          )}

          {store.currentStep === "complete" && (
            <Button onClick={handleClose}>{t("common.close")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
