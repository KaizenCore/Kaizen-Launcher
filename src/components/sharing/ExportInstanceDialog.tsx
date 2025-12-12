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
  Upload,
  QrCode,
  X,
  Link,
  Download,
  Shield,
  Zap,
  Lock,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { useSharingStore, type ExportableContent, type ExportOptions, type PreparedExport, type SharingProgress } from "@/stores/sharingStore"

type SharingProvider = "bore" | "cloudflare"

interface ActiveShare {
  share_id: string
  instance_name: string
  package_path: string
  local_port: number
  public_url: string | null
  download_count: number
  uploaded_bytes: number
  started_at: string
  file_size: number
  provider: SharingProvider
}

interface ShareStatusEvent {
  share_id: string
  status: string
  public_url: string | null
  error: string | null
}

interface ShareDownloadEvent {
  share_id: string
  download_count: number
  uploaded_bytes: number
}

interface ExportInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instanceId: string
  instanceName: string
}

type ExportStep = "select" | "installing" | "preparing" | "tunneling" | "ready"

interface AgentInfo {
  provider: string
  version: string | null
  path: string
  installed: boolean
}

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
  const [activeShare, setActiveShare] = useState<ActiveShare | null>(null)
  const [copied, setCopied] = useState(false)
  const [showQR, setShowQR] = useState(false)

  // Export options
  const [includeMods, setIncludeMods] = useState(true)
  const [includeConfig, setIncludeConfig] = useState(true)
  const [includeResourcepacks, setIncludeResourcepacks] = useState(true)
  const [includeShaderpacks, setIncludeShaderpacks] = useState(true)
  const [selectedWorlds, setSelectedWorlds] = useState<string[]>([])
  const [provider, setProvider] = useState<SharingProvider>("cloudflare")
  const [cloudflareInstalled, setCloudflareInstalled] = useState<boolean | null>(null)
  const [isInstallingCloudflare, setIsInstallingCloudflare] = useState(false)

  // Password protection
  const [enablePassword, setEnablePassword] = useState(false)
  const [password, setPassword] = useState("")

  // Check if cloudflared is installed
  const checkCloudflareInstalled = useCallback(async () => {
    try {
      const result = await invoke<AgentInfo | null>("check_tunnel_agent", { provider: "cloudflare" })
      setCloudflareInstalled(result !== null)
    } catch (err) {
      console.error("Failed to check cloudflare agent:", err)
      setCloudflareInstalled(false)
    }
  }, [])

  // Install cloudflared
  const handleInstallCloudflare = async () => {
    setIsInstallingCloudflare(true)
    setError(null)
    try {
      await invoke<AgentInfo>("install_tunnel_agent", { provider: "cloudflare" })
      setCloudflareInstalled(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsInstallingCloudflare(false)
    }
  }

  // Fetch exportable content when dialog opens
  useEffect(() => {
    if (open && instanceId) {
      fetchExportableContent()
      checkCloudflareInstalled()
    }
    // Reset state when dialog closes
    if (!open) {
      setStep("select")
      setError(null)
      setProgress(null)
      setPreparedExport(null)
      setActiveShare(null)
      setCopied(false)
      setShowQR(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instanceId])

  // Listen for progress events
  useEffect(() => {
    const unlistenProgress = listen<SharingProgress>("sharing-progress", (event) => {
      setProgress(event.payload)
      setExportProgress(event.payload)
    })

    const unlistenStatus = listen<ShareStatusEvent>("share-status", (event) => {
      if (activeShare && event.payload.share_id === activeShare.share_id) {
        if (event.payload.status === "connected" && event.payload.public_url) {
          setActiveShare((prev) => prev ? { ...prev, public_url: event.payload.public_url } : null)
        } else if (event.payload.status === "error" && event.payload.error) {
          setError(event.payload.error)
        }
      }
    })

    const unlistenDownload = listen<ShareDownloadEvent>("share-download", (event) => {
      if (activeShare && event.payload.share_id === activeShare.share_id) {
        setActiveShare((prev) => prev ? {
          ...prev,
          download_count: event.payload.download_count,
          uploaded_bytes: event.payload.uploaded_bytes,
        } : null)
      }
    })

    return () => {
      unlistenProgress.then((fn) => fn())
      unlistenStatus.then((fn) => fn())
      unlistenDownload.then((fn) => fn())
    }
  }, [setExportProgress, activeShare])

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
      setStep("tunneling")

      // Start sharing via HTTP tunnel (Bore or Cloudflare)
      const share = await invoke<ActiveShare>("start_share", {
        packagePath: result.package_path,
        instanceName,
        provider,
        password: enablePassword && password ? password : null,
      })

      setActiveShare(share)

      // Add to store for sidebar badge
      addSeed({
        exportId: result.export_id,
        instanceName,
        packagePath: result.package_path,
        magnetUri: share.public_url || "", // Use public_url instead of magnet
        peerCount: 0,
        uploadedBytes: 0,
        startedAt: Date.now(),
      })

      setStep("ready")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep("select")
    }
  }

  const handleCopyLink = useCallback(async () => {
    if (!activeShare?.public_url) return
    try {
      await navigator.clipboard.writeText(activeShare.public_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [activeShare?.public_url])

  const handleClose = async () => {
    // If we're sharing, keep it running in background
    // User can stop it from the Sharing page later
    onOpenChange(false)
  }

  const handleStopAndClose = async () => {
    // Stop sharing and cleanup
    if (activeShare) {
      try {
        await invoke("stop_share", { shareId: activeShare.share_id })
      } catch (err) {
        console.error("Stop share error:", err)
      }
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

          {/* Provider selection */}
          <div className="pt-4 border-t">
            <Label className="text-sm font-medium mb-3 block">{t("sharing.provider")}</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setProvider("cloudflare")}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  provider === "cloudflare"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">Cloudflare</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  HTTPS • {t("sharing.providerSecure")}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setProvider("bore")}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  provider === "bore"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-4 w-4 text-orange-500" />
                  <span className="font-medium">Bore</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  HTTP • {t("sharing.providerFast")}
                </p>
              </button>
            </div>

            {/* Cloudflare installation prompt */}
            {provider === "cloudflare" && cloudflareInstalled === false && (
              <div className="mt-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-500">
                    {t("sharing.cloudflareNotInstalled")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {t("sharing.cloudflareInstallDescription")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleInstallCloudflare}
                  disabled={isInstallingCloudflare}
                  className="w-full"
                >
                  {isInstallingCloudflare ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t("sharing.installingCloudflare")}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      {t("sharing.installCloudflare")}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Password protection */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                <Label htmlFor="enable-password" className="text-sm font-medium cursor-pointer">
                  {t("sharing.passwordProtection")}
                </Label>
              </div>
              <Checkbox
                id="enable-password"
                checked={enablePassword}
                onCheckedChange={(c) => setEnablePassword(c === true)}
              />
            </div>
            {enablePassword && (
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder={t("sharing.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground">
                  {t("sharing.passwordDescription")}
                </p>
              </div>
            )}
          </div>

          {/* Security warning */}
          <div className="mt-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/10">
            <div className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs space-y-1">
                <p className="font-medium text-blue-500">{t("sharing.securityTitle")}</p>
                <ul className="text-muted-foreground space-y-0.5 list-disc list-inside">
                  <li>{t("sharing.securityToken")}</li>
                  <li>{t("sharing.securityPrivate")}</li>
                  <li>{t("sharing.securityExpires")}</li>
                </ul>
              </div>
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

    // Step: Creating tunnel
    if (step === "tunneling") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <Link className="h-12 w-12 text-primary mb-4 animate-bounce" />
            <p className="font-medium">{t("sharing.creatingTunnel")}</p>
            <p className="text-sm text-muted-foreground">{t("sharing.waitingForUrl")}</p>
          </div>
          <Progress value={75} className="h-2 animate-pulse" />
        </div>
      )
    }

    // Step: Ready (sharing active)
    if (step === "ready" && activeShare) {
      const shareUrl = activeShare.public_url

      return (
        <div className="space-y-4">
          {shareUrl ? (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <Check className="h-5 w-5 text-green-500" />
                <span className="text-green-500 font-medium">{t("sharing.readyToShare")}</span>
              </div>

              {/* Share Link */}
              <div className="space-y-2">
                <Label>{t("sharing.shareLink")}</Label>
                <div className="flex gap-2">
                  <div className="flex-1 p-2 rounded-md bg-muted font-mono text-sm break-all">
                    {shareUrl}
                  </div>
                  <Button size="icon" variant="outline" onClick={handleCopyLink}>
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
                  <QRCodeSVG value={shareUrl} size={200} />
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="p-3 rounded-lg border text-center">
                  <Download className="h-5 w-5 mx-auto text-primary mb-1" />
                  <p className="text-2xl font-bold">{activeShare.download_count}</p>
                  <p className="text-xs text-muted-foreground">{t("sharing.downloads")}</p>
                </div>
                <div className="p-3 rounded-lg border text-center">
                  <Upload className="h-5 w-5 mx-auto text-primary mb-1" />
                  <p className="text-2xl font-bold">{formatBytes(activeShare.uploaded_bytes)}</p>
                  <p className="text-xs text-muted-foreground">{t("sharing.uploaded")}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                {t("sharing.keepOpenToShare")}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">{t("sharing.waitingForUrl")}</p>
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[450px] sm:w-[500px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("sharing.exportTitle")}
          </SheetTitle>
          <SheetDescription>
            {instanceName}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {renderContent()}
        </div>

        <SheetFooter className="flex-shrink-0 border-t pt-4">
          {step === "select" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleExport}
                disabled={
                  calculateSelectedSize() === 0 ||
                  (provider === "cloudflare" && cloudflareInstalled === false) ||
                  isInstallingCloudflare
                }
              >
                <Package className="h-4 w-4 mr-2" />
                {t("sharing.export")}
              </Button>
            </>
          )}

          {(step === "preparing" || step === "tunneling") && (
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
