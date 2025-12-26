import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { Loader2, RefreshCw, AlertTriangle, CheckCircle, HelpCircle, ArrowRight } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface Instance {
  id: string
  name: string
  mc_version: string
  loader: string | null
  loader_version: string | null
  is_server: boolean
  is_proxy: boolean
}

interface ChangeVersionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: Instance | null
  onSuccess?: () => void
}

interface VersionInfo {
  id: string
  version_type: string
  url: string
  release_time: string
}

interface MinecraftVersionList {
  latest_release: string
  latest_snapshot: string
  versions: VersionInfo[]
}

interface LoaderVersion {
  version: string
  stable: boolean
  minecraft_version: string | null
  download_url: string | null
}

interface ModCompatibilityInfo {
  filename: string
  name: string
  project_id: string | null
  current_version_id: string | null
  icon_url: string | null
  compatibility:
    | { type: "compatible"; version_id: string; version_number: string }
    | { type: "incompatible" }
    | { type: "unknown" }
}

interface VersionChangeProgress {
  stage: string
  current: number
  total: number
  message: string
  instance_id: string
}

type Step = "select" | "compatibility" | "progress" | "complete"

export function ChangeVersionDialog({
  open,
  onOpenChange,
  instance,
  onSuccess,
}: ChangeVersionDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("select")
  const [error, setError] = useState<string | null>(null)

  // Version selection
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [newMcVersion, setNewMcVersion] = useState("")

  // Loader version selection
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false)
  const [newLoaderVersion, setNewLoaderVersion] = useState("")

  // Compatibility check
  const [isCheckingCompatibility, setIsCheckingCompatibility] = useState(false)
  const [compatibilityInfo, setCompatibilityInfo] = useState<ModCompatibilityInfo[]>([])

  // Progress
  const [progress, setProgress] = useState<VersionChangeProgress | null>(null)

  // Reset when dialog opens
  useEffect(() => {
    if (open && instance) {
      setStep("select")
      setError(null)
      setNewMcVersion("")
      setNewLoaderVersion("")
      setCompatibilityInfo([])
      setProgress(null)
      fetchVersions()
    }
  }, [open, instance])

  // Fetch loader versions when MC version changes
  useEffect(() => {
    if (open && instance?.loader && instance.loader !== "vanilla" && newMcVersion) {
      fetchLoaderVersions()
    } else {
      setLoaderVersions([])
      setNewLoaderVersion("")
    }
  }, [open, instance?.loader, newMcVersion])

  // Listen to progress events
  useEffect(() => {
    if (!open || !instance) return

    const unlistenPromise = listen<VersionChangeProgress>("version-change-progress", (event) => {
      if (event.payload.instance_id === instance.id) {
        setProgress(event.payload)
        if (event.payload.stage === "complete") {
          setStep("complete")
        }
      }
    })

    return () => {
      unlistenPromise.then(unlisten => unlisten())
    }
  }, [open, instance])

  const fetchVersions = async () => {
    if (!instance) return

    setIsLoadingVersions(true)
    try {
      const result = await invoke<MinecraftVersionList>("get_minecraft_versions", {
        includeSnapshots: showSnapshots,
      })
      setVersions(result.versions)
    } catch (err) {
      console.error("Failed to fetch versions:", err)
      setError(t("errors.loadError"))
    } finally {
      setIsLoadingVersions(false)
    }
  }

  const fetchLoaderVersions = async () => {
    if (!instance?.loader || instance.loader === "vanilla" || !newMcVersion) return

    setIsLoadingLoaderVersions(true)
    try {
      const result = await invoke<LoaderVersion[]>("get_loader_versions", {
        loaderType: instance.loader,
        mcVersion: newMcVersion,
      })
      setLoaderVersions(result)

      // Auto-select recommended version
      const recommended = result.find(v => v.stable) || result[0]
      if (recommended) {
        setNewLoaderVersion(recommended.version)
      }
    } catch (err) {
      console.error("Failed to fetch loader versions:", err)
      setLoaderVersions([])
    } finally {
      setIsLoadingLoaderVersions(false)
    }
  }

  const checkCompatibility = async () => {
    if (!instance || !newMcVersion) return

    setIsCheckingCompatibility(true)
    setError(null)

    try {
      const result = await invoke<ModCompatibilityInfo[]>("check_mods_version_compatibility", {
        instanceId: instance.id,
        targetMcVersion: newMcVersion,
        targetLoader: instance.loader,
      })
      setCompatibilityInfo(result)
      setStep("compatibility")
    } catch (err) {
      console.error("Failed to check compatibility:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsCheckingCompatibility(false)
    }
  }

  const startVersionChange = async () => {
    if (!instance || !newMcVersion) return

    setStep("progress")
    setError(null)

    try {
      // Build list of mods to update (only compatible ones)
      const modsToUpdate: [string, string][] = compatibilityInfo
        .filter(mod => mod.compatibility.type === "compatible" && mod.project_id)
        .map(mod => [
          mod.project_id!,
          (mod.compatibility as { type: "compatible"; version_id: string }).version_id,
        ])

      await invoke("change_instance_version", {
        request: {
          instance_id: instance.id,
          new_mc_version: newMcVersion,
          new_loader: instance.loader,
          new_loader_version: newLoaderVersion || null,
          mods_to_update: modsToUpdate,
        },
      })
    } catch (err) {
      console.error("Failed to change version:", err)
      setError(err instanceof Error ? err.message : String(err))
      setStep("compatibility")
    }
  }

  const handleClose = () => {
    if (step === "progress") return // Don't close during progress
    onOpenChange(false)
    if (step === "complete") {
      onSuccess?.()
    }
  }

  const compatibleMods = compatibilityInfo.filter(m => m.compatibility.type === "compatible")
  const incompatibleMods = compatibilityInfo.filter(m => m.compatibility.type === "incompatible")
  const unknownMods = compatibilityInfo.filter(m => m.compatibility.type === "unknown")

  const formatVersionLabel = (version: VersionInfo) => {
    const typeLabel = version.version_type === "snapshot" ? " (Snapshot)" : ""
    const isCurrent = version.id === instance?.mc_version
    return `${version.id}${typeLabel}${isCurrent ? ` - ${t("changeVersion.current")}` : ""}`
  }

  const formatLoaderVersionLabel = (version: LoaderVersion) => {
    const stable = version.stable ? "" : " (beta)"
    return `${version.version}${stable}`
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>{t("changeVersion.title")}</DialogTitle>
          <DialogDescription>
            {instance?.name} - {instance?.mc_version}
            {instance?.loader && ` (${instance.loader})`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 1: Version Selection */}
        {step === "select" && (
          <div className="grid gap-4 py-4">
            {/* Minecraft Version */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>{t("changeVersion.newVersion")}</Label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="snapshots"
                      checked={showSnapshots}
                      onCheckedChange={(checked) => {
                        setShowSnapshots(checked)
                        fetchVersions()
                      }}
                    />
                    <Label htmlFor="snapshots" className="text-sm text-muted-foreground">
                      {t("settings.showSnapshots")}
                    </Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={fetchVersions}
                    disabled={isLoadingVersions}
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoadingVersions ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <Select value={newMcVersion} onValueChange={setNewMcVersion} disabled={isLoadingVersions}>
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingVersions ? t("common.loading") : t("changeVersion.selectVersion")} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {versions.map((v) => (
                    <SelectItem
                      key={v.id}
                      value={v.id}
                      disabled={v.id === instance?.mc_version}
                    >
                      {formatVersionLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Loader Version (if applicable) */}
            {instance?.loader && instance.loader !== "vanilla" && (
              <div className="grid gap-2">
                <Label>{t("changeVersion.loaderVersion")} ({instance.loader})</Label>
                <Select
                  value={newLoaderVersion}
                  onValueChange={setNewLoaderVersion}
                  disabled={isLoadingLoaderVersions || !newMcVersion}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoadingLoaderVersions
                          ? t("common.loading")
                          : !newMcVersion
                            ? t("changeVersion.selectMcFirst")
                            : loaderVersions.length === 0
                              ? t("changeVersion.noLoaderVersions")
                              : t("changeVersion.selectLoaderVersion")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {loaderVersions.map((v) => (
                      <SelectItem key={v.version} value={v.version}>
                        {formatLoaderVersionLabel(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Compatibility Report */}
        {step === "compatibility" && (
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{instance?.mc_version}</span>
              <ArrowRight className="h-4 w-4" />
              <span className="font-medium text-foreground">{newMcVersion}</span>
            </div>

            {compatibilityInfo.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("changeVersion.noMods")}
              </p>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-4">
                  {/* Compatible Mods */}
                  {compatibleMods.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
                        <CheckCircle className="h-4 w-4" />
                        {t("changeVersion.compatibleMods")} ({compatibleMods.length})
                      </div>
                      <div className="space-y-1 pl-6">
                        {compatibleMods.map((mod) => (
                          <div key={mod.filename} className="flex items-center justify-between text-sm">
                            <span>{mod.name}</span>
                            <span className="text-muted-foreground">
                              {(mod.compatibility as { type: "compatible"; version_number: string }).version_number}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Incompatible Mods */}
                  {incompatibleMods.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-yellow-600 dark:text-yellow-400">
                        <AlertTriangle className="h-4 w-4" />
                        {t("changeVersion.incompatibleMods")} ({incompatibleMods.length})
                      </div>
                      <div className="space-y-1 pl-6">
                        {incompatibleMods.map((mod) => (
                          <div key={mod.filename} className="text-sm text-muted-foreground">
                            {mod.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unknown Mods */}
                  {unknownMods.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <HelpCircle className="h-4 w-4" />
                        {t("changeVersion.unknownMods")} ({unknownMods.length})
                      </div>
                      <div className="space-y-1 pl-6">
                        {unknownMods.map((mod) => (
                          <div key={mod.filename} className="text-sm text-muted-foreground">
                            {mod.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            {incompatibleMods.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t("changeVersion.incompatibleWarning")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Step 3: Progress */}
        {step === "progress" && progress && (
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{progress.message}</span>
                <span className="text-muted-foreground">
                  {Math.round((progress.current / progress.total) * 100)}%
                </span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} />
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && (
          <div className="grid gap-4 py-4">
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-center font-medium">{t("changeVersion.success")}</p>
              <p className="text-center text-sm text-muted-foreground">
                {t("changeVersion.reinstallNote")}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "select" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={checkCompatibility}
                disabled={!newMcVersion || isCheckingCompatibility || Boolean(instance?.loader && instance.loader !== "vanilla" && !newLoaderVersion)}
              >
                {isCheckingCompatibility ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("changeVersion.checking")}
                  </>
                ) : (
                  t("common.next")
                )}
              </Button>
            </>
          )}

          {step === "compatibility" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")}>
                {t("common.back")}
              </Button>
              <Button onClick={startVersionChange}>
                {t("changeVersion.confirm")}
              </Button>
            </>
          )}

          {step === "progress" && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("changeVersion.changing")}
            </Button>
          )}

          {step === "complete" && (
            <Button onClick={handleClose}>
              {t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
