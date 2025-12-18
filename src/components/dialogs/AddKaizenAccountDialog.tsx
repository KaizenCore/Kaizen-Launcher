import { useState, useRef, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Loader2, ExternalLink, Copy, Check, Star } from "lucide-react"
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

interface AddKaizenAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface KaizenDeviceCodeInfo {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type AuthStatus = "idle" | "device_code" | "waiting" | "success" | "error"

export function AddKaizenAccountDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddKaizenAccountDialogProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AuthStatus>("idle")
  const [deviceCode, setDeviceCode] = useState<KaizenDeviceCodeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const timeoutRefs = useRef<NodeJS.Timeout[]>([])

  // Cleanup timeouts on unmount
  useEffect(() => {
    const currentRefs = timeoutRefs.current
    return () => {
      currentRefs.forEach(clearTimeout)
    }
  }, [])

  const startLogin = async () => {
    console.log("[AddKaizenAccount] Starting Kaizen login...")
    setStatus("device_code")
    setError(null)
    setCopied(false)

    try {
      // Step 1: Get device code
      const codeInfo = await invoke<KaizenDeviceCodeInfo>("login_kaizen_start")
      console.log(`[AddKaizenAccount] Device code received: ${codeInfo.user_code}`)
      setDeviceCode(codeInfo)

      // Open browser automatically
      openUrl(codeInfo.verification_uri)

      // Step 2: Start polling in background
      console.log("[AddKaizenAccount] Waiting for user to complete authentication...")
      setStatus("waiting")

      await invoke("login_kaizen_complete", {
        deviceCode: codeInfo.device_code,
        interval: codeInfo.interval,
        expiresIn: codeInfo.expires_in,
      })

      console.log("[AddKaizenAccount] Kaizen login successful!")
      setStatus("success")
      const timeout = setTimeout(() => {
        onOpenChange(false)
        onSuccess?.()
        resetState()
      }, 1500)
      timeoutRefs.current.push(timeout)
    } catch (err) {
      console.error("[AddKaizenAccount] Kaizen login failed:", err)
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
    setDeviceCode(null)
    setError(null)
    setStatus("idle")
    setCopied(false)
  }

  const handleClose = () => {
    onOpenChange(false)
    // Only reset if not in the middle of auth
    if (status !== "waiting") {
      resetState()
    }
  }

  // Auto-start login when dialog opens
  useEffect(() => {
    if (open && status === "idle") {
      startLogin()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" />
            {t("accounts.loginKaizen")}
          </DialogTitle>
          <DialogDescription>
            {t("accounts.loginKaizenDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="py-6">
          {status === "device_code" && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {t("kaizen.preparingLogin")}
              </p>
            </div>
          )}

          {(status === "waiting" || status === "device_code") && deviceCode && (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("kaizen.enterCodeOnSite")}
              </p>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 relative">
                <p className="text-3xl font-mono font-bold tracking-widest select-all text-primary">
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
                  {t("kaizen.openKaizenLink")}
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
                {t("kaizen.success")}
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="text-center space-y-4">
              <div className="rounded-lg bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
              <Button variant="outline" onClick={startLogin}>
                {t("kaizen.retry")}
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
