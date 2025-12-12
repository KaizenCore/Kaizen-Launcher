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
  Link2,
  Lock,
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

interface ImportInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type ImportStep = "input" | "fetching" | "preview" | "downloading" | "importing" | "complete"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
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
  const [inputMode, setInputMode] = useState<"url" | "file">("url")

  // Input state
  const [shareUrl, setShareUrl] = useState("")
  const [localFilePath, setLocalFilePath] = useState("")
  const [password, setPassword] = useState("")
  const [needsPassword, setNeedsPassword] = useState(false)

  // Preview state
  const [manifest, setManifest] = useState<SharingManifest | null>(null)
  const [newName, setNewName] = useState("")
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null)

  // Import progress
  const [importProgress, setImportProgressLocal] = useState<SharingProgress | null>(null)

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("input")
      setError(null)
      setShareUrl("")
      setLocalFilePath("")
      setPassword("")
      setNeedsPassword(false)
      setManifest(null)
      setNewName("")
      setDownloadedFilePath(null)
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
      if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
        setShareUrl(text)
        setError(null)
      } else {
        setError(t("sharing.invalidShareLink"))
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

  const handleFetchManifest = async () => {
    if (!shareUrl.startsWith("http://") && !shareUrl.startsWith("https://")) {
      setError(t("sharing.invalidShareLink"))
      return
    }

    setStep("fetching")
    setError(null)

    try {
      // Fetch manifest from the share URL
      const manifest = await invoke<SharingManifest>("fetch_share_manifest", {
        shareUrl: shareUrl,
        password: needsPassword && password ? password : null,
      })

      setManifest(manifest)
      setCurrentImport(manifest)
      setNewName(manifest.instance.name)
      // Keep needsPassword true so we pass the password to the import step
      setStep("preview")
    } catch (err) {
      console.error("Failed to fetch manifest:", err)
      const errorMsg = err instanceof Error ? err.message : String(err)

      // Check if password is required
      if (errorMsg.includes("PASSWORD_REQUIRED")) {
        setNeedsPassword(true)
        setError(null)
        setStep("input")
      } else if (errorMsg.includes("INVALID_PASSWORD")) {
        // Password was provided but is incorrect
        setError(t("sharing.invalidPassword"))
        setStep("input")
      } else {
        setError(errorMsg)
        setStep("input")
      }
    }
  }

  const handlePreviewFile = async () => {
    if (!localFilePath) {
      setError(t("sharing.selectFileFirst"))
      return
    }

    setStep("fetching")
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
    setStep("downloading")
    setError(null)

    try {
      if (inputMode === "url") {
        // Download and import from URL
        // Build the download URL (the share URL + /download)
        const downloadUrl = shareUrl.endsWith("/")
          ? `${shareUrl}download`
          : `${shareUrl}/download`

        await invoke("download_and_import_share", {
          shareUrl: downloadUrl,
          newName: newName !== manifest?.instance.name ? newName : null,
          password: needsPassword && password ? password : null,
        })
      } else {
        // Import from local file
        setStep("importing")
        await invoke("import_instance", {
          packagePath: downloadedFilePath,
          newName: newName !== manifest?.instance.name ? newName : null,
        })
      }

      setStep("complete")
      setCurrentImport(null)
      onSuccess?.()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      // Handle password errors during download
      if (errorMsg.includes("PASSWORD_REQUIRED")) {
        setNeedsPassword(true)
        setError(t("sharing.passwordRequiredForDownload"))
        setStep("input")
      } else if (errorMsg.includes("INVALID_PASSWORD")) {
        setError(t("sharing.invalidPassword"))
        setStep("input")
      } else {
        setError(errorMsg)
        setStep("preview")
      }
    }
  }

  const renderContent = () => {
    // Step: Input (URL or file)
    if (step === "input") {
      return (
        <div className="space-y-4">
          <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "url" | "file")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url" className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                {t("sharing.fromUrl")}
              </TabsTrigger>
              <TabsTrigger value="file" className="flex items-center gap-2">
                <FileArchive className="h-4 w-4" />
                {t("sharing.fromFile")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{t("sharing.shareLink")}</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://..."
                    value={shareUrl}
                    onChange={(e) => setShareUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="icon" onClick={handlePasteFromClipboard}>
                    <ClipboardPaste className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("sharing.shareLinkHelp")}
                </p>
              </div>

              {/* Password input when required */}
              {needsPassword && (
                <div className="space-y-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                  <div className="flex items-center gap-2 text-amber-500 mb-2">
                    <Lock className="h-4 w-4" />
                    <span className="text-sm font-medium">{t("sharing.passwordRequired")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("sharing.passwordPrompt")}
                  </p>
                  <Input
                    type="password"
                    placeholder={t("sharing.enterPassword")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-9"
                  />
                </div>
              )}
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

    // Step: Fetching manifest
    if (step === "fetching") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <Loader2 className="h-12 w-12 text-primary mb-4 animate-spin" />
            <p className="font-medium">{t("sharing.fetchingManifest")}</p>
          </div>
        </div>
      )
    }

    // Step: Downloading
    if (step === "downloading") {
      return (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center">
            <Download className="h-12 w-12 text-primary mb-4 animate-bounce" />
            <p className="font-medium">{t("sharing.downloading")}</p>
            <p className="text-sm text-muted-foreground">
              {manifest ? formatBytes(manifest.total_size_bytes) : ""}
            </p>
          </div>
          <Progress value={50} className="h-2 animate-pulse" />
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
    if (inputMode === "url") {
      const hasValidUrl = shareUrl.startsWith("http://") || shareUrl.startsWith("https://")
      // If password is required, also require password to be filled
      if (needsPassword) {
        return hasValidUrl && password.trim().length > 0
      }
      return hasValidUrl
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
                onClick={inputMode === "url" ? handleFetchManifest : handlePreviewFile}
                disabled={!canProceed()}
              >
                {inputMode === "url" ? (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {t("sharing.fetchPreview")}
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

          {(step === "fetching" || step === "downloading") && (
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
