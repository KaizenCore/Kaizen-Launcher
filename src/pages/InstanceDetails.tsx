import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { useInstallationStore } from "@/stores/installationStore"
import { useTourStore, TourStep } from "@/stores/tourStore"
import { useEasyModeStore } from "@/stores/easyModeStore"
import { ArrowLeft, Settings, Package, Loader2, FolderOpen, Search, Download, Play, AlertCircle, Square, Copy, Check, ImageIcon, Link, X, Share2, Settings2, Cpu, Archive, RefreshCw } from "lucide-react"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/i18n"
import { Wrench, Terminal, Server, Globe, Palette, Sparkles, Database } from "lucide-react"
import { InstanceColorPicker } from "@/components/instances/InstanceColorPicker"

// Lazy load heavy components - only loaded when their tab is selected
const RamSlider = lazy(() => import("@/components/config/RamSlider").then(m => ({ default: m.RamSlider })))
const JvmTemplates = lazy(() => import("@/components/config/JvmTemplates").then(m => ({ default: m.JvmTemplates })))
const ServerJvmTemplates = lazy(() => import("@/components/config/ServerJvmTemplates").then(m => ({ default: m.ServerJvmTemplates })))
const JavaSelector = lazy(() => import("@/components/config/JavaSelector").then(m => ({ default: m.JavaSelector })))
const ModrinthBrowser = lazy(() => import("@/components/browse/ModrinthBrowser").then(m => ({ default: m.ModrinthBrowser })))
const ConfigEditor = lazy(() => import("@/components/config/ConfigEditor").then(m => ({ default: m.ConfigEditor })))
const InstanceConsole = lazy(() => import("@/components/instances/InstanceConsole").then(m => ({ default: m.InstanceConsole })))
const ServerPropertiesEditor = lazy(() => import("@/components/config/ServerPropertiesEditor").then(m => ({ default: m.ServerPropertiesEditor })))
const ServerStats = lazy(() => import("@/components/server/ServerStats").then(m => ({ default: m.ServerStats })))
const TunnelConfig = lazy(() => import("@/components/tunnel/TunnelConfig").then(m => ({ default: m.TunnelConfig })))
const WorldsTab = lazy(() => import("@/components/instances/WorldsTab").then(m => ({ default: m.WorldsTab })))
const ModsList = lazy(() => import("@/components/instances/ModsList").then(m => ({ default: m.ModsList })))
const ExportInstanceDialog = lazy(() => import("@/components/sharing/ExportInstanceDialog").then(m => ({ default: m.ExportInstanceDialog })))
const ChangeVersionDialog = lazy(() => import("@/components/dialogs/ChangeVersionDialog").then(m => ({ default: m.ChangeVersionDialog })))
const EasyModeOptimizer = lazy(() => import("@/components/instances/EasyModeOptimizer").then(m => ({ default: m.EasyModeOptimizer })))

// Loading fallback for lazy components
function ComponentLoader() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

interface Instance {
  id: string
  name: string
  icon_path: string | null
  mc_version: string
  loader: string | null
  loader_version: string | null
  game_dir: string
  last_played: string | null
  total_playtime_seconds: number
  memory_min_mb: number
  memory_max_mb: number
  java_path: string | null
  jvm_args: string | null
  is_server: boolean
  is_proxy: boolean
  color: string | null
}

// Determine what type of content this server/instance supports
type ContentType = "mods" | "plugins" | "none"

function getContentType(loader: string | null, _isServer: boolean): ContentType {
  if (!loader) {
    // Vanilla - no mods or plugins
    return "none"
  }

  const loaderLower = loader.toLowerCase()

  // Mod loaders (work for both client and server)
  if (["fabric", "forge", "neoforge", "quilt"].includes(loaderLower)) {
    return "mods"
  }

  // Plugin servers
  if (["paper", "velocity", "bungeecord", "waterfall", "purpur", "spigot", "bukkit"].includes(loaderLower)) {
    return "plugins"
  }

  return "none"
}

function getContentLabel(contentType: ContentType): { singular: string; plural: string; folder: string } {
  switch (contentType) {
    case "mods":
      return { singular: "Mod", plural: "Mods", folder: "mods" }
    case "plugins":
      return { singular: "Plugin", plural: "Plugins", folder: "plugins" }
    default:
      return { singular: "Mod", plural: "Mods", folder: "mods" }
  }
}

