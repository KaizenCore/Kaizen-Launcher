import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  Package,
  Loader2,
  Copy,
  Check,
  FolderArchive,
  Settings2,
  Image,
  Layers,
  Map,
  Users,
  Upload,
  QrCode,
  X,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { useSharingStore, type ExportableContent, type ExportOptions, type PreparedExport, type SharingProgress } from "@/stores/sharingStore"
import { webtorrentClient, type SeedInfo } from "@/lib/webtorrent"

interface ExportInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instanceId: string
  instanceName: string
}

type ExportStep = "select" | "preparing" | "seeding" | "ready"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

export function ExportInstanceDialog({
  open,
  onOpenChange,
  instanceId,
  instanceName,
}: ExportInstanceDialogProps) {
  const { t } = useTranslation()
  const { setExportProgress, setCurrentExport, addSeed } = useSharingStore()

  // State
  const [step, setStep] = useState<ExportStep>("select")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [exportableContent, setExportableContent] = useState<ExportableContent | null>(null)
  const [progress, setProgress] = useState<SharingProgress | null>(null)
  const [preparedExport, setPreparedExport] = useState<PreparedExport | null>(null)
  const [seedInfo, setSeedInfo] = useState<SeedInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [showQR, setShowQR] = useState(false)

  // Export options
  const [includeMods, setIncludeMods] = useState(true)
  const [includeConfig, setIncludeConfig] = useState(true)
  const [includeResourcepacks, setIncludeResourcepacks] = useState(true)
  const [includeShaderpacks, setIncludeShaderpacks] = useState(true)
  const [selectedWorlds, setSelectedWorlds] = useState<string[]>([])

  // Fetch exportable content when dialog opens
  useEffect(() => {
    if (open && instanceId) {
      fetchExportableContent()
    }
    // Reset state when dialog closes
    if (!open) {
      setStep("select")
      setError(null)
      setProgress(null)
      setPreparedExport(null)
      setSeedInfo(null)
      setCopied(false)
      setShowQR(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instanceId])

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<SharingProgress>("sharing-progress", (event) => {
      setProgress(event.payload)
      setExportProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setExportProgress])

  const fetchExportableContent = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const content = await invoke<ExportableContent>("get_exportable_content", {
        instanceId,
      })
      setExportableContent(content)
      // Pre-select all worlds
      setSelectedWorlds(content.worlds.map((w) => w.folder_name))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleExport = async () => {
    setStep("preparing")
    setError(null)

    try {
      const options: ExportOptions = {
        include_mods: includeMods && (exportableContent?.mods.available ?? false),
        include_config: includeConfig && (exportableContent?.config.available ?? false),
        include_resourcepacks: includeResourcepacks && (exportableContent?.resourcepacks.available ?? false),
        include_shaderpacks: includeShaderpacks && (exportableContent?.shaderpacks.available ?? false),
        include_worlds: selectedWorlds,
      }

      // Prepare export (creates ZIP)
      const result = await invoke<PreparedExport>("prepare_export", {
        instanceId,
        options,
      })

      setPreparedExport(result)
      setCurrentExport(result)
      setStep("seeding")

      // Start seeding via WebTorrent
      const info = await webtorrentClient.seed(result.package_path, {
        name: `${instanceName}.kaizen`,
        onProgress: (p) => {
          console.log("[Seeding] Peers:", p.numPeers, "Uploaded:", formatBytes(p.uploaded))
        },
      })

      setSeedInfo(info)
      addSeed({
        exportId: result.export_id,
        instanceName,
        packagePath: result.package_path,
        magnetUri: info.magnetURI,
        peerCount: info.numPeers,
        uploadedBytes: info.uploaded,
        startedAt: Date.now(),
      })

      setStep("ready")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep("select")
    }
  }

  const handleCopyMagnet = useCallback(async () => {
    if (!seedInfo?.magnetURI) return
    try {
      await navigator.clipboard.writeText(seedInfo.magnetURI)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [seedInfo?.magnetURI])

  const handleClose = async () => {
    // If we're seeding, keep it running in background
    // User can stop it from the main UI later
    onOpenChange(false)
  }

  const handleStopAndClose = async () => {
    // Stop seeding and cleanup
    if (seedInfo) {
      webtorrentClient.stopSeed(seedInfo.infoHash)
    }
    if (preparedExport) {
      try {
        await invoke("cleanup_export", { exportId: preparedExport.export_id })
      } catch (err) {
        console.error("Cleanup error:", err)
      }
    }
    setCurrentExport(null)
    onOpenChange(false)
  }

  const toggleWorld = (folderName: string) => {
    setSelectedWorlds((prev) =>
      prev.includes(folderName)
        ? prev.filter((w) => w !== folderName)
        : [...prev, folderName]
    )
  }

  // Calculate total selected size
  const calculateSelectedSize = (): number => {
    if (!exportableContent) return 0
    let size = 0
    if (includeMods && exportableContent.mods.available) size += exportableContent.mods.total_size_bytes
    if (includeConfig && exportableContent.config.available) size += exportableContent.config.total_size_bytes
    if (includeResourcepacks && exportableContent.resourcepacks.available) size += exportableContent.resourcepacks.total_size_bytes
    if (includeShaderpacks && exportableContent.shaderpacks.available) size += exportableContent.shaderpacks.total_size_bytes
    for (const world of exportableContent.worlds) {
      if (selectedWorlds.includes(world.folder_name)) {
        size += world.size_bytes
      }
    }
    return size
  }

  const renderContent = () => {
    // Loading state
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">{t("sharing.analyzing")}</p>
        </div>
      )
    }

    // Error state
    if (error) {
      return (
        <div className="py-8 text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button variant="outline" onClick={fetchExportableContent}>
            {t("common.refresh")}
          </Button>
        </div>
      )
    }

    // Step: Select content
    if (step === "select" && exportableContent) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground mb-4">
            {t("sharing.selectContent")}
          </p>

          {/* Mods */}
          {exportableContent.mods.available && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="mods"
                  checked={includeMods}
                  onCheckedChange={(c) => setIncludeMods(c === true)}
                />
                <Package className="h-4 w-4 text-primary" />
                <div>
                  <Label htmlFor="mods" className="cursor-pointer">Mods</Label>
                  <p className="text-xs text-muted-foreground">
                    {exportableContent.mods.count} {t("sharing.files")} - {formatBytes(exportableContent.mods.total_size_bytes)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Config */}
          {exportableContent.config.available && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="config"
                  checked={includeConfig}
                  onCheckedChange={(c) => setIncludeConfig(c === true)}
                />
                <Settings2 className="h-4 w-4 text-primary" />
                <div>
                  <Label htmlFor="config" className="cursor-pointer">{t("sharing.config")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {exportableContent.config.count} {t("sharing.files")} - {formatBytes(exportableContent.config.total_size_bytes)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Resource Packs */}
          {exportableContent.resourcepacks.available && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="resourcepacks"
                  checked={includeResourcepacks}
                  onCheckedChange={(c) => setIncludeResourcepacks(c === true)}
                />
                <Image className="h-4 w-4 text-primary" />
                <div>
                  <Label htmlFor="resourcepacks" className="cursor-pointer">{t("sharing.resourcepacks")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {exportableContent.resourcepacks.count} {t("sharing.files")} - {formatBytes(exportableContent.resourcepacks.total_size_bytes)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Shader Packs */}
          {exportableContent.shaderpacks.available && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="shaderpacks"
                  checked={includeShaderpacks}
                  onCheckedChange={(c) => setIncludeShaderpacks(c === true)}
                />
                <Layers className="h-4 w-4 text-primary" />
                <div>
                  <Label htmlFor="shaderpacks" className="cursor-pointer">{t("sharing.shaderpacks")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {exportableContent.shaderpacks.count} {t("sharing.files")} - {formatBytes(exportableContent.shaderpacks.total_size_bytes)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Worlds */}
          {exportableContent.worlds.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 mb-3">
                <Map className="h-4 w-4 text-primary" />
                <span className="font-medium">{t("sharing.worlds")}</span>
              </div>
              <div className="space-y-2 pl-6">
                {exportableContent.worlds.map((world) => (
                  <div key={world.folder_name} className="flex items-center gap-3">
                    <Checkbox
                      id={`world-${world.folder_name}`}
                      checked={selectedWorlds.includes(world.folder_name)}
                      onCheckedChange={() => toggleWorld(world.folder_name)}
                    />
                    <div>
                      <Label htmlFor={`world-${world.folder_name}`} className="cursor-pointer">
                        {world.name}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(world.size_bytes)}
                        {world.is_server_world && ` - ${t("sharing.serverWorld")}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total size */}
          <div className="pt-2 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("sharing.totalSize")}</span>
              <span className="font-medium">{formatBytes(calculateSelectedSize())}</span>
            </div>
          </div>
        </div>
      )
    }

    // Step: Preparing
    if (step === "preparing") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <FolderArchive className="h-12 w-12 text-primary mb-4 animate-pulse" />
            <p className="font-medium">{progress?.stage || t("sharing.preparing")}</p>
            <p className="text-sm text-muted-foreground">{progress?.message || ""}</p>
          </div>
          <Progress value={progress?.progress || 0} className="h-2" />
        </div>
      )
    }

    // Step: Seeding (waiting for P2P)
    if (step === "seeding") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <Upload className="h-12 w-12 text-primary mb-4 animate-bounce" />
            <p className="font-medium">{t("sharing.startingP2P")}</p>
            <p className="text-sm text-muted-foreground">{t("sharing.connectingToPeers")}</p>
          </div>
          <Progress value={50} className="h-2 animate-pulse" />
        </div>
      )
    }

    // Step: Ready (seeding active)
    if (step === "ready" && seedInfo) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <Check className="h-5 w-5 text-green-500" />
            <span className="text-green-500 font-medium">{t("sharing.readyToShare")}</span>
          </div>

          {/* Magnet Link */}
          <div className="space-y-2">
            <Label>{t("sharing.magnetLink")}</Label>
            <div className="flex gap-2">
              <div className="flex-1 p-2 rounded-md bg-muted font-mono text-xs break-all max-h-20 overflow-y-auto">
                {seedInfo.magnetURI}
              </div>
              <Button size="icon" variant="outline" onClick={handleCopyMagnet}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="outline" onClick={() => setShowQR(!showQR)}>
                <QrCode className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* QR Code */}
          {showQR && (
            <div className="flex justify-center p-4 rounded-lg bg-white">
              <QRCodeSVG value={seedInfo.magnetURI} size={200} />
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-3 rounded-lg border text-center">
              <Users className="h-5 w-5 mx-auto text-primary mb-1" />
              <p className="text-2xl font-bold">{seedInfo.numPeers}</p>
              <p className="text-xs text-muted-foreground">{t("sharing.peers")}</p>
            </div>
            <div className="p-3 rounded-lg border text-center">
              <Upload className="h-5 w-5 mx-auto text-primary mb-1" />
              <p className="text-2xl font-bold">{formatBytes(seedInfo.uploaded)}</p>
              <p className="text-xs text-muted-foreground">{t("sharing.uploaded")}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {t("sharing.keepOpenToSeed")}
          </p>
        </div>
      )
    }

    return null
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("sharing.exportTitle")}
            <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30">
              Early Beta
            </span>
          </DialogTitle>
          <DialogDescription>
            {instanceName}
          </DialogDescription>
        </DialogHeader>

        {renderContent()}

        <DialogFooter>
          {step === "select" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleExport}
                disabled={calculateSelectedSize() === 0}
              >
                <Package className="h-4 w-4 mr-2" />
                {t("sharing.export")}
              </Button>
            </>
          )}

          {(step === "preparing" || step === "seeding") && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t("sharing.preparing")}
            </Button>
          )}

          {step === "ready" && (
            <>
              <Button variant="outline" onClick={handleStopAndClose}>
                <X className="h-4 w-4 mr-2" />
                {t("sharing.stopSharing")}
              </Button>
              <Button onClick={handleClose}>
                {t("sharing.keepSharing")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
