import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Save, Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useTranslation, type TranslationKey } from "@/i18n"

interface ServerPropertiesEditorProps {
  instanceId: string
  isRunning: boolean
}

// Common server properties with metadata - using translation keys
const PROPERTY_DEFINITIONS: Record<string, {
  labelKey: TranslationKey
  descKey: TranslationKey
  type: "string" | "number" | "boolean" | "select"
  options?: string[]
  category: "general" | "gameplay" | "network" | "world" | "advanced"
}> = {
  "server-port": {
    labelKey: "serverProperties.serverPort",
    descKey: "serverProperties.serverPortDesc",
    type: "number",
    category: "network"
  },
  "motd": {
    labelKey: "serverProperties.motd",
    descKey: "serverProperties.motdDesc",
    type: "string",
    category: "general"
  },
  "max-players": {
    labelKey: "serverProperties.maxPlayers",
    descKey: "serverProperties.maxPlayersDesc",
    type: "number",
    category: "general"
  },
  "online-mode": {
    labelKey: "serverProperties.onlineMode",
    descKey: "serverProperties.onlineModeDesc",
    type: "boolean",
    category: "network"
  },
  "white-list": {
    labelKey: "serverProperties.whitelist",
    descKey: "serverProperties.whitelistDesc",
    type: "boolean",
    category: "general"
  },
  "pvp": {
    labelKey: "serverProperties.pvp",
    descKey: "serverProperties.pvpDesc",
    type: "boolean",
    category: "gameplay"
  },
  "difficulty": {
    labelKey: "serverProperties.difficulty",
    descKey: "serverProperties.difficultyDesc",
    type: "select",
    options: ["peaceful", "easy", "normal", "hard"],
    category: "gameplay"
  },
  "gamemode": {
    labelKey: "serverProperties.gamemode",
    descKey: "serverProperties.gamemodeDesc",
    type: "select",
    options: ["survival", "creative", "adventure", "spectator"],
    category: "gameplay"
  },
  "level-name": {
    labelKey: "serverProperties.levelName",
    descKey: "serverProperties.levelNameDesc",
    type: "string",
    category: "world"
  },
  "level-seed": {
    labelKey: "serverProperties.levelSeed",
    descKey: "serverProperties.levelSeedDesc",
    type: "string",
    category: "world"
  },
  "level-type": {
    labelKey: "serverProperties.levelType",
    descKey: "serverProperties.levelTypeDesc",
    type: "select",
    options: ["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified"],
    category: "world"
  },
  "spawn-protection": {
    labelKey: "serverProperties.spawnProtection",
    descKey: "serverProperties.spawnProtectionDesc",
    type: "number",
    category: "world"
  },
  "view-distance": {
    labelKey: "serverProperties.viewDistance",
    descKey: "serverProperties.viewDistanceDesc",
    type: "number",
    category: "advanced"
  },
  "simulation-distance": {
    labelKey: "serverProperties.simulationDistance",
    descKey: "serverProperties.simulationDistanceDesc",
    type: "number",
    category: "advanced"
  },
  "allow-flight": {
    labelKey: "serverProperties.allowFlight",
    descKey: "serverProperties.allowFlightDesc",
    type: "boolean",
    category: "gameplay"
  },
  "spawn-monsters": {
    labelKey: "serverProperties.spawnMonsters",
    descKey: "serverProperties.spawnMonstersDesc",
    type: "boolean",
    category: "gameplay"
  },
  "spawn-animals": {
    labelKey: "serverProperties.spawnAnimals",
    descKey: "serverProperties.spawnAnimalsDesc",
    type: "boolean",
    category: "gameplay"
  },
  "spawn-npcs": {
    labelKey: "serverProperties.spawnNpcs",
    descKey: "serverProperties.spawnNpcsDesc",
    type: "boolean",
    category: "gameplay"
  },
  "enable-command-block": {
    labelKey: "serverProperties.enableCommandBlock",
    descKey: "serverProperties.enableCommandBlockDesc",
    type: "boolean",
    category: "advanced"
  },
  "server-ip": {
    labelKey: "serverProperties.serverIp",
    descKey: "serverProperties.serverIpDesc",
    type: "string",
    category: "network"
  },
  "query.port": {
    labelKey: "serverProperties.queryPort",
    descKey: "serverProperties.queryPortDesc",
    type: "number",
    category: "network"
  },
  "enable-query": {
    labelKey: "serverProperties.enableQuery",
    descKey: "serverProperties.enableQueryDesc",
    type: "boolean",
    category: "network"
  },
  "enable-rcon": {
    labelKey: "serverProperties.enableRcon",
    descKey: "serverProperties.enableRconDesc",
    type: "boolean",
    category: "network"
  },
  "rcon.port": {
    labelKey: "serverProperties.rconPort",
    descKey: "serverProperties.rconPortDesc",
    type: "number",
    category: "network"
  },
  "rcon.password": {
    labelKey: "serverProperties.rconPassword",
    descKey: "serverProperties.rconPasswordDesc",
    type: "string",
    category: "network"
  }
}

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  general: "serverProperties.general",
  gameplay: "serverProperties.gameplay",
  network: "serverProperties.network",
  world: "serverProperties.world",
  advanced: "serverProperties.advanced"
}