export function InstanceDetails() {
  const { t } = useTranslation()
  const { instanceId } = useParams<{ instanceId: string }>()
  const navigate = useNavigate()
  const [instance, setInstance] = useState<Instance | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Launch state
  const [isInstalled, setIsInstalled] = useState(false)
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchStep, setLaunchStep] = useState<string | null>(null)

  // Use global installation store
  const { startInstallation, isInstalling: checkIsInstalling } = useInstallationStore()
  const isInstalling = instanceId ? checkIsInstalling(instanceId) : false
  const [isRunning, setIsRunning] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)

  // Tunnel state
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null)

  // Share dialog state
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showChangeVersionDialog, setShowChangeVersionDialog] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  // Content type (mods vs plugins vs none)
  const contentType = useMemo(() => getContentType(instance?.loader || null, instance?.is_server || false), [instance?.loader, instance?.is_server])
  const contentLabel = useMemo(() => getContentLabel(contentType), [contentType])

  // Mods refresh key - used to trigger ModsList reload when content changes
  const [modsRefreshKey, setModsRefreshKey] = useState(0)

  // Settings form state
  const [name, setName] = useState("")
  const [memoryMin, setMemoryMin] = useState(512)
  const [memoryMax, setMemoryMax] = useState(4096)
  const [javaPath, setJavaPath] = useState("")
  const [jvmArgs, setJvmArgs] = useState("")

  // Icon state
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null)
  const [iconInputUrl, setIconInputUrl] = useState("")
  const [isUpdatingIcon, setIsUpdatingIcon] = useState(false)

  // Auto-backup state
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false)
  const [isCreatingBackup, setIsCreatingBackup] = useState(false)

  // Settings sub-tabs state
  const [settingsTab, setSettingsTab] = useState("general")

  // Easy mode
  const { enabled: easyMode } = useEasyModeStore()

  // Auto-save ref to track if initial load is complete
  const isInitialLoadRef = useRef(true)
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-save settings with debounce
  useEffect(() => {
    // Skip auto-save on initial load
    if (isInitialLoadRef.current) {
      return
    }

    // Clear any existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    // Debounce save by 500ms
    autoSaveTimeoutRef.current = setTimeout(async () => {
      if (!instanceId) return
      try {
        await invoke("update_instance_settings", {
          instanceId,
          name,
          memoryMinMb: memoryMin,
          memoryMaxMb: memoryMax,
          javaPath: javaPath || null,
          jvmArgs: jvmArgs || null,
        })
        // Silently save - no toast for auto-save
      } catch (err) {
        console.error("Auto-save failed:", err)
        toast.error(t("errors.saveError"))
      }
    }, 500)

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [name, memoryMin, memoryMax, javaPath, jvmArgs, instanceId, t])

  const loadInstance = async () => {
    if (!instanceId) return
    console.log(`[InstanceDetails] Loading instance: ${instanceId}`)
    try {
      const result = await invoke<Instance>("get_instance", { instanceId })
      console.log(`[InstanceDetails] Loaded instance: ${result.name} (MC ${result.mc_version}, ${result.loader || "vanilla"})`)
      setInstance(result)
      setName(result.name)
      setMemoryMin(result.memory_min_mb)
      setMemoryMax(result.memory_max_mb)
      setJavaPath(result.java_path || "")
      setJvmArgs(result.jvm_args || "")
      // Mark initial load as complete after a short delay to allow state to settle
      setTimeout(() => {
        isInitialLoadRef.current = false
      }, 100)
    } catch (err) {
      console.error("[InstanceDetails] Failed to load instance:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadIcon = async () => {
    if (!instanceId) return
    try {
      const iconUrl = await invoke<string | null>("get_instance_icon", { instanceId })
      setIconDataUrl(iconUrl)
    } catch (err) {
      console.error("Failed to load icon:", err)
      setIconDataUrl(null)
    }
  }

  const loadAutoBackup = async () => {
    if (!instanceId) return
    try {
      const enabled = await invoke<boolean>("get_instance_auto_backup", { instanceId })
      setAutoBackupEnabled(enabled)
    } catch (err) {
      console.error("Failed to load auto-backup setting:", err)
    }
  }

  const handleToggleAutoBackup = async (enabled: boolean) => {
    if (!instanceId) return
    try {
      await invoke("set_instance_auto_backup", { instanceId, enabled })
      setAutoBackupEnabled(enabled)
      toast.success(enabled ? t("instanceDetails.autoBackupEnabled") : t("instanceDetails.autoBackupDisabled"))
    } catch (err) {
      console.error("Failed to toggle auto-backup:", err)
      toast.error(t("instanceDetails.autoBackupError"))
    }
  }

  const handleCreateInstanceBackup = async () => {
    if (!instanceId || isCreatingBackup) return
    setIsCreatingBackup(true)
    try {
      await invoke("create_instance_backup", { instanceId })
      toast.success(t("instanceDetails.instanceBackupCreated"))
    } catch (err) {
      console.error("Failed to create instance backup:", err)
      toast.error(t("instanceDetails.instanceBackupError"))
    } finally {
      setIsCreatingBackup(false)
    }
  }

  const handleOpenModsFolder = useCallback(async () => {
    if (!instanceId) return
    try {
      const isPlugin = instance?.is_server || instance?.is_proxy
      await invoke("open_instance_folder", {
        instanceId,
        subfolder: isPlugin ? "plugins" : "mods",
      })
    } catch (err) {
      console.error("Failed to open folder:", err)
    }
  }, [instanceId, instance?.is_server, instance?.is_proxy])

  const handleOpenInstanceFolder = useCallback(async () => {
    if (!instanceId) return
    try {
      await invoke("open_instance_folder", { instanceId })
    } catch (err) {
      console.error("Failed to open instance folder:", err)
    }
  }, [instanceId])

  // Callback when content is changed - triggers ModsList reload
  const handleContentChanged = useCallback(() => {
    setModsRefreshKey(prev => prev + 1)
  }, [])

  const checkInstallation = async () => {
    if (!instanceId) return
    try {
      const installed = await invoke<boolean>("is_instance_installed", { instanceId })
      setIsInstalled(installed)
    } catch (err) {
      console.error("Failed to check installation:", err)
      setIsInstalled(false)
    }
  }

  const checkRunningStatus = async () => {
    if (!instanceId) return
    try {
      const running = await invoke<boolean>("is_instance_running", { instanceId })
      setIsRunning(running)
    } catch (err) {
      console.error("Failed to check running status:", err)
      setIsRunning(false)
    }
  }

  const loadActiveAccount = async () => {
    try {
      const account = await invoke<{ id: string } | null>("get_active_account")
      setActiveAccountId(account?.id || null)
    } catch (err) {
      console.error("Failed to get active account:", err)
      setActiveAccountId(null)
    }
  }

  const handleLaunch = async () => {
    if (!instanceId) return
    if (!activeAccountId) {
      setLaunchError(t("instanceDetails.noActiveAccount"))
      toast.error(t("instanceDetails.noActiveAccount"))
      return
    }
    console.log(`[InstanceDetails] Launching instance: ${instance?.name || instanceId}`)
    setIsLaunching(true)
    setLaunchError(null)

    // Auto-backup worlds before launch if enabled
    if (autoBackupEnabled) {
      console.log("[InstanceDetails] Running auto-backup before launch...")
      toast.loading(t("instanceDetails.backingUpWorlds"), { id: "auto-backup" })
      try {
        await invoke("auto_backup_worlds", { instanceId })
        console.log("[InstanceDetails] Auto-backup completed")
        toast.success(t("instanceDetails.backupComplete"), { id: "auto-backup" })
      } catch (err) {
        console.warn("[InstanceDetails] Auto-backup failed:", err)
        toast.warning(t("instanceDetails.backupWarning"), { id: "auto-backup" })
      }
    }

    toast.loading(t("instanceDetails.starting"), { id: "launch-instance" })
    try {
      await invoke("launch_instance", { instanceId, accountId: activeAccountId })
      console.log(`[InstanceDetails] Instance launched: ${instance?.name || instanceId}`)
      toast.success(t("instanceDetails.started"), { id: "launch-instance" })
    } catch (err) {
      console.error("[InstanceDetails] Failed to launch instance:", err)
      setLaunchError(`${t("errors.launchFailed")}: ${err}`)
      toast.error(`${t("errors.launchFailed")}: ${err}`, { id: "launch-instance" })
    } finally {
      setIsLaunching(false)
    }
  }

  const handlePlayClick = async () => {
    if (!activeAccountId && !(instance?.is_server || instance?.is_proxy)) {
      setLaunchError(t("instanceDetails.noActiveAccount"))
      toast.error(t("instanceDetails.noActiveAccount"))
      return
    }
    if (!isInstalled) {
      // Install first, then launch
      // Start installation in global store (shows notification)
      startInstallation(instanceId!, instance?.name || "Instance")
      setLaunchError(null)
      try {
        await invoke("install_instance", { instanceId })
        setIsInstalled(true)
        // Now launch
        setIsLaunching(true)
        toast.loading(t("instanceDetails.starting"), { id: "launch-after-install" })
        await invoke("launch_instance", { instanceId, accountId: activeAccountId })
        toast.success(t("instanceDetails.started"), { id: "launch-after-install" })
      } catch (err) {
        console.error("Failed to install/launch instance:", err)
        setLaunchError(`${t("common.error")}: ${err}`)
        toast.error(`${t("common.error")}: ${err}`, { id: "install-launch" })
      } finally {
        setIsLaunching(false)
      }
    } else {
      await handleLaunch()
    }
  }

  const handleStop = async () => {
    if (!instanceId) return
    console.log(`[InstanceDetails] Stopping instance: ${instance?.name || instanceId}`)
    try {
      await invoke("stop_instance", { instanceId })
      console.log(`[InstanceDetails] Instance stopped: ${instance?.name || instanceId}`)
      toast.success(t("instances.instanceStopped"))
    } catch (err) {
      console.error("[InstanceDetails] Failed to stop instance:", err)
      setLaunchError(`${t("instances.unableToStop")}: ${err}`)
      toast.error(`${t("instances.unableToStop")}: ${err}`)
    }
  }

  // Load saved tunnel URL
  const loadTunnelUrl = useCallback(async () => {
    if (!instanceId) return
    try {
      const config = await invoke<{ tunnel_url: string | null } | null>("get_tunnel_config", { instanceId })
      if (config?.tunnel_url) {
        setTunnelUrl(config.tunnel_url)
      }
    } catch (err) {
      console.error("Failed to load tunnel config:", err)
    }
  }, [instanceId])

  useEffect(() => {
    // Batch all initial API calls in parallel for better performance
    Promise.all([
      loadInstance(),
      checkInstallation(),
      checkRunningStatus(),
      loadActiveAccount(),
      loadIcon(),
      loadTunnelUrl(),
      loadAutoBackup(),
    ]).catch(console.error)

    // Listen for instance status events
    let unlistenStatus: UnlistenFn | null = null
    let unlistenTunnelUrl: UnlistenFn | null = null
    let unlistenTunnelStatus: UnlistenFn | null = null
    let unlistenLaunchProgress: UnlistenFn | null = null

    const setupListeners = async () => {
      // Listen for launch progress events
      unlistenLaunchProgress = await listen<{ instance_id: string; step: string; step_index: number; total_steps: number }>(
        "launch-progress",
        (event) => {
          if (event.payload.instance_id === instanceId) {
            setLaunchStep(event.payload.step)
          }
        }
      )

      unlistenStatus = await listen<{ instance_id: string; status: string; exit_code: number | null }>(
        "instance-status",
        (event) => {
          if (event.payload.instance_id === instanceId) {
            const running = event.payload.status === "running"
            setIsRunning(running)
            setIsLaunching(false)
            setLaunchStep(null) // Clear launch step when status changes
            if (!running) {
              setLaunchError(null)
              // Keep tunnel URL for reference (last known address)
            }
          }
        }
      )

      // Listen for tunnel URL events
      unlistenTunnelUrl = await listen<{ instance_id: string; url: string }>(
        "tunnel-url",
        async (event) => {
          if (event.payload.instance_id === instanceId) {
            setTunnelUrl(event.payload.url)
            // Save URL to database for persistence
            try {
              await invoke("save_tunnel_url", {
                instanceId,
                url: event.payload.url
              })
            } catch (err) {
              console.error("Failed to save tunnel URL:", err)
            }
          }
        }
      )

      // Listen for tunnel status events to update URL when connected
      unlistenTunnelStatus = await listen<{ instance_id: string; status: { type: string; url?: string } }>(
        "tunnel-status",
        (event) => {
          if (event.payload.instance_id === instanceId) {
            // Update URL when tunnel connects (keep last known URL when disconnected)
            if (event.payload.status.type === "connected" && event.payload.status.url) {
              setTunnelUrl(event.payload.status.url)
            }
          }
        }
      )
    }
    setupListeners()

    return () => {
      if (unlistenLaunchProgress) unlistenLaunchProgress()
      if (unlistenStatus) unlistenStatus()
      if (unlistenTunnelUrl) unlistenTunnelUrl()
      if (unlistenTunnelStatus) unlistenTunnelStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  // Tour system
  const { pendingTourInstanceId, startTour, clearPendingTour } = useTourStore()

  // Build tour steps (memoized to avoid recreation)
  const buildTourSteps = useCallback((isServer: boolean, hasModLoader: boolean): TourStep[] => {
    const steps: TourStep[] = [
      {
        id: "install-button",
        targetSelector: "[data-tour='play-button']",
        title: t("tour.installButton.title"),
        description: t("tour.installButton.description"),
        position: "bottom",
      },
      {
        id: "settings-tab",
        targetSelector: "[data-tour='settings-tab']",
        title: t("tour.settingsTab.title"),
        description: t("tour.settingsTab.description"),
        position: "bottom",
      },
    ]

    if (hasModLoader) {
      steps.push({
        id: "mods-tab",
        targetSelector: "[data-tour='mods-tab']",
        title: t("tour.modsTab.title"),
        description: t("tour.modsTab.description"),
        position: "bottom",
      })
      steps.push({
        id: "browse-tab",
        targetSelector: "[data-tour='browse-tab']",
        title: t("tour.browseTab.title"),
        description: t("tour.browseTab.description"),
        position: "bottom",
      })
    }

    steps.push({
      id: "worlds-tab",
      targetSelector: "[data-tour='worlds-tab']",
      title: t("tour.worldsTab.title"),
      description: t("tour.worldsTab.description"),
      position: "bottom",
    })

    steps.push({
      id: "logs-tab",
      targetSelector: "[data-tour='logs-tab']",
      title: t("tour.logsTab.title"),
      description: t("tour.logsTab.description"),
      position: "bottom",
    })

    steps.push({
      id: "config-tab",
      targetSelector: "[data-tour='config-tab']",
      title: t("tour.configTab.title"),
      description: t("tour.configTab.description"),
      position: "bottom",
    })

    // Final step: Click Play to launch
    steps.push({
      id: "play-button-final",
      targetSelector: "[data-tour='play-button']",
      title: t("tour.playButton.title"),
      description: t("tour.playButton.description"),
      position: "bottom",
    })

    if (isServer) {
      steps.unshift({
        id: "console-tab",
        targetSelector: "[data-tour='console-tab']",
        title: t("tour.consoleTab.title"),
        description: t("tour.consoleTab.description"),
        position: "bottom",
      })
    }

    return steps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Start tour if this is the instance created during onboarding
    if (pendingTourInstanceId && instanceId && pendingTourInstanceId === instanceId && instance) {
      // Wait for the page to fully render
      const timeout = setTimeout(() => {
        const isServer = instance.is_server || instance.is_proxy
        const hasModLoader = Boolean(instance.loader && ["fabric", "forge", "neoforge", "quilt"].includes(instance.loader.toLowerCase()))
        const tourSteps = buildTourSteps(isServer, hasModLoader)
        // Clear pending AFTER building steps, before starting
        clearPendingTour()
        startTour(instanceId, tourSteps)
      }, 1000)

      return () => clearTimeout(timeout)
    }
  }, [pendingTourInstanceId, instanceId, instance, startTour, clearPendingTour, buildTourSteps])

  const handleUpdateIconFromUrl = async () => {
    if (!instanceId || !iconInputUrl.trim()) return
    setIsUpdatingIcon(true)
    try {
      await invoke("update_instance_icon", {
        instanceId,
        iconSource: iconInputUrl.trim(),
      })
      await loadInstance()
      await loadIcon()
      setIconInputUrl("")
      toast.success(t("instanceDetails.iconUpdated"))
    } catch (err) {
      console.error("Failed to update icon:", err)
      toast.error(t("instanceDetails.iconUpdateError"))
    } finally {
      setIsUpdatingIcon(false)
    }
  }

  const handleSelectIconFile = async () => {
    if (!instanceId) return
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"],
          },
        ],
      })
      if (selected) {
        setIsUpdatingIcon(true)
        try {
          await invoke("update_instance_icon", {
            instanceId,
            iconSource: selected,
          })
          await loadInstance()
          await loadIcon()
          toast.success(t("instanceDetails.iconUpdated"))
        } catch (err) {
          console.error("Failed to update icon:", err)
          toast.error(t("instanceDetails.iconUpdateError"))
        } finally {
          setIsUpdatingIcon(false)
        }
      }
    } catch (err) {
      console.error("Failed to open file dialog:", err)
    }
  }

  const handleClearIcon = async () => {
    if (!instanceId) return
    setIsUpdatingIcon(true)
    try {
      await invoke("clear_instance_icon", { instanceId })
      await loadInstance()
      await loadIcon()
      toast.success(t("instanceDetails.iconCleared"))
    } catch (err) {
      console.error("Failed to clear icon:", err)
      toast.error(t("instanceDetails.iconClearError"))
    } finally {
      setIsUpdatingIcon(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">{t("instanceDetails.notFound")}</p>
        <Button variant="outline" onClick={() => navigate("/instances")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("instanceDetails.backToInstances")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/instances")} aria-label={t("common.back")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
              {iconDataUrl ? (
                <img
                  src={iconDataUrl}
                  alt={instance.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xl font-bold">
                  {instance.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{instance.name}</h1>
              <p className="text-muted-foreground">
                {instance.mc_version}
                {instance.loader && ` - ${instance.loader}`}
                {instance.loader_version && ` ${instance.loader_version}`}
              </p>
            </div>
          </div>
        </div>

        {/* Launch Controls */}
        <div className="flex items-center gap-3">
          {/* Open folder button */}
          <Button
            variant="outline"
            size="icon"
            onClick={handleOpenInstanceFolder}
            title={t("common.openFolder")}
            aria-label={t("common.openFolder")}
          >
            <FolderOpen className="h-5 w-5" />
          </Button>

          {/* Share button */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowExportDialog(true)}
            title={t("sharing.share")}
            aria-label={t("sharing.share")}
          >
            <Share2 className="h-5 w-5" />
          </Button>

          {launchError && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 text-destructive text-sm cursor-help">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="max-w-[200px] truncate">{launchError}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[400px]">
                  <p className="break-words">{launchError}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isRunning ? (
            <>
              <Button
                size="lg"
                disabled
                className="gap-2 px-6 bg-green-600 hover:bg-green-600"
              >
                {instance?.is_server || instance?.is_proxy ? (
                  <Server className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
                {t("instanceDetails.inProgress")}
              </Button>
              <Button
                size="lg"
                variant="destructive"
                onClick={handleStop}
                className="gap-2 px-6"
              >
                <Square className="h-5 w-5" />
                {t("instances.stop")}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              onClick={handlePlayClick}
              disabled={isInstalling || isLaunching || (!(instance?.is_server || instance?.is_proxy) && !activeAccountId)}
              className="gap-2 px-6"
              data-tour="play-button"
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("instances.installing")}
                </>
              ) : isLaunching ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {launchStep === "preparing" ? t("launch.preparing")
                    : launchStep === "checking_java" ? t("launch.checking_java")
                    : launchStep === "building_args" ? t("launch.building_args")
                    : launchStep === "starting" ? t("launch.starting")
                    : t("instanceDetails.starting")}
                </>
              ) : !(instance?.is_server || instance?.is_proxy) && !activeAccountId ? (
                <>
                  <AlertCircle className="h-5 w-5" />
                  {t("instanceDetails.connectionRequired")}
                </>
              ) : isInstalled ? (
                <>
                  {instance?.is_server || instance?.is_proxy ? (
                    <Server className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                  {instance?.is_proxy ? t("server.startProxy") : instance?.is_server ? t("server.start") : t("instances.play")}
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  {t("instances.install")}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={instance?.is_server || instance?.is_proxy ? "console" : "settings"} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList className="flex-shrink-0">
          <TabsTrigger value="settings" className="gap-2" data-tour="settings-tab">
            <Settings className="h-4 w-4" />
            {t("common.settings")}
          </TabsTrigger>
          {contentType !== "none" && (
            <TabsTrigger value="content" className="gap-2" data-tour="mods-tab">
              <Package className="h-4 w-4" />
              {contentLabel.plural}
            </TabsTrigger>
          )}
          <TabsTrigger value="worlds" className="gap-2" data-tour="worlds-tab">
            <Globe className="h-4 w-4" />
            {t("instanceDetails.worlds")}
          </TabsTrigger>
          <TabsTrigger value="backups" className="gap-2" data-tour="backups-tab">
            <Archive className="h-4 w-4" />
            {t("instanceDetails.backups")}
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2" data-tour="config-tab">
            <Wrench className="h-4 w-4" />
            Config
          </TabsTrigger>
          {/* Console tab - available for all instances */}
          <TabsTrigger value="console" className="gap-2" data-tour="console-tab">
            <Terminal className="h-4 w-4" />
            {t("instanceDetails.console")}
          </TabsTrigger>
          {/* Tunnel tab - only for servers */}
          {(instance?.is_server || instance?.is_proxy) && (
            <TabsTrigger value="tunnel" className="gap-2" data-tour="tunnel-tab">
              <Globe className="h-4 w-4" />
              Tunnel
            </TabsTrigger>
          )}
        </TabsList>

        {/* Console Tab - Available for all instances */}
        <TabsContent value="console" className="mt-4 space-y-3">
          {/* Server Stats - only for servers */}
          {(instance?.is_server || instance?.is_proxy) && (
            <div className="flex-shrink-0">
              <Suspense fallback={<ComponentLoader />}>
                <ServerStats
                  instanceId={instanceId!}
                  isRunning={isRunning}
                />
              </Suspense>
            </div>
          )}

          {/* Server Addresses - only for running servers */}
          {(instance?.is_server || instance?.is_proxy) && isRunning && (
            <Card className="border-green-500/30 bg-green-500/5 flex-shrink-0">
              <CardContent className="py-4">
                <div className="flex flex-wrap gap-4">
                  {/* Local Address */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/50">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t("instanceDetails.local")}</span>
                    <code className="text-sm font-mono text-foreground">localhost:25565</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={t("tunnel.addressCopied")}
                      onClick={() => {
                        navigator.clipboard.writeText("localhost:25565")
                          .then(() => {
                            setCopiedAddress("local")
                            toast.success(t("instanceDetails.localAddressCopied"))
                            setTimeout(() => setCopiedAddress(null), 2000)
                          })
                          .catch(() => toast.error(t("instanceDetails.unableToCopy")))
                      }}
                    >
                      {copiedAddress === "local" ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>

                  {/* Tunnel Address */}
                  {tunnelUrl && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/50">
                      <Globe className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-muted-foreground">{t("instanceDetails.tunnel")}</span>
                      <code className="text-sm font-mono text-green-500">{tunnelUrl}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={t("tunnel.addressCopied")}
                        onClick={() => {
                          navigator.clipboard.writeText(tunnelUrl)
                            .then(() => {
                              setCopiedAddress("tunnel")
                              toast.success(t("instanceDetails.tunnelAddressCopied"))
                              setTimeout(() => setCopiedAddress(null), 2000)
                            })
                            .catch(() => toast.error(t("instanceDetails.unableToCopy")))
                        }}
                      >
                        {copiedAddress === "tunnel" ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Unified Console */}
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardHeader className="flex-shrink-0 pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("instanceDetails.console")}</CardTitle>
                  <CardDescription>
                    {t("instanceDetails.viewLogsRealtime")}
                  </CardDescription>
                </div>
                {isRunning && (
                  <Badge variant="secondary" className="bg-green-500/20 text-green-500">
                    {(instance?.is_server || instance?.is_proxy) ? (
                      <Server className="h-3 w-3 mr-1" />
                    ) : (
                      <Play className="h-3 w-3 mr-1" />
                    )}
                    {t("instanceDetails.running")}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 pb-4">
              <Suspense fallback={<ComponentLoader />}>
                <InstanceConsole
                  instanceId={instanceId!}
                  isRunning={isRunning}
                  isServer={instance?.is_server || instance?.is_proxy || false}
                  mcVersion={instance?.mc_version}
                  loader={instance?.loader}
                  onModInstalled={handleContentChanged}
                />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-4 overflow-y-auto">
          <Tabs value={settingsTab} onValueChange={setSettingsTab}>
            <TabsList className="flex-shrink-0 w-fit mb-4">
              <TabsTrigger value="general" className="gap-2">
                <Settings2 className="h-4 w-4" />
                {t("instanceDetails.settingsTabGeneral")}
              </TabsTrigger>
              <TabsTrigger value="performance" className="gap-2">
                <Cpu className="h-4 w-4" />
                {t("instanceDetails.settingsTabPerformance")}
              </TabsTrigger>
              {/* Server tab - shown for servers OR modded clients that can create servers (hidden in Easy Mode) */}
              {!easyMode && (instance?.is_server || instance?.is_proxy ||
                (instance?.loader && ["fabric", "forge", "neoforge", "quilt"].includes(instance.loader.toLowerCase()))) && (
                <TabsTrigger value="server" className="gap-2">
                  <Server className="h-4 w-4" />
                  {t("instanceDetails.settingsTabServer")}
                </TabsTrigger>
              )}
            </TabsList>

            <div>
              {/* General Sub-Tab */}
              <TabsContent value="general" className="mt-0 data-[state=active]:block">
                {easyMode ? (
                  /* Easy Mode: Simplified general settings */
                  <Card>
                    <CardHeader className="pb-4">
                      <CardTitle>{t("easyMode.simpleSettings")}</CardTitle>
                      <CardDescription>{t("easyMode.simpleSettingsDesc")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Instance Name */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">{t("instanceDetails.instanceName")}</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t("createInstance.namePlaceholder")}
                        />
                      </div>

                      {/* Instance Info - Compact */}
                      <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{t("instanceDetails.instanceType")}</span>
                          <Badge variant="secondary">
                            {instance?.is_proxy
                              ? t("instanceDetails.instanceTypeProxy")
                              : instance?.is_server
                              ? t("instanceDetails.instanceTypeServer")
                              : t("instanceDetails.instanceTypeClient")}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Minecraft</span>
                          <span className="text-sm font-medium">{instance?.mc_version}</span>
                        </div>
                        {instance?.loader && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Loader</span>
                            <span className="text-sm font-medium">{instance.loader}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{t("instanceDetails.totalPlaytime")}</span>
                          <span className="text-sm font-medium">
                            {instance?.total_playtime_seconds
                              ? (() => {
                                  const hours = Math.floor(instance.total_playtime_seconds / 3600)
                                  const minutes = Math.floor((instance.total_playtime_seconds % 3600) / 60)
                                  if (hours > 0) {
                                    return `${hours}h ${minutes}m`
                                  }
                                  return `${minutes}m`
                                })()
                              : t("instanceDetails.neverPlayed")}
                          </span>
                        </div>
                      </div>

                      {/* Simple Action */}
                      <Button
                        variant="outline"
                        onClick={handleOpenInstanceFolder}
                        className="w-full gap-2"
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t("common.openFolder")}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  /* Advanced Mode: Full settings */
                  <div className="grid gap-4 lg:grid-cols-2">
                    {/* Left Column - Identity & Quick Actions */}
                    <div className="space-y-4">
                      {/* Instance Identity Card */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{t("instanceDetails.instanceName")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Name */}
                          <div className="space-y-2">
                            <Input
                              id="name"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder={t("createInstance.namePlaceholder")}
                            />
                          </div>

                          {/* Icon */}
                          <div className="space-y-2">
                            <Label className="text-sm text-muted-foreground">{t("instanceDetails.icon")}</Label>
                            <div className="flex items-center gap-2">
                              <div className="flex-shrink-0 w-10 h-10 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
                                {iconDataUrl ? (
                                  <img
                                    src={iconDataUrl}
                                    alt={instance?.name || "Instance"}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-sm font-bold text-muted-foreground">
                                    {instance?.name?.charAt(0).toUpperCase() || "?"}
                                  </span>
                                )}
                              </div>
                              <div className="relative flex-1 min-w-[150px]">
                                <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  value={iconInputUrl}
                                  onChange={(e) => setIconInputUrl(e.target.value)}
                                  placeholder={t("instanceDetails.imageUrlPlaceholder")}
                                  className="pl-8 h-9 text-sm"
                                  disabled={isUpdatingIcon}
                                />
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={handleUpdateIconFromUrl}
                                disabled={!iconInputUrl.trim() || isUpdatingIcon}
                                className="h-9"
                              >
                                {isUpdatingIcon ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "OK"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSelectIconFile}
                                disabled={isUpdatingIcon}
                                className="h-9 gap-1.5"
                              >
                                <ImageIcon className="h-3.5 w-3.5" />
                                {t("instanceDetails.file")}
                              </Button>
                              {instance?.icon_path && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleClearIcon}
                                  disabled={isUpdatingIcon}
                                  className="h-9 w-9 p-0 text-destructive hover:text-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Color - only show if no icon */}
                          {!instance?.icon_path && (
                            <div className="space-y-2">
                              <Label className="text-sm text-muted-foreground">{t("instances.changeColor")}</Label>
                              <InstanceColorPicker
                                instanceId={instanceId!}
                                currentColor={instance?.color || null}
                                onColorChange={(color) => {
                                  setInstance(prev => prev ? { ...prev, color } : prev)
                                }}
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Quick Actions Card */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{t("instanceDetails.quickActions")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleOpenInstanceFolder}
                              className="gap-2"
                            >
                              <FolderOpen className="h-4 w-4" />
                              {t("common.openFolder")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowExportDialog(true)}
                              className="gap-2"
                            >
                              <Share2 className="h-4 w-4" />
                              {t("instanceDetails.exportInstance")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Right Column - Information & Statistics */}
                    <div className="space-y-4">
                      {/* Instance Information Card */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{t("instanceDetails.instanceInfo")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-3">
                            {/* Type */}
                            <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                              <span className="text-sm text-muted-foreground">{t("instanceDetails.instanceType")}</span>
                              <Badge variant="secondary">
                                {instance?.is_proxy
                                  ? t("instanceDetails.instanceTypeProxy")
                                  : instance?.is_server
                                  ? t("instanceDetails.instanceTypeServer")
                                  : t("instanceDetails.instanceTypeClient")}
                              </Badge>
                            </div>

                            {/* MC Version */}
                            <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                              <span className="text-sm text-muted-foreground">Minecraft</span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{instance?.mc_version}</span>
                                {!instance?.is_proxy && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => setShowChangeVersionDialog(true)}
                                    disabled={isRunning}
                                    title={t("changeVersion.title")}
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Loader */}
                            {instance?.loader && (
                              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                                <span className="text-sm text-muted-foreground">Loader</span>
                                <span className="text-sm font-medium">
                                  {instance.loader}
                                  {instance.loader_version && (
                                    <span className="text-muted-foreground ml-1">({instance.loader_version})</span>
                                  )}
                                </span>
                              </div>
                            )}

                            {/* Game Directory */}
                            <div className="flex items-center justify-between py-1.5">
                              <span className="text-sm text-muted-foreground">{t("instanceDetails.gameDirectory")}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleOpenInstanceFolder}
                                className="h-7 gap-1.5 text-xs"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                {t("instanceDetails.openGameDir")}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Statistics Card */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{t("instanceDetails.statistics")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-3">
                            {/* Total Playtime */}
                            <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                              <span className="text-sm text-muted-foreground">{t("instanceDetails.totalPlaytime")}</span>
                              <span className="text-sm font-medium">
                                {instance?.total_playtime_seconds
                                  ? (() => {
                                      const hours = Math.floor(instance.total_playtime_seconds / 3600)
                                      const minutes = Math.floor((instance.total_playtime_seconds % 3600) / 60)
                                      if (hours > 0) {
                                        return `${hours}h ${minutes}m`
                                      }
                                      return `${minutes}m`
                                    })()
                                  : t("instanceDetails.neverPlayed")}
                              </span>
                            </div>

                            {/* Last Played */}
                            <div className="flex items-center justify-between py-1.5">
                              <span className="text-sm text-muted-foreground">{t("instanceDetails.lastPlayed")}</span>
                              <span className="text-sm font-medium">
                                {instance?.last_played
                                  ? new Date(instance.last_played).toLocaleDateString(undefined, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    })
                                  : t("instanceDetails.neverPlayed")}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Performance Sub-Tab */}
              <TabsContent value="performance" className="mt-0 data-[state=active]:block">
                {easyMode ? (
                  /* Easy Mode: Show simplified optimizer */
                  <Suspense fallback={<ComponentLoader />}>
                    <EasyModeOptimizer
                      instanceId={instanceId!}
                      loader={instance?.loader || null}
                      isServer={instance?.is_server || false}
                      onOptimized={({ memoryMin: newMin, memoryMax: newMax, jvmArgs: newArgs }) => {
                        setMemoryMin(newMin)
                        setMemoryMax(newMax)
                        setJvmArgs(newArgs)
                      }}
                    />
                  </Suspense>
                ) : (
                  /* Advanced Mode: Show full settings */
                  <Card>
                    <CardHeader className="pb-4">
                      <CardTitle>{t("instanceDetails.settingsTabPerformance")}</CardTitle>
                      <CardDescription>
                        {t("instanceDetails.configureOptions")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {/* Memory Settings */}
                      <div className="space-y-3">
                        <Label className="text-sm font-medium">{t("instances.memory")}</Label>

                        {/* Memory explanation tip */}
                        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                          <p className="font-medium text-blue-500 mb-1">{t("ram.tipTitle")}</p>
                          <p className="text-muted-foreground text-xs">{t("ram.tipContent")}</p>
                        </div>

                        <Suspense fallback={<ComponentLoader />}>
                          <div className="grid gap-4 md:grid-cols-2 p-4 rounded-lg border bg-muted/30">
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground mb-2">
                                <span className="font-medium text-foreground">{t("ram.minMemoryTitle")}</span>
                                <p className="mt-0.5">{t("ram.minMemoryDesc")}</p>
                              </div>
                              <RamSlider
                                label="Minimum (Xms)"
                                value={memoryMin}
                                onChange={setMemoryMin}
                                minValue={512}
                                recommendedValue="min"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground mb-2">
                                <span className="font-medium text-foreground">{t("ram.maxMemoryTitle")}</span>
                                <p className="mt-0.5">{t("ram.maxMemoryDesc")}</p>
                              </div>
                              <RamSlider
                                label="Maximum (Xmx)"
                                value={memoryMax}
                                onChange={setMemoryMax}
                                minValue={memoryMin}
                                recommendedValue="max"
                              />
                            </div>
                          </div>
                        </Suspense>
                      </div>

                      {/* Java Selection */}
                      <Suspense fallback={<ComponentLoader />}>
                        <JavaSelector
                          value={javaPath}
                          onChange={setJavaPath}
                          recommendedVersion={21}
                        />
                      </Suspense>

                      {/* JVM Arguments with Templates */}
                      <Suspense fallback={<ComponentLoader />}>
                        {(instance?.is_server || instance?.is_proxy) ? (
                          <ServerJvmTemplates
                            value={jvmArgs}
                            onChange={setJvmArgs}
                            ramMb={memoryMax}
                          />
                        ) : (
                          <JvmTemplates
                            value={jvmArgs}
                            onChange={setJvmArgs}
                            ramMb={memoryMax}
                            loader={instance?.loader || null}
                          />
                        )}
                      </Suspense>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Server Sub-Tab */}
              <TabsContent value="server" className="mt-0 data-[state=active]:block">
                <div className="space-y-4">
                  {/* Server Properties Card - only for servers */}
                  {(instance?.is_server || instance?.is_proxy) && (
                    <Card>
                      <CardHeader>
                        <CardTitle>{t("instanceDetails.serverProperties")}</CardTitle>
                        <CardDescription>
                          {t("instanceDetails.configureServerProperties")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Suspense fallback={<ComponentLoader />}>
                          <ServerPropertiesEditor
                            instanceId={instanceId!}
                            isRunning={isRunning}
                          />
                        </Suspense>
                      </CardContent>
                    </Card>
                  )}

                  {/* Create Server from Client Card - only for modded client instances */}
                  {!instance?.is_server && !instance?.is_proxy && instance?.loader &&
                   ["fabric", "forge", "neoforge", "quilt"].includes(instance.loader.toLowerCase()) && (
                    <Card>
                      <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-2">
                          <Server className="h-5 w-5" />
                          {t("serverFromClient.cardTitle")}
                          <Badge variant="secondary" className="bg-amber-500/20 text-amber-500 border-amber-500/30">
                            {t("serverFromClient.earlyBeta")}
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          {t("serverFromClient.cardDescription")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Beta warning */}
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
                          <p className="text-amber-500">
                            {t("serverFromClient.betaWarning")}
                          </p>
                        </div>
                        <Button onClick={() => navigate(`/instances/${instanceId}/create-server`)} className="gap-2">
                          <Server className="h-4 w-4" />
                          {t("serverFromClient.cardButton")}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </TabsContent>

        {/* Content Tab - Unified tabs for Installed + Browse content types */}
        {contentType !== "none" && (
        <TabsContent value="content" className="mt-4 overflow-y-auto">
          <Tabs defaultValue="installed">
            <TabsList className="flex-shrink-0 w-fit mb-4">
              <TabsTrigger value="installed" className="gap-2">
                <Package className="h-4 w-4" />
                {t("content.installed")}
              </TabsTrigger>
              <TabsTrigger value="mod" className="gap-2">
                <Search className="h-4 w-4" />
                {t("browse.mods")}
              </TabsTrigger>
              {/* Additional content types for client instances only */}
              {!instance.is_server && !instance.is_proxy && (
                <>
                  <TabsTrigger value="resourcepack" className="gap-2">
                    <Palette className="h-4 w-4" />
                    {t("browse.resourcePacks")}
                  </TabsTrigger>
                  <TabsTrigger value="shader" className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    {t("browse.shaders")}
                  </TabsTrigger>
                  <TabsTrigger value="datapack" className="gap-2">
                    <Database className="h-4 w-4" />
                    {t("browse.datapacks")}
                  </TabsTrigger>
                </>
              )}
            </TabsList>

            <TabsContent value="installed" className="mt-0">
              <ErrorBoundary>
                <Suspense fallback={<ComponentLoader />}>
                  <ModsList
                    key={modsRefreshKey}
                    instanceId={instanceId!}
                    contentType={contentType}
                    onOpenFolder={handleOpenModsFolder}
                    onModsChange={handleContentChanged}
                  />
                </Suspense>
              </ErrorBoundary>
            </TabsContent>

            <TabsContent value="mod" className="mt-0">
              <ErrorBoundary>
                <Suspense fallback={<ComponentLoader />}>
                  <ModrinthBrowser
                    instanceId={instanceId!}
                    mcVersion={instance.mc_version}
                    loader={instance.loader}
                    isServer={instance.is_server}
                    onModInstalled={handleContentChanged}
                    contentType="mod"
                  />
                </Suspense>
              </ErrorBoundary>
            </TabsContent>

            {!instance.is_server && !instance.is_proxy && (
              <>
                <TabsContent value="resourcepack" className="mt-0">
                  <ErrorBoundary>
                    <Suspense fallback={<ComponentLoader />}>
                      <ModrinthBrowser
                        instanceId={instanceId!}
                        mcVersion={instance.mc_version}
                        loader={instance.loader}
                        isServer={instance.is_server}
                        onModInstalled={handleContentChanged}
                        contentType="resourcepack"
                      />
                    </Suspense>
                  </ErrorBoundary>
                </TabsContent>

                <TabsContent value="shader" className="mt-0">
                  <ErrorBoundary>
                    <Suspense fallback={<ComponentLoader />}>
                      <ModrinthBrowser
                        instanceId={instanceId!}
                        mcVersion={instance.mc_version}
                        loader={instance.loader}
                        isServer={instance.is_server}
                        onModInstalled={handleContentChanged}
                        contentType="shader"
                      />
                    </Suspense>
                  </ErrorBoundary>
                </TabsContent>

                <TabsContent value="datapack" className="mt-0">
                  <ErrorBoundary>
                    <Suspense fallback={<ComponentLoader />}>
                      <ModrinthBrowser
                        instanceId={instanceId!}
                        mcVersion={instance.mc_version}
                        loader={instance.loader}
                        isServer={instance.is_server}
                        onModInstalled={handleContentChanged}
                        contentType="datapack"
                      />
                    </Suspense>
                  </ErrorBoundary>
                </TabsContent>
              </>
            )}
          </Tabs>
        </TabsContent>
        )}

        {/* Worlds Tab */}
        <TabsContent value="worlds" className="mt-4 overflow-y-auto">
          <ErrorBoundary>
            <Suspense fallback={<ComponentLoader />}>
              <WorldsTab
                instanceId={instanceId!}
                isServer={instance?.is_server || instance?.is_proxy || false}
              />
            </Suspense>
          </ErrorBoundary>
        </TabsContent>

        {/* Backups Tab */}
        <TabsContent value="backups" className="mt-4 overflow-y-auto">
          {easyMode ? (
            /* Easy Mode: Just auto-backup toggle */
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>{t("easyMode.simpleBackups")}</CardTitle>
                <CardDescription>{t("easyMode.simpleBackupsDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
                  <div className="space-y-0.5">
                    <Label className="text-base">{t("instanceDetails.autoBackup")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("instanceDetails.autoBackupDesc")}
                    </p>
                  </div>
                  <Switch
                    checked={autoBackupEnabled}
                    onCheckedChange={handleToggleAutoBackup}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Advanced Mode: Full backup options */
            <div className="space-y-4">
              {/* World Backups Card */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle>{t("instanceDetails.worldBackups")}</CardTitle>
                  <CardDescription>
                    {t("instanceDetails.worldBackupsDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{t("instanceDetails.autoBackup")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t("instanceDetails.autoBackupDesc")}
                      </p>
                    </div>
                    <Switch
                      checked={autoBackupEnabled}
                      onCheckedChange={handleToggleAutoBackup}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Full Instance Backup Card */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Archive className="h-5 w-5" />
                    {t("instanceDetails.fullInstanceBackup")}
                  </CardTitle>
                  <CardDescription>
                    {t("instanceDetails.fullInstanceBackupDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={handleCreateInstanceBackup}
                    disabled={isCreatingBackup}
                    className="gap-2"
                  >
                    {isCreatingBackup ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                    {isCreatingBackup
                      ? t("instanceDetails.creatingBackup")
                      : t("instanceDetails.createFullBackup")}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config" className="mt-4 overflow-y-auto">
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader className="flex-shrink-0 pb-2">
              <CardTitle>{t("instanceDetails.configEditor")}</CardTitle>
              <CardDescription>
                {t("instanceDetails.editConfigFiles")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0">
              <Suspense fallback={<ComponentLoader />}>
                <ConfigEditor instanceId={instanceId!} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tunnel Tab - Server only */}
        {(instance?.is_server || instance?.is_proxy) && (
          <TabsContent value="tunnel" className="mt-4 overflow-y-auto">
            <Suspense fallback={<ComponentLoader />}>
              <TunnelConfig
                instanceId={instanceId!}
                serverPort={25565}
                isServerRunning={isRunning}
              />
            </Suspense>
          </TabsContent>
        )}

      </Tabs>

      {/* Export Instance Dialog */}
      {instance && (
        <Suspense fallback={null}>
          <ExportInstanceDialog
            open={showExportDialog}
            onOpenChange={setShowExportDialog}
            instanceId={instance.id}
            instanceName={instance.name}
          />
        </Suspense>
      )}

      {/* Change Version Dialog */}
      {instance && (
        <Suspense fallback={null}>
          <ChangeVersionDialog
            open={showChangeVersionDialog}
            onOpenChange={setShowChangeVersionDialog}
            instance={instance}
            onSuccess={loadInstance}
          />
        </Suspense>
      )}

    </div>
  )
}
