import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Loader2, RefreshCw, Server, Monitor } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface CreateInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface VersionInfo {
  id: string
  version_type: string
  url: string
  release_time: string
}

interface MinecraftVersionList {
  latest_release: string
  latest_snapshot: string
  versions: VersionInfo[]
}

// LoaderInfo interface for future use with loader API
// interface LoaderInfo {
//   loader_type: string
//   name: string
//   description: string
//   is_server: boolean
//   is_proxy: boolean
// }

interface LoaderVersion {
  version: string
  stable: boolean
  minecraft_version: string | null
  download_url: string | null
}

const CLIENT_LOADERS = [
  { value: "vanilla", label: "Vanilla", descriptionKey: "createInstance.loaders.vanilla" as const, disabled: false },
  { value: "fabric", label: "Fabric", descriptionKey: "createInstance.loaders.fabric" as const, disabled: false },
  { value: "quilt", label: "Quilt", descriptionKey: "createInstance.loaders.quilt" as const, disabled: false },
  { value: "forge", label: "Forge", descriptionKey: "createInstance.loaders.forge" as const, disabled: false },
  { value: "neoforge", label: "NeoForge", descriptionKey: "createInstance.loaders.neoforge" as const, disabled: false },
]

const SERVER_LOADERS = [
  // Vanilla
  { value: "vanilla", label: "Vanilla", descriptionKey: "createInstance.loaders.vanillaServer" as const, disabled: false },
  // Plugin servers
  { value: "paper", label: "Paper", descriptionKey: "createInstance.loaders.paper" as const, disabled: false },
  { value: "purpur", label: "Purpur", descriptionKey: "createInstance.loaders.purpur" as const, disabled: false },
  { value: "folia", label: "Folia", descriptionKey: "createInstance.loaders.folia" as const, disabled: false },
  { value: "pufferfish", label: "Pufferfish", descriptionKey: "createInstance.loaders.pufferfish" as const, disabled: false },
  { value: "spigot", label: "Spigot", descriptionKey: "createInstance.loaders.spigot" as const, disabled: true },
  // Mod servers
  { value: "fabric", label: "Fabric", descriptionKey: "createInstance.loaders.fabricServer" as const, disabled: false },
  { value: "forge", label: "Forge", descriptionKey: "createInstance.loaders.forgeServer" as const, disabled: false },
  { value: "neoforge", label: "NeoForge", descriptionKey: "createInstance.loaders.neoforgeServer" as const, disabled: false },
  // Sponge
  { value: "spongevanilla", label: "SpongeVanilla", descriptionKey: "createInstance.loaders.spongevanilla" as const, disabled: false },
  { value: "spongeforge", label: "SpongeForge", descriptionKey: "createInstance.loaders.spongeforge" as const, disabled: false },
]

const PROXY_LOADERS = [
  { value: "velocity", label: "Velocity", descriptionKey: "createInstance.loaders.velocity" as const, disabled: false },
  { value: "bungeecord", label: "BungeeCord", descriptionKey: "createInstance.loaders.bungeecord" as const, disabled: false },
  { value: "waterfall", label: "Waterfall", descriptionKey: "createInstance.loaders.waterfall" as const, disabled: false },
]

