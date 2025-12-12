import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { AlertTriangle, Copy, Check, Share2 } from "lucide-react"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

interface ActiveShare {
  share_id: string
  instance_name: string
  public_url: string | null
}

interface DeleteInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instanceName: string
  onConfirm: (deleteShares?: boolean) => void
}

export function DeleteInstanceDialog({
  open,
  onOpenChange,
  instanceName,
  onConfirm,
}: DeleteInstanceDialogProps) {
  const { t } = useTranslation()
  const [confirmText, setConfirmText] = useState("")
  const [copied, setCopied] = useState(false)
  const [activeShares, setActiveShares] = useState<ActiveShare[]>([])
  const [deleteShares, setDeleteShares] = useState(true)
  const confirmPhrase = instanceName

  // Check for active shares when dialog opens
  useEffect(() => {
    if (open) {
      const checkShares = async () => {
        try {
          const shares = await invoke<ActiveShare[]>("get_active_shares")
          const instanceShares = shares.filter(s => s.instance_name === instanceName)
          setActiveShares(instanceShares)
        } catch (err) {
          console.error("Failed to check shares:", err)
          setActiveShares([])
        }
      }
      checkShares()
    }
  }, [open, instanceName])

  useEffect(() => {
    if (!open) {
      setConfirmText("")
      setCopied(false)
      setActiveShares([])
      setDeleteShares(true)
    }
  }, [open])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(confirmPhrase)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isConfirmValid = confirmText === confirmPhrase

  const handleConfirm = () => {
    if (isConfirmValid) {
      onConfirm(activeShares.length > 0 ? deleteShares : undefined)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("dialogs.deleteInstance.title")}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t("dialogs.deleteInstance.warning")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
            <li>{t("dialogs.deleteInstance.worldSaves")}</li>
            <li>{t("dialogs.deleteInstance.configurations")}</li>
            <li>{t("dialogs.deleteInstance.installedMods")}</li>
            <li>{t("dialogs.deleteInstance.screenshots")}</li>
          </ul>

          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive font-medium">
              {t("dialogs.deleteInstance.typeToConfirm")}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-sm font-mono bg-background/50 px-2 py-1 rounded flex-1 select-all">
                {confirmPhrase}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-input">{t("dialogs.deleteInstance.confirmation")}</Label>
            <Input
              id="confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t("dialogs.deleteInstance.typeInstanceName")}
              className={confirmText && !isConfirmValid ? "border-destructive" : ""}
            />
            {confirmText && !isConfirmValid && (
              <p className="text-xs text-destructive">
                {t("dialogs.deleteInstance.noMatch")}
              </p>
            )}
          </div>

          {/* Active shares warning */}
          {activeShares.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-500">
                <Share2 className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {t("dialogs.deleteInstance.activeShares", { count: activeShares.length })}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="delete-shares"
                  checked={deleteShares}
                  onCheckedChange={(checked) => setDeleteShares(checked as boolean)}
                />
                <Label htmlFor="delete-shares" className="text-sm text-muted-foreground cursor-pointer">
                  {t("dialogs.deleteInstance.alsoDeleteShares")}
                </Label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isConfirmValid}
          >
            {t("dialogs.deleteInstance.deletePermanently")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
