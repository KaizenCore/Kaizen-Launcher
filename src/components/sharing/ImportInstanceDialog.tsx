import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import {
  Download,
  Loader2,
  ClipboardPaste,
  FileArchive,
  Package,
  Settings2,
  Image,
  Layers,
  Map,
  Check,
  AlertCircle,
  FolderOpen,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useSharingStore, type SharingManifest, type SharingProgress } from "@/stores/sharingStore"
import { webtorrentClient, type TorrentProgress } from "@/lib/webtorrent"

interface ImportInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type ImportStep = "input" | "downloading" | "preview" | "importing" | "complete"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + "/s"
}

export function ImportInstanceDialog({
  open,
  onOpenChange,
  onSuccess,
}: ImportInstanceDialogProps) {
  const { t } = useTranslation()
  const { setImportProgress, setCurrentImport } = useSharingStore()

  // State
  const [step, setStep] = useState<ImportStep>("input")
  const [error, setError] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<"magnet" | "file">("magnet")

  // Input state
  const [magnetUri, setMagnetUri] = useState("")
  const [localFilePath, setLocalFilePath] = useState("")

  // Download state
  const [downloadProgress, setDownloadProgress] = useState<TorrentProgress | null>(null)
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null)

  // Preview state
  const [manifest, setManifest] = useState<SharingManifest | null>(null)
  const [newName, setNewName] = useState("")

  // Import progress
  const [importProgress, setImportProgressLocal] = useState<SharingProgress | null>(null)

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("input")
      setError(null)
      setMagnetUri("")
      setLocalFilePath("")
      setDownloadProgress(null)
      setDownloadedFilePath(null)
      setManifest(null)
      setNewName("")
      setImportProgressLocal(null)
    }
  }, [open])

  // Listen for import progress events
  useEffect(() => {
    const unlisten = listen<SharingProgress>("sharing-progress", (event) => {
      setImportProgressLocal(event.payload)
      setImportProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setImportProgress])

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.startsWith("magnet:")) {
        setMagnetUri(text)
      } else {
        setError(t("sharing.invalidMagnetLink"))
      }
    } catch (err) {
      console.error("Failed to read clipboard:", err)
      setError(t("sharing.clipboardError"))
    }
  }

  const handleSelectFile = async () => {
    try {
      const selected = await openDialog({
        filters: [{ name: "Kaizen Package", extensions: ["kaizen", "zip"] }],
        multiple: false,
      })
      if (selected) {
        setLocalFilePath(selected as string)
        setError(null)
      }
    } catch (err) {
      console.error("Failed to select file:", err)
    }
  }

  const handleStartDownload = async () => {
    if (!magnetUri.startsWith("magnet:")) {
      setError(t("sharing.invalidMagnetLink"))
      return
    }

    setStep("downloading")
    setError(null)

    try {
      // Get temp directory from backend
      const tempDir = await invoke<string>("get_sharing_temp_dir")

      // Start WebTorrent download
      await webtorrentClient.download(magnetUri, tempDir, {
        onProgress: (progress) => {
          setDownloadProgress(progress)
        },
        onComplete: async (filePath) => {
          setDownloadedFilePath(filePath)
          // Validate and preview
          await handlePreviewPackage(filePath)
        },
        onError: (err) => {
          setError(err.message)
          setStep("input")
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep("input")
    }
  }

  const handlePreviewFile = async () => {
    if (!localFilePath) {
      setError(t("sharing.selectFileFirst"))
      return
    }

    setStep("downloading") // Reuse loading state
    await handlePreviewPackage(localFilePath)
  }

  const handlePreviewPackage = async (filePath: string) => {
    try {
      const result = await invoke<SharingManifest>("validate_import_package", {
        packagePath: filePath,
      })

      setManifest(result)
      setCurrentImport(result)
      setNewName(result.instance.name)
      setDownloadedFilePath(filePath)
      setStep("preview")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep("input")
    }
  }

  const handleImport = async () => {
    if (!downloadedFilePath) return

    setStep("importing")
    setError(null)

    try {
      await invoke("import_instance", {
        packagePath: downloadedFilePath,
        newName: newName !== manifest?.instance.name ? newName : null,
      })

      setStep("complete")
      setCurrentImport(null)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep("preview")
    }
  }

  const renderContent = () => {
    // Step: Input (magnet or file)
    if (step === "input") {
      return (
        <div className="space-y-4">
          <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "magnet" | "file")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="magnet" className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                {t("sharing.fromP2P")}
              </TabsTrigger>
              <TabsTrigger value="file" className="flex items-center gap-2">
                <FileArchive className="h-4 w-4" />
                {t("sharing.fromFile")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="magnet" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{t("sharing.magnetLink")}</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="magnet:?xt=urn:btih:..."
                    value={magnetUri}
                    onChange={(e) => setMagnetUri(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="icon" onClick={handlePasteFromClipboard}>
                    <ClipboardPaste className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("sharing.magnetLinkHelp")}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="file" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{t("sharing.packageFile")}</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("sharing.selectFile")}
                    value={localFilePath}
                    readOnly
                    className="text-sm"
                  />
                  <Button variant="outline" onClick={handleSelectFile}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {t("sharing.browse")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("sharing.fileHelp")}
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      )
    }

    // Step: Downloading
    if (step === "downloading") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <Download className="h-12 w-12 text-primary mb-4 animate-bounce" />
            <p className="font-medium">
              {downloadProgress ? t("sharing.downloading") : t("sharing.connecting")}
            </p>
            {downloadProgress && (
              <p className="text-sm text-muted-foreground">
                {Math.round(downloadProgress.progress * 100)}% - {formatSpeed(downloadProgress.downloadSpeed)}
              </p>
            )}
          </div>
          <Progress value={(downloadProgress?.progress || 0) * 100} className="h-2" />
          {downloadProgress && (
            <div className="grid grid-cols-3 gap-4 text-center text-sm text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">{downloadProgress.numPeers}</p>
                <p>{t("sharing.peers")}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">{formatBytes(downloadProgress.downloaded)}</p>
                <p>{t("sharing.downloaded")}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {downloadProgress.timeRemaining
                    ? `${Math.round(downloadProgress.timeRemaining / 1000)}s`
                    : "..."}
                </p>
                <p>{t("sharing.remaining")}</p>
              </div>
            </div>
          )}
        </div>
      )
    }

    // Step: Preview
    if (step === "preview" && manifest) {
      return (
        <div className="space-y-4">
          {/* Instance info */}
          <div className="p-4 rounded-lg border bg-muted/30">
            <h4 className="font-medium mb-2">{manifest.instance.name}</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
              <div>Minecraft {manifest.instance.mc_version}</div>
              <div>{manifest.instance.loader || "Vanilla"}</div>
              {manifest.instance.is_server && <div>{t("sharing.server")}</div>}
            </div>
          </div>

          {/* Contents */}
          <div className="space-y-2">
            <Label>{t("sharing.contents")}</Label>
            <div className="grid gap-2">
              {manifest.contents.mods.included && (
                <div className="flex items-center gap-2 p-2 rounded border text-sm">
                  <Package className="h-4 w-4 text-primary" />
                  <span>Mods ({manifest.contents.mods.count})</span>
                </div>
              )}
              {manifest.contents.config.included && (
                <div className="flex items-center gap-2 p-2 rounded border text-sm">
                  <Settings2 className="h-4 w-4 text-primary" />
                  <span>{t("sharing.config")} ({manifest.contents.config.count})</span>
                </div>
              )}
              {manifest.contents.resourcepacks.included && (
                <div className="flex items-center gap-2 p-2 rounded border text-sm">
                  <Image className="h-4 w-4 text-primary" />
                  <span>{t("sharing.resourcepacks")} ({manifest.contents.resourcepacks.count})</span>
                </div>
              )}
              {manifest.contents.shaderpacks.included && (
                <div className="flex items-center gap-2 p-2 rounded border text-sm">
                  <Layers className="h-4 w-4 text-primary" />
                  <span>{t("sharing.shaderpacks")} ({manifest.contents.shaderpacks.count})</span>
                </div>
              )}
              {manifest.contents.saves.included && manifest.contents.saves.worlds.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded border text-sm">
                  <Map className="h-4 w-4 text-primary" />
                  <span>{t("sharing.worlds")} ({manifest.contents.saves.worlds.length})</span>
                </div>
              )}
            </div>
          </div>

          {/* Total size */}
          <div className="flex justify-between text-sm pt-2 border-t">
            <span className="text-muted-foreground">{t("sharing.totalSize")}</span>
            <span className="font-medium">{formatBytes(manifest.total_size_bytes)}</span>
          </div>

          {/* Instance name */}
          <div className="space-y-2">
            <Label>{t("sharing.instanceName")}</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={manifest.instance.name}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      )
    }

    // Step: Importing
    if (step === "importing") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <FileArchive className="h-12 w-12 text-primary mb-4 animate-pulse" />
            <p className="font-medium">{importProgress?.stage || t("sharing.importing")}</p>
            <p className="text-sm text-muted-foreground">{importProgress?.message || ""}</p>
          </div>
          <Progress value={importProgress?.progress || 0} className="h-2" />
        </div>
      )
    }

    // Step: Complete
    if (step === "complete") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-500" />
            </div>
            <p className="font-medium text-green-500">{t("sharing.importSuccess")}</p>
            <p className="text-sm text-muted-foreground">
              {t("sharing.instanceReady", { name: newName || manifest?.instance.name || "" })}
            </p>
          </div>
        </div>
      )
    }

    return null
  }

  const canProceed = () => {
    if (inputMode === "magnet") {
      return magnetUri.startsWith("magnet:")
    }
    return !!localFilePath
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t("sharing.importTitle")}
            <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30">
              Early Beta
            </span>
          </DialogTitle>
          <DialogDescription>
            {t("sharing.importDescription")}
          </DialogDescription>
        </DialogHeader>

        {renderContent()}

        <DialogFooter>
          {step === "input" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={inputMode === "magnet" ? handleStartDownload : handlePreviewFile}
                disabled={!canProceed()}
              >
                {inputMode === "magnet" ? (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {t("sharing.startDownload")}
                  </>
                ) : (
                  <>
                    <FileArchive className="h-4 w-4 mr-2" />
                    {t("sharing.preview")}
                  </>
                )}
              </Button>
            </>
          )}

          {step === "downloading" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
          )}

          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("input")}>
                {t("common.back")}
              </Button>
              <Button onClick={handleImport} disabled={!newName.trim()}>
                <Download className="h-4 w-4 mr-2" />
                {t("sharing.import")}
              </Button>
            </>
          )}

          {step === "importing" && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t("sharing.importing")}
            </Button>
          )}

          {step === "complete" && (
            <Button onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