export function CreateInstanceDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateInstanceDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [mcVersion, setMcVersion] = useState("")
  const [loader, setLoader] = useState("vanilla")
  const [loaderVersion, setLoaderVersion] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [latestRelease, setLatestRelease] = useState("")
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)

  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false)

  const [mode, setMode] = useState<"client" | "server" | "proxy">("client")
  const [serverPort, setServerPort] = useState(25565)
  const [usedPorts, setUsedPorts] = useState<{ port: number; instance_name: string }[]>([])

  // Get current loaders based on mode
  const currentLoaders = mode === "client"
    ? CLIENT_LOADERS
    : mode === "server"
      ? SERVER_LOADERS
      : PROXY_LOADERS

  // Fetch versions and used ports when dialog opens
  useEffect(() => {
    if (open) {
      fetchVersions()
      fetchUsedPorts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showSnapshots])

  // Fetch loader versions when loader or MC version changes
  useEffect(() => {
    if (open && loader !== "vanilla") {
      fetchLoaderVersions()
    } else {
      setLoaderVersions([])
      setLoaderVersion("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loader, mcVersion])

  // Reset loader when mode changes, set default port
  useEffect(() => {
    setLoader("vanilla")
    setLoaderVersion("")
    setLoaderVersions([])
    // Set default port based on mode
    if (mode === "proxy") {
      setServerPort(25577) // Default Velocity port
    } else if (mode === "server") {
      setServerPort(25565) // Default Minecraft server port
    }
  }, [mode])

  const fetchUsedPorts = async () => {
    try {
      const ports = await invoke<{ port: number; instance_name: string }[]>("get_used_server_ports")
      setUsedPorts(ports)
    } catch (err) {
      console.error("Failed to fetch used ports:", err)
    }
  }

  const fetchVersions = async () => {
    // Proxies don't need MC versions
    if (mode === "proxy") return

    setIsLoadingVersions(true)
    try {
      const result = await invoke<MinecraftVersionList>("get_minecraft_versions", {
        includeSnapshots: showSnapshots,
      })
      setVersions(result.versions)
      setLatestRelease(result.latest_release)

      // Auto-select latest release if nothing selected
      if (!mcVersion && result.latest_release) {
        setMcVersion(result.latest_release)
      }
    } catch (err) {
      console.error("Failed to fetch versions:", err)
      setError(t("errors.loadError"))
    } finally {
      setIsLoadingVersions(false)
    }
  }

  const fetchLoaderVersions = async () => {
    if (loader === "vanilla") return

    setIsLoadingLoaderVersions(true)
    try {
      const result = await invoke<LoaderVersion[]>("get_loader_versions", {
        loaderType: loader,
        mcVersion: mode !== "proxy" ? mcVersion : null,
      })
      setLoaderVersions(result)

      // Auto-select recommended (first stable or first)
      const recommended = result.find(v => v.stable) || result[0]
      if (recommended) {
        setLoaderVersion(recommended.version)
      }
    } catch (err) {
      console.error("Failed to fetch loader versions:", err)
      setLoaderVersions([])
    } finally {
      setIsLoadingLoaderVersions(false)
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t("createInstance.error"))
      return
    }

    if (mode !== "proxy" && !mcVersion) {
      setError(t("createInstance.error"))
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await invoke("create_instance", {
        name: name.trim(),
        mcVersion: mode === "proxy" ? null : mcVersion,
        loader: loader === "vanilla" ? null : loader,
        loaderVersion: loaderVersion || null,
        isServer: mode === "server" || mode === "proxy",
        isProxy: mode === "proxy",
        serverPort: mode !== "client" ? serverPort : null,
      })

      // Reset form
      setName("")
      setMcVersion("")
      setLoader("vanilla")
      setLoaderVersion("")
      setMode("client")
      setServerPort(25565)
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const formatVersionLabel = (version: VersionInfo) => {
    const isLatest = version.id === latestRelease
    const typeLabel = version.version_type === "snapshot" ? " (Snapshot)" : ""
    return `${version.id}${typeLabel}${isLatest ? " - Latest" : ""}`
  }

  const formatLoaderVersionLabel = (version: LoaderVersion) => {
    const stable = version.stable ? "" : " (beta)"
    return `${version.version}${stable}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("createInstance.title")}</DialogTitle>
          <DialogDescription>
            {t("createInstance.subtitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Mode Selection */}
          <div className="grid gap-2">
            <Label>{t("createInstance.type")}</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="client" className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  {t("createInstance.client")}
                </TabsTrigger>
                <TabsTrigger value="server" className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t("createInstance.server")}
                </TabsTrigger>
                <TabsTrigger value="proxy" className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t("createInstance.proxy")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Instance Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">
              {t("createInstance.name")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder={t("createInstance.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {/* Minecraft Version (not for proxies) */}
          {mode !== "proxy" && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="version">
                  {t("createInstance.minecraftVersion")} <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={fetchVersions}
                    disabled={isLoadingVersions}
                    aria-label={t("common.refresh")}
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoadingVersions ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <Select value={mcVersion} onValueChange={setMcVersion} disabled={isLoadingVersions}>
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingVersions ? t("common.loading") : t("createInstance.minecraftVersion")} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {formatVersionLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 mt-1">
                <Switch
                  id="snapshots"
                  checked={showSnapshots}
                  onCheckedChange={setShowSnapshots}
                />
                <Label htmlFor="snapshots" className="text-xs text-muted-foreground cursor-pointer">
                  {t("settings.showSnapshots")}
                </Label>
              </div>
            </div>
          )}

          {/* Loader Selection */}
          <div className="grid gap-2">
            <Label htmlFor="loader">
              {mode === "client" ? t("createInstance.modLoader") : mode === "server" ? t("createInstance.serverType") : t("createInstance.proxyType")}
            </Label>
            <Select value={loader} onValueChange={setLoader}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currentLoaders.map((l) => (
                  <SelectItem key={l.value} value={l.value} disabled={l.disabled}>
                    <div className="flex flex-col">
                      <span>{l.label}</span>
                      <span className="text-xs text-muted-foreground">{t(l.descriptionKey)}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loader Version (when loader is selected) */}
          {loader !== "vanilla" && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="loaderVersion">{t("createInstance.loaderVersionLabel", { loader: currentLoaders.find(l => l.value === loader)?.label || "" })}</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={fetchLoaderVersions}
                    disabled={isLoadingLoaderVersions}
                    aria-label={t("common.refresh")}
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoadingLoaderVersions ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <Select
                value={loaderVersion}
                onValueChange={setLoaderVersion}
                disabled={isLoadingLoaderVersions || loaderVersions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    isLoadingLoaderVersions
                      ? t("common.loading")
                      : loaderVersions.length === 0
                        ? t("createInstance.noVersionAvailable")
                        : t("createInstance.loaderVersion")
                  } />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {loaderVersions.map((v) => (
                    <SelectItem key={v.version} value={v.version}>
                      {formatLoaderVersionLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Server Port (only for servers and proxies) */}
          {mode !== "client" && (
            <div className="grid gap-2">
              <Label htmlFor="serverPort">{t("createInstance.serverPort")}</Label>
              <Input
                id="serverPort"
                type="number"
                min={1}
                max={65535}
                value={serverPort}
                onChange={(e) => setServerPort(parseInt(e.target.value) || 25565)}
              />
              {usedPorts.find(p => p.port === serverPort) && (
                <p className="text-sm text-yellow-500 flex items-center gap-1">
                  <span>⚠️</span>
                  {t("createInstance.portInUse", { name: usedPorts.find(p => p.port === serverPort)?.instance_name || "" })}
                </p>
              )}
              {usedPorts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("createInstance.usedPorts")}: {usedPorts.map(p => p.port).join(", ")}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={isLoading || isLoadingVersions}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
