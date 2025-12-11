import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import {
  Globe,
  Loader2,
  Download,
  Play,
  Square,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Cloud,
  Gamepad2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "@/i18n"

interface TunnelConfig {
  id: string
  instance_id: string
  provider: "playit" | "cloudflare" | "ngrok" | "bore"
  enabled: boolean
  auto_start: boolean
  playit_secret_key: string | null
  ngrok_authtoken: string | null
  target_port: number
  tunnel_url: string | null
}

interface AgentInfo {
  provider: "playit" | "cloudflare" | "ngrok" | "bore"
  version: string | null
  path: string
  installed: boolean
}

interface TunnelStatus {
  type: "disconnected" | "connecting" | "connected" | "waiting_for_claim" | "error"
  url?: string
  claim_url?: string
  message?: string
}

interface TunnelConfigProps {
  instanceId: string
  serverPort: number
  isServerRunning: boolean
}

export function TunnelConfig({ instanceId, serverPort, isServerRunning }: TunnelConfigProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<TunnelConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>({ type: "disconnected" })
  const [isTunnelRunning, setIsTunnelRunning] = useState(false)

  // Agent installation states
  const [cloudflareAgent, setCloudflareAgent] = useState<AgentInfo | null>(null)
  const [playitAgent, setPlayitAgent] = useState<AgentInfo | null>(null)
  const [ngrokAgent, setNgrokAgent] = useState<AgentInfo | null>(null)
  const [boreAgent, setBoreAgent] = useState<AgentInfo | null>(null)
  const [isInstallingAgent, setIsInstallingAgent] = useState<string | null>(null)

  // Copied state for URL
  const [copied, setCopied] = useState(false)

  // Form state
  const [provider, setProvider] = useState<"playit" | "cloudflare" | "ngrok" | "bore">("bore")
  const [enabled, setEnabled] = useState(false)
  const [autoStart, setAutoStart] = useState(true)
  const [targetPort, setTargetPort] = useState(serverPort)
  const [ngrokAuthtoken, setNgrokAuthtoken] = useState("")

  // Load config and agent status
  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      // Load tunnel config
      const tunnelConfig = await invoke<TunnelConfig | null>("get_tunnel_config", { instanceId })
      if (tunnelConfig) {
        setConfig(tunnelConfig)
        setProvider(tunnelConfig.provider)
        setEnabled(tunnelConfig.enabled)
        setAutoStart(tunnelConfig.auto_start)
        setTargetPort(tunnelConfig.target_port)
        setNgrokAuthtoken(tunnelConfig.ngrok_authtoken || "")
      } else {
        setTargetPort(serverPort)
      }

      // Check agent installations
      const [cfAgent, playAgent, ngAgent, bAgent] = await Promise.all([
        invoke<AgentInfo | null>("check_tunnel_agent", { provider: "cloudflare" }),
        invoke<AgentInfo | null>("check_tunnel_agent", { provider: "playit" }),
        invoke<AgentInfo | null>("check_tunnel_agent", { provider: "ngrok" }),
        invoke<AgentInfo | null>("check_tunnel_agent", { provider: "bore" }),
      ])
      setCloudflareAgent(cfAgent)
      setPlayitAgent(playAgent)
      setNgrokAgent(ngAgent)
      setBoreAgent(bAgent)

      // Check if tunnel is running
      const running = await invoke<boolean>("is_tunnel_running", { instanceId })
      setIsTunnelRunning(running)

      if (running) {
        const status = await invoke<TunnelStatus>("get_tunnel_status", { instanceId })
        setTunnelStatus(status)
      } else if (tunnelConfig?.tunnel_url) {
        // Show last known URL even if tunnel is not running
        setTunnelStatus({ type: "disconnected", url: tunnelConfig.tunnel_url })
      }
    } catch (err) {
      console.error("Failed to load tunnel config:", err)
    } finally {
      setIsLoading(false)
    }
  }, [instanceId, serverPort])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Listen for tunnel status events
  useEffect(() => {
    const unlisten = listen<{ instance_id: string; provider: string; status: TunnelStatus }>(
      "tunnel-status",
      async (event) => {
        if (event.payload.instance_id === instanceId) {
          setTunnelStatus(event.payload.status)
          if (event.payload.status.type === "disconnected") {
            setIsTunnelRunning(false)
          } else if (event.payload.status.type === "connected") {
            setIsTunnelRunning(true)
            // Save the tunnel URL to config for persistence
            if (event.payload.status.url) {
              try {
                await invoke("save_tunnel_url", {
                  instanceId,
                  url: event.payload.status.url
                })
              } catch (err) {
                console.error("Failed to save tunnel URL:", err)
              }
            }
          }
        }
      }
    )

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [instanceId])

  const handleInstallAgent = async (agentProvider: "cloudflare" | "playit" | "ngrok" | "bore") => {
    setIsInstallingAgent(agentProvider)
    const toastId = `install-${agentProvider}`
    toast.loading(t("tunnel.installingAgent").replace("{provider}", agentProvider), { id: toastId })

    try {
      const agent = await invoke<AgentInfo>("install_tunnel_agent", { provider: agentProvider })
      if (agentProvider === "cloudflare") {
        setCloudflareAgent(agent)
      } else if (agentProvider === "playit") {
        setPlayitAgent(agent)
      } else if (agentProvider === "ngrok") {
        setNgrokAgent(agent)
      } else {
        setBoreAgent(agent)
      }
      toast.success(t("tunnel.agentInstalled").replace("{provider}", agentProvider), { id: toastId })
    } catch (err) {
      console.error(`Failed to install ${agentProvider} agent:`, err)
      toast.error(`${t("tunnel.installError")}: ${err}`, { id: toastId })
    } finally {
      setIsInstallingAgent(null)
    }
  }

  // Use ref to store config id and other stable values for save
  const configRef = useRef(config)
  configRef.current = config

  const saveConfig = useCallback(async (showToast = true) => {
    setIsSaving(true)
    try {
      const currentConfig = configRef.current
      const newConfig: TunnelConfig = {
        id: currentConfig?.id || crypto.randomUUID(),
        instance_id: instanceId,
        provider,
        enabled,
        auto_start: autoStart,
        playit_secret_key: currentConfig?.playit_secret_key || null,
        ngrok_authtoken: ngrokAuthtoken || null,
        target_port: targetPort,
        tunnel_url: currentConfig?.tunnel_url || null,
      }

      await invoke("save_tunnel_config", { config: newConfig })
      setConfig(newConfig)
      if (showToast) {
        toast.success(t("tunnel.configSaved"))
      }
    } catch (err) {
      console.error("Failed to save tunnel config:", err)
      toast.error(`${t("tunnel.saveError")}: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }, [instanceId, provider, enabled, autoStart, ngrokAuthtoken, targetPort, t])

  // Auto-save when settings change (with debounce)
  const isInitialLoadDone = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Mark initial load as done after loading completes
  useEffect(() => {
    if (!isLoading && !isInitialLoadDone.current) {
      // Wait a tick to ensure state is settled
      setTimeout(() => {
        isInitialLoadDone.current = true
      }, 100)
    }
  }, [isLoading])

  useEffect(() => {
    // Skip auto-save before initial load is complete
    if (!isInitialLoadDone.current) return

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveConfig(false) // Save without toast
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [provider, enabled, autoStart, targetPort, ngrokAuthtoken, saveConfig])

  const handleStartTunnel = async () => {
    // Save config first if needed
    if (!config || config.provider !== provider || config.target_port !== targetPort) {
      await saveConfig()
    }

    toast.loading(t("tunnel.tunnelStarting"), { id: "tunnel-start" })
    try {
      await invoke("start_tunnel", { instanceId })
      setIsTunnelRunning(true)
      toast.success(t("tunnel.tunnelStarted"), { id: "tunnel-start" })
    } catch (err) {
      console.error("Failed to start tunnel:", err)
      toast.error(`${t("tunnel.error")} ${err}`, { id: "tunnel-start" })
    }
  }

  const handleStopTunnel = async () => {
    toast.loading(t("tunnel.tunnelStopping"), { id: "tunnel-stop" })
    try {
      await invoke("stop_tunnel", { instanceId })
      setIsTunnelRunning(false)
      setTunnelStatus({ type: "disconnected" })
      toast.success(t("tunnel.tunnelStopped"), { id: "tunnel-stop" })
    } catch (err) {
      console.error("Failed to stop tunnel:", err)
      toast.error(`${t("tunnel.error")} ${err}`, { id: "tunnel-stop" })
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(true)
        toast.success(t("tunnel.addressCopied"))
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => toast.error(t("tunnel.unableToCopy")))
  }

  const isCurrentAgentInstalled =
    provider === "cloudflare"
      ? cloudflareAgent?.installed
      : provider === "ngrok"
        ? ngrokAgent?.installed
        : provider === "bore"
          ? boreAgent?.installed
          : playitAgent?.installed

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {tunnelStatus.type === "connected" && tunnelStatus.url && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <Globe className="h-4 w-4 text-green-500" />
          <AlertDescription className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-green-500 font-medium">{t("tunnel.connected")}</span>
              <code className="bg-green-500/20 px-2 py-0.5 rounded text-green-400">
                {tunnelStatus.url}
              </code>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(tunnelStatus.url!)}
              className="h-7 px-2"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {tunnelStatus.type === "disconnected" && tunnelStatus.url && (
        <Alert className="border-muted-foreground/30 bg-muted/30">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <AlertDescription className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">{t("tunnel.lastKnownUrl")}</span>
              <code className="bg-muted px-2 py-0.5 rounded text-muted-foreground">
                {tunnelStatus.url}
              </code>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(tunnelStatus.url!)}
              className="h-7 px-2"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {tunnelStatus.type === "waiting_for_claim" && tunnelStatus.claim_url && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="text-amber-500">
                {t("tunnel.waitingClaim")}
              </p>
              <a
                href={tunnelStatus.claim_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-amber-400 hover:underline"
              >
                {tunnelStatus.claim_url}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {tunnelStatus.type === "connecting" && (
        <Alert className="border-blue-500/50 bg-blue-500/10">
          <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
          <AlertDescription className="text-blue-500">
            {t("tunnel.connecting")}
          </AlertDescription>
        </Alert>
      )}

      {tunnelStatus.type === "error" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{tunnelStatus.message}</AlertDescription>
        </Alert>
      )}

      {/* Provider selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("tunnel.title")}
          </CardTitle>
          <CardDescription>
            {t("tunnel.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Provider */}
          <div className="space-y-2">
            <Label>{t("tunnel.provider")}</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as "cloudflare" | "playit" | "ngrok" | "bore")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bore">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    <span>bore.pub</span>
                    <Badge variant="secondary" className="ml-2">{t("tunnel.recommended")}</Badge>
                  </div>
                </SelectItem>
                <SelectItem value="ngrok">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    <span>ngrok</span>
                    <Badge variant="outline" className="ml-2 text-amber-500 border-amber-500/50">{t("tunnel.cardRequired")}</Badge>
                  </div>
                </SelectItem>
                <SelectItem value="cloudflare">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    <span>Cloudflare Tunnels</span>
                    <Badge variant="outline" className="ml-2 text-amber-500 border-amber-500/50">{t("tunnel.httpOnly")}</Badge>
                  </div>
                </SelectItem>
                <SelectItem value="playit">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="h-4 w-4" />
                    <span>playit.gg</span>
                    {navigator.platform.toLowerCase().includes("mac") && (
                      <Badge variant="outline" className="ml-2 text-amber-500 border-amber-500/50">{t("tunnel.notAvailableMac")}</Badge>
                    )}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {provider === "bore"
                ? t("tunnel.boreDescription")
                : provider === "ngrok"
                  ? t("tunnel.ngrokDescription")
                  : provider === "cloudflare"
                    ? t("tunnel.cloudflareDescription")
                    : t("tunnel.playitDescription")}
            </p>
          </div>

          {/* Agent status */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <span className="text-sm">{t("tunnel.agent")} {provider}:</span>
              {isCurrentAgentInstalled ? (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                  {t("tunnel.installed")}
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                  {t("tunnel.notInstalled")}
                </Badge>
              )}
            </div>
            {!isCurrentAgentInstalled && (
              <Button
                size="sm"
                onClick={() => handleInstallAgent(provider)}
                disabled={isInstallingAgent !== null}
                className="gap-1"
              >
                {isInstallingAgent === provider ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t("tunnel.install")}
              </Button>
            )}
          </div>

          {/* ngrok authtoken */}
          {provider === "ngrok" && (
            <div className="space-y-2">
              <Label>{t("tunnel.ngrokAuthtoken")}</Label>
              <Input
                type="password"
                value={ngrokAuthtoken}
                onChange={(e) => setNgrokAuthtoken(e.target.value)}
                placeholder={t("tunnel.yourNgrokAuthtoken")}
              />
              <p className="text-xs text-muted-foreground">
                {t("tunnel.getAuthtoken")}{" "}
                <a
                  href="https://dashboard.ngrok.com/get-started/your-authtoken"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  dashboard.ngrok.com
                </a>
                {" "}{t("tunnel.freeAccountRequired")}
              </p>
            </div>
          )}

          {/* Port */}
          <div className="space-y-2">
            <Label>{t("tunnel.targetPort")}</Label>
            <Input
              type="number"
              value={targetPort}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10)
                setTargetPort(isNaN(parsed) ? 25565 : parsed)
              }}
              placeholder="25565"
            />
            <p className="text-xs text-muted-foreground">
              {t("tunnel.defaultPort").replace("{port}", String(serverPort))}
            </p>
          </div>

          {/* Switches */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>{t("tunnel.enableTunnel")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("tunnel.enableDescription")}
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>{t("tunnel.autoStart")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("tunnel.autoStartDescription")}
                </p>
              </div>
              <Switch checked={autoStart} onCheckedChange={setAutoStart} disabled={!enabled} />
            </div>
          </div>

          {/* Actions */}
          {enabled && isCurrentAgentInstalled && (
            <div className="flex items-center gap-2 pt-4">
              {isTunnelRunning ? (
                <Button variant="destructive" onClick={handleStopTunnel} className="gap-2">
                  <Square className="h-4 w-4" />
                  {t("tunnel.stopTunnel")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleStartTunnel}
                  disabled={!isServerRunning}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  {t("tunnel.startTunnel")}
                </Button>
              )}
              {isSaving && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("common.saving")}
                </span>
              )}
            </div>
          )}

          {enabled && !isServerRunning && !isTunnelRunning && (
            <p className="text-xs text-muted-foreground">
              {t("tunnel.serverMustRun")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <strong>bore.pub:</strong> {t("tunnel.boreInfo")}
        </p>
        <p>
          <strong>ngrok:</strong> {t("tunnel.ngrokInfo")}
        </p>
        <p>
          <strong>Cloudflare:</strong> {t("tunnel.cloudflareInfo")}
        </p>
        <p>
          <strong>playit.gg:</strong> {t("tunnel.playitInfo")}
        </p>
      </div>
    </div>
  )
}
