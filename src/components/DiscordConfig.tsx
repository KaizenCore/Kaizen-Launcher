import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  Loader2,
  Check,
  AlertCircle,
  Wifi,
  Bell,
  Eye,
  MessageSquare,
  Play,
  Square,
  UserPlus,
  UserMinus,
  Archive,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useTranslation } from "@/i18n"

interface DiscordConfig {
  // Rich Presence
  rpc_enabled: boolean
  rpc_show_instance_name: boolean
  rpc_show_version: boolean
  rpc_show_playtime: boolean
  rpc_show_modloader: boolean
  // Webhooks
  webhook_enabled: boolean
  webhook_url: string | null
  webhook_server_start: boolean
  webhook_server_stop: boolean
  webhook_backup_created: boolean
  webhook_player_join: boolean
  webhook_player_leave: boolean
}

const defaultConfig: DiscordConfig = {
  rpc_enabled: false,
  rpc_show_instance_name: true,
  rpc_show_version: true,
  rpc_show_playtime: true,
  rpc_show_modloader: true,
  webhook_enabled: false,
  webhook_url: null,
  webhook_server_start: true,
  webhook_server_stop: true,
  webhook_backup_created: false,
  webhook_player_join: true,
  webhook_player_leave: true,
}

export function DiscordConfig() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DiscordConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingRpc, setTestingRpc] = useState(false)
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [rpcStatus, setRpcStatus] = useState<"idle" | "success" | "error">("idle")
  const [webhookStatus, setWebhookStatus] = useState<"idle" | "success" | "error">("idle")

  // Auto-save debounce
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      const result = await invoke<DiscordConfig>("get_discord_config")
      setConfig(result)
    } catch (error) {
      console.error("Failed to load Discord config:", error)
      toast.error("Failed to load Discord config")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const saveConfig = useCallback(
    async (newConfig: DiscordConfig) => {
      try {
        setSaving(true)
        await invoke("save_discord_config", { config: newConfig })
      } catch (error) {
        console.error("Failed to save Discord config:", error)
        toast.error("Failed to save Discord config")
      } finally {
        setSaving(false)
      }
    },
    []
  )

  const updateConfig = useCallback(
    (updates: Partial<DiscordConfig>) => {
      setConfig((prevConfig) => {
        const newConfig = { ...prevConfig, ...updates }

        // Debounced auto-save
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(() => {
          saveConfig(newConfig)
        }, 500)

        return newConfig
      })
    },
    [saveConfig]
  )

  const testRpc = async () => {
    try {
      setTestingRpc(true)
      setRpcStatus("idle")
      await invoke<string>("test_discord_rpc")
      setRpcStatus("success")
      toast.success(t("discord.rpcTestSuccess"))
    } catch (error) {
      setRpcStatus("error")
      toast.error(t("discord.rpcTestFailed"))
    } finally {
      setTestingRpc(false)
    }
  }

  const testWebhook = async () => {
    if (!config.webhook_url) {
      toast.error(t("discord.webhookUrlRequired"))
      return
    }
    try {
      setTestingWebhook(true)
      setWebhookStatus("idle")
      await invoke<string>("test_discord_webhook", { webhookUrl: config.webhook_url })
      setWebhookStatus("success")
      toast.success(t("discord.webhookTestSuccess"))
    } catch (error) {
      setWebhookStatus("error")
      toast.error(t("discord.webhookTestFailed"))
    } finally {
      setTestingWebhook(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Rich Presence Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10">
                <Eye className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <CardTitle className="text-lg">{t("discord.richPresence")}</CardTitle>
                <CardDescription>{t("discord.richPresenceDesc")}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {rpcStatus === "success" && (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  <Check className="h-3 w-3 mr-1" />
                  {t("discord.connected")}
                </Badge>
              )}
              {rpcStatus === "error" && (
                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {t("discord.disconnected")}
                </Badge>
              )}
              <Switch
                checked={config.rpc_enabled}
                onCheckedChange={(checked) => updateConfig({ rpc_enabled: checked })}
              />
            </div>
          </div>
        </CardHeader>
        {config.rpc_enabled && (
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("discord.showInstanceName")}</Label>
                  <p className="text-xs text-muted-foreground">{t("discord.showInstanceNameDesc")}</p>
                </div>
                <Switch
                  checked={config.rpc_show_instance_name}
                  onCheckedChange={(checked) => updateConfig({ rpc_show_instance_name: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("discord.showVersion")}</Label>
                  <p className="text-xs text-muted-foreground">{t("discord.showVersionDesc")}</p>
                </div>
                <Switch
                  checked={config.rpc_show_version}
                  onCheckedChange={(checked) => updateConfig({ rpc_show_version: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("discord.showPlaytime")}</Label>
                  <p className="text-xs text-muted-foreground">{t("discord.showPlaytimeDesc")}</p>
                </div>
                <Switch
                  checked={config.rpc_show_playtime}
                  onCheckedChange={(checked) => updateConfig({ rpc_show_playtime: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("discord.showModloader")}</Label>
                  <p className="text-xs text-muted-foreground">{t("discord.showModloaderDesc")}</p>
                </div>
                <Switch
                  checked={config.rpc_show_modloader}
                  onCheckedChange={(checked) => updateConfig({ rpc_show_modloader: checked })}
                />
              </div>
            </div>

            <Separator />

            <Button
              variant="outline"
              onClick={testRpc}
              disabled={testingRpc}
              className="w-full"
            >
              {testingRpc ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : rpcStatus === "success" ? (
                <Check className="h-4 w-4 mr-2 text-green-500" />
              ) : rpcStatus === "error" ? (
                <AlertCircle className="h-4 w-4 mr-2 text-red-500" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              {t("discord.testConnection")}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Webhooks Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <MessageSquare className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <CardTitle className="text-lg">{t("discord.webhooks")}</CardTitle>
                <CardDescription>{t("discord.webhooksDesc")}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {webhookStatus === "success" && (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  <Check className="h-3 w-3 mr-1" />
                  {t("discord.configured")}
                </Badge>
              )}
              {webhookStatus === "error" && (
                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {t("discord.invalid")}
                </Badge>
              )}
              <Switch
                checked={config.webhook_enabled}
                onCheckedChange={(checked) => updateConfig({ webhook_enabled: checked })}
              />
            </div>
          </div>
        </CardHeader>
        {config.webhook_enabled && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">{t("discord.webhookUrl")}</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={config.webhook_url || ""}
                onChange={(e) => updateConfig({ webhook_url: e.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">{t("discord.webhookUrlDesc")}</p>
            </div>

            <Separator />

            <div className="space-y-1">
              <Label className="text-sm font-medium">{t("discord.events")}</Label>
              <p className="text-xs text-muted-foreground mb-3">{t("discord.eventsDesc")}</p>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Play className="h-4 w-4 text-green-500" />
                  <div>
                    <Label className="text-sm">{t("discord.serverStarted")}</Label>
                    <p className="text-xs text-muted-foreground">{t("discord.serverStartedDesc")}</p>
                  </div>
                </div>
                <Switch
                  checked={config.webhook_server_start}
                  onCheckedChange={(checked) => updateConfig({ webhook_server_start: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Square className="h-4 w-4 text-red-500" />
                  <div>
                    <Label className="text-sm">{t("discord.serverStopped")}</Label>
                    <p className="text-xs text-muted-foreground">{t("discord.serverStoppedDesc")}</p>
                  </div>
                </div>
                <Switch
                  checked={config.webhook_server_stop}
                  onCheckedChange={(checked) => updateConfig({ webhook_server_stop: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <UserPlus className="h-4 w-4 text-green-500" />
                  <div>
                    <Label className="text-sm">{t("discord.playerJoined")}</Label>
                    <p className="text-xs text-muted-foreground">{t("discord.playerJoinedDesc")}</p>
                  </div>
                </div>
                <Switch
                  checked={config.webhook_player_join}
                  onCheckedChange={(checked) => updateConfig({ webhook_player_join: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <UserMinus className="h-4 w-4 text-orange-500" />
                  <div>
                    <Label className="text-sm">{t("discord.playerLeft")}</Label>
                    <p className="text-xs text-muted-foreground">{t("discord.playerLeftDesc")}</p>
                  </div>
                </div>
                <Switch
                  checked={config.webhook_player_leave}
                  onCheckedChange={(checked) => updateConfig({ webhook_player_leave: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Archive className="h-4 w-4 text-blue-500" />
                  <div>
                    <Label className="text-sm">{t("discord.backupCreated")}</Label>
                    <p className="text-xs text-muted-foreground">{t("discord.backupCreatedDesc")}</p>
                  </div>
                </div>
                <Switch
                  checked={config.webhook_backup_created}
                  onCheckedChange={(checked) => updateConfig({ webhook_backup_created: checked })}
                />
              </div>
            </div>

            <Separator />

            <Button
              variant="outline"
              onClick={testWebhook}
              disabled={testingWebhook || !config.webhook_url}
              className="w-full"
            >
              {testingWebhook ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : webhookStatus === "success" ? (
                <Check className="h-4 w-4 mr-2 text-green-500" />
              ) : webhookStatus === "error" ? (
                <AlertCircle className="h-4 w-4 mr-2 text-red-500" />
              ) : (
                <Bell className="h-4 w-4 mr-2" />
              )}
              {t("discord.testWebhook")}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Saving indicator */}
      {saving && (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          {t("discord.saving")}
        </div>
      )}
    </div>
  )
}
