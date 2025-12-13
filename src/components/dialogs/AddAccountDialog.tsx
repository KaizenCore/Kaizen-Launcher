import { useState, useRef, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Loader2, ExternalLink, Copy, Check, User } from "lucide-react"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface AddAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface DeviceCodeInfo {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type AuthStatus = "idle" | "device_code" | "waiting" | "success" | "error"
type AuthMode = "select" | "microsoft" | "offline"

export function AddAccountDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddAccountDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthMode>("select")
  const [status, setStatus] = useState<AuthStatus>("idle")
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [offlineUsername, setOfflineUsername] = useState("")
  const timeoutRefs = useRef<NodeJS.Timeout[]>([])

  // Cleanup timeouts on unmount
  useEffect(() => {
    const currentRefs = timeoutRefs.current
    return () => {
      currentRefs.forEach(clearTimeout)
    }
  }, [])

  const startLogin = async () => {
    console.log("[AddAccount] Starting Microsoft login...")
    setStatus("device_code")
    setError(null)
    setCopied(false)

    try {
      // Step 1: Get device code
      const codeInfo = await invoke<DeviceCodeInfo>("login_microsoft_start")
      console.log(`[AddAccount] Device code received: ${codeInfo.user_code}`)
      setDeviceCode(codeInfo)

      // Open browser automatically
      openUrl(codeInfo.verification_uri)

      // Step 2: Start polling in background
      console.log("[AddAccount] Waiting for user to complete authentication...")
      setStatus("waiting")

      await invoke("login_microsoft_complete", {
        deviceCode: codeInfo.device_code,
        interval: codeInfo.interval,
        expiresIn: codeInfo.expires_in,
      })

      console.log("[AddAccount] Microsoft login successful!")
      setStatus("success")
      const timeout = setTimeout(() => {
        onOpenChange(false)
        onSuccess?.()
        resetState()
      }, 1500)
      timeoutRefs.current.push(timeout)
    } catch (err) {
      console.error("[AddAccount] Microsoft login failed:", err)
      setError(err instanceof Error ? err.message : String(err))
      setStatus("error")
    }
  }

  const createOfflineAccount = async () => {
    if (!offlineUsername.trim()) {
      setError(t("dialogs.addAccount.enterUsername"))
      return
    }

    console.log(`[AddAccount] Creating offline account: ${offlineUsername.trim()}`)
    setStatus("waiting")
    setError(null)

    try {
      await invoke("create_offline_account", { username: offlineUsername.trim() })
      console.log(`[AddAccount] Offline account created: ${offlineUsername.trim()}`)
      setStatus("success")
      const timeout = setTimeout(() => {
        onOpenChange(false)
        onSuccess?.()
        resetState()
      }, 1500)
      timeoutRefs.current.push(timeout)
    } catch (err) {
      console.error("[AddAccount] Failed to create offline account:", err)
      setError(err instanceof Error ? err.message : String(err))
      setStatus("error")
    }
  }

  const copyCode = async () => {
    if (deviceCode) {
      try {
        await navigator.clipboard.writeText(deviceCode.user_code)
        setCopied(true)
        const timeout = setTimeout(() => setCopied(false), 2000)
        timeoutRefs.current.push(timeout)
      } catch {
        // Clipboard API not available or permission denied
      }
    }
  }

  const resetState = () => {
    setMode("select")
    setDeviceCode(null)
    setError(null)
    setStatus("idle")
    setCopied(false)
    setOfflineUsername("")
  }

  const handleClose = () => {
    onOpenChange(false)
    // Only reset if not in the middle of auth
    if (status !== "waiting") {
      resetState()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("dialogs.addAccount.title")}</DialogTitle>
          <DialogDescription>
            {t("dialogs.addAccount.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="py-6">
          {mode === "select" && status === "idle" && (
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start gap-3 h-16"
                onClick={() => setMode("microsoft")}
              >
                <div className="bg-blue-500 p-2 rounded">
                  <ExternalLink className="h-4 w-4 text-white" />
                </div>
                <div className="text-left">
                  <div className="font-medium">{t("accounts.microsoft")}</div>
                  <div className="text-xs text-muted-foreground">{t("dialogs.addAccount.officialLogin")}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-3 h-16"
                onClick={() => setMode("offline")}
              >
                <div className="bg-gray-500 p-2 rounded">
                  <User className="h-4 w-4 text-white" />
                </div>
                <div className="text-left">
                  <div className="font-medium">{t("accounts.offline")}</div>
                  <div className="text-xs text-muted-foreground">{t("dialogs.addAccount.forDevTest")}</div>
                </div>
              </Button>
            </div>
          )}

          {mode === "offline" && status === "idle" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t("accounts.offlineUsername")}</Label>
                <Input
                  id="username"
                  placeholder="Steve"
                  value={offlineUsername}
                  onChange={(e) => setOfflineUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createOfflineAccount()}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("dialogs.addAccount.offlineDescription")}
              </p>
            </div>
          )}

          {mode === "microsoft" && status === "idle" && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                {t("dialogs.addAccount.microsoftInstructions")}
              </p>
            </div>
          )}

          {status === "device_code" && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t("dialogs.addAccount.preparingLogin")}
              </p>
            </div>
          )}

          {(status === "waiting" || status === "device_code") && deviceCode && (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("dialogs.addAccount.enterCodeOnSite")}
              </p>
              <div className="bg-muted rounded-lg p-4 relative">
                <p className="text-3xl font-mono font-bold tracking-widest select-all">
                  {deviceCode.user_code}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-2"
                  onClick={copyCode}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => openUrl(deviceCode.verification_uri)}
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("dialogs.addAccount.openMicrosoftLink")}
                </Button>
              </div>
              {status === "waiting" && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("accounts.waitingAuth")}
                </div>
              )}
            </div>
          )}

          {status === "success" && (
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <div className="rounded-full bg-green-500/20 p-3">
                  <Check className="h-8 w-8 text-green-500" />
                </div>
              </div>
              <p className="text-sm font-medium text-green-500">
                {t("dialogs.addAccount.success")}
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="text-center space-y-4">
              <div className="rounded-lg bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
              <Button variant="outline" onClick={() => setStatus("idle")}>
                {t("dialogs.addAccount.retry")}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          {status !== "success" && (
            <Button variant="outline" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
          )}
          {mode !== "select" && status === "idle" && (
            <Button variant="ghost" onClick={() => setMode("select")}>
              {t("common.back")}
            </Button>
          )}
          {mode === "microsoft" && status === "idle" && (
            <Button onClick={startLogin}>
              {t("dialogs.addAccount.signIn")}
            </Button>
          )}
          {mode === "offline" && status === "idle" && (
            <Button onClick={createOfflineAccount}>
              {t("dialogs.addAccount.createAccount")}
            </Button>
          )}
          {status === "success" && (
            <Button onClick={handleClose}>
              {t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