export function ServerPropertiesEditor({ instanceId, isRunning }: ServerPropertiesEditorProps) {
  const { t } = useTranslation()
  const [properties, setProperties] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const loadProperties = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const props = await invoke<Record<string, string>>("get_server_properties", { instanceId })
      setProperties(props)
      setHasChanges(false)
    } catch (err) {
      console.error("Failed to load server properties:", err)
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadProperties()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  const handleChange = (key: string, value: string) => {
    setProperties(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await invoke("save_server_properties", { instanceId, properties })
      setHasChanges(false)
      toast.success(t("serverProperties.saved"))
    } catch (err) {
      console.error("Failed to save server properties:", err)
      setError(String(err))
      toast.error(t("errors.saveError"))
    } finally {
      setIsSaving(false)
    }
  }

  const renderProperty = (key: string) => {
    const def = PROPERTY_DEFINITIONS[key]
    const value = properties[key] ?? ""

    if (!def) {
      // Unknown property - render as text input
      return (
        <div key={key} className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm font-mono">{key}</Label>
          <Input
            value={value}
            onChange={(e) => handleChange(key, e.target.value)}
            className="col-span-2"
          />
        </div>
      )
    }

    return (
      <div key={key} className="grid grid-cols-3 gap-4 items-start">
        <div>
          <Label className="text-sm font-medium">{t(def.labelKey)}</Label>
          <p className="text-xs text-muted-foreground mt-1">{t(def.descKey)}</p>
        </div>
        <div className="col-span-2">
          {def.type === "boolean" ? (
            <Switch
              checked={value === "true"}
              onCheckedChange={(checked) => handleChange(key, checked ? "true" : "false")}
            />
          ) : def.type === "select" ? (
            <Select value={value} onValueChange={(v) => handleChange(key, v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("serverProperties.select")} />
              </SelectTrigger>
              <SelectContent>
                {def.options?.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : def.type === "number" ? (
            <Input
              type="number"
              value={value}
              onChange={(e) => handleChange(key, e.target.value)}
            />
          ) : (
            <Input
              value={value}
              onChange={(e) => handleChange(key, e.target.value)}
            />
          )}
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Group properties by category
  const knownProperties: Record<string, string[]> = {
    general: [],
    gameplay: [],
    network: [],
    world: [],
    advanced: []
  }
  const unknownProperties: string[] = []

  for (const key of Object.keys(properties)) {
    const def = PROPERTY_DEFINITIONS[key]
    if (def) {
      knownProperties[def.category].push(key)
    } else {
      unknownProperties.push(key)
    }
  }

  return (
    <div className="space-y-6">
      {isRunning && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-amber-500">
            {t("serverProperties.serverRunningWarning")}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={isSaving || !hasChanges} className="gap-2">
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("serverProperties.saveBtn")}
        </Button>
        <Button variant="outline" onClick={loadProperties} disabled={isLoading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          {t("serverProperties.reload")}
        </Button>
        {hasChanges && (
          <span className="text-sm text-amber-500">{t("serverProperties.unsavedChanges")}</span>
        )}
      </div>

      {/* Render properties by category */}
      {Object.entries(CATEGORY_KEYS).map(([category, labelKey]) => {
        const props = knownProperties[category]
        if (props.length === 0) return null

        return (
          <div key={category}>
            <h3 className="text-lg font-semibold mb-4">{t(labelKey)}</h3>
            <div className="space-y-4">
              {props.map(renderProperty)}
            </div>
            <Separator className="mt-6" />
          </div>
        )
      })}

      {/* Unknown properties */}
      {unknownProperties.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">{t("serverProperties.otherProperties")}</h3>
          <div className="space-y-4">
            {unknownProperties.map(renderProperty)}
          </div>
        </div>
      )}
    </div>
  )
}
