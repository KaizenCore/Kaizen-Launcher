import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { useInstallationStore } from "@/stores/installationStore"
import { ArrowLeft, Settings, Package, Save, Loader2, FolderOpen, FileText, RefreshCw, ChevronDown, Search, ArrowUpDown, Filter, Download, Play, AlertCircle, Square, Copy, Check, ImageIcon, Link, X, ArrowUp, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslation } from "@/i18n"
import { Wrench, Terminal, Server, Globe } from "lucide-react"

// Lazy load heavy components - only loaded when their tab is selected
const RamSlider = lazy(() => import("@/components/RamSlider").then(m => ({ default: m.RamSlider })))
const JvmTemplates = lazy(() => import("@/components/JvmTemplates").then(m => ({ default: m.JvmTemplates })))
const ServerJvmTemplates = lazy(() => import("@/components/ServerJvmTemplates").then(m => ({ default: m.ServerJvmTemplates })))
const JavaSelector = lazy(() => import("@/components/JavaSelector").then(m => ({ default: m.JavaSelector })))
const ModrinthBrowser = lazy(() => import("@/components/ModrinthBrowser").then(m => ({ default: m.ModrinthBrowser })))
const ConfigEditor = lazy(() => import("@/components/ConfigEditor").then(m => ({ default: m.ConfigEditor })))
const ServerConsole = lazy(() => import("@/components/ServerConsole").then(m => ({ default: m.ServerConsole })))
const ServerPropertiesEditor = lazy(() => import("@/components/ServerPropertiesEditor").then(m => ({ default: m.ServerPropertiesEditor })))
const ServerStats = lazy(() => import("@/components/ServerStats").then(m => ({ default: m.ServerStats })))
const TunnelConfig = lazy(() => import("@/components/TunnelConfig").then(m => ({ default: m.TunnelConfig })))
const WorldsTab = lazy(() => import("@/components/WorldsTab").then(m => ({ default: m.WorldsTab })))

// Loading fallback for lazy components
function ComponentLoader() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "FATAL" | "TRACE" | "ALL"
type SortOption = "date-desc" | "date-asc" | "name-asc" | "name-desc" | "size-desc" | "size-asc"

const LOG_LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-500",
  FATAL: "text-red-600 font-bold",
  WARN: "text-yellow-500",
  WARNING: "text-yellow-500",
  INFO: "text-blue-400",
  DEBUG: "text-gray-400",
  TRACE: "text-gray-500",
}

const LOG_LEVEL_BG: Record<string, string> = {
  ERROR: "bg-red-500/10",
  FATAL: "bg-red-600/20",
  WARN: "bg-yellow-500/10",
  WARNING: "bg-yellow-500/10",
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
}

interface LogFileInfo {
  name: string
  size_bytes: number
  modified: string | null
}

interface ModInfo {
  name: string
  version: string
  filename: string
  enabled: boolean
  icon_url: string | null
  project_id: string | null
}

interface ModUpdateInfo {
  project_id: string
  filename: string
  current_version: string
  current_version_id: string | null
  latest_version: string
  latest_version_id: string
  name: string
  icon_url: string | null
}

// Determine what type of content this server/instance supports
type ContentType = "mods" | "plugins" | "none"

// Constants - defined outside component to avoid recreation on each render
const MODS_PER_PAGE = 10

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
  const [isSaving, setIsSaving] = useState(false)

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
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  // Logs state
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [selectedLog, setSelectedLog] = useState<string>("latest.log")
  const [logContent, setLogContent] = useState<string>("")
  const [isLoadingLogContent, setIsLoadingLogContent] = useState(false)
  const [autoScroll, _setAutoScroll] = useState(true)
  const logScrollRef = useRef<HTMLDivElement>(null)

  // Log filters and sorting
  const [logSortBy, setLogSortBy] = useState<SortOption>("date-desc")
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevel>("ALL")
  const [logSearch, setLogSearch] = useState<string>("")

  // Content type (mods vs plugins vs none)
  const contentType = useMemo(() => getContentType(instance?.loader || null, instance?.is_server || false), [instance?.loader, instance?.is_server])
  const contentLabel = useMemo(() => getContentLabel(contentType), [contentType])

  // Mods state
  const [mods, setMods] = useState<ModInfo[]>([])
  const [isLoadingMods, setIsLoadingMods] = useState(false)
  const [modUpdates, setModUpdates] = useState<ModUpdateInfo[]>([])
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [updatingMods, setUpdatingMods] = useState<Set<string>>(new Set())
  const [modsPage, setModsPage] = useState(1)
  const [modSearchQuery, setModSearchQuery] = useState("")
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set())
  const [isDeletingSelected, setIsDeletingSelected] = useState(false)

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

  const loadInstance = async () => {
    if (!instanceId) return
    try {
      const result = await invoke<Instance>("get_instance", { instanceId })
      setInstance(result)
      setName(result.name)
      setMemoryMin(result.memory_min_mb)
      setMemoryMax(result.memory_max_mb)
      setJavaPath(result.java_path || "")
      setJvmArgs(result.jvm_args || "")
    } catch (err) {
      console.error("Failed to load instance:", err)
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

  // Load mods for this instance - memoized to prevent unnecessary re-renders
  const loadMods = useCallback(async () => {
    if (!instanceId) return
    setIsLoadingMods(true)
    try {
      const modsData = await invoke<ModInfo[]>("get_instance_mods", { instanceId })
      setMods(modsData)
    } catch (err) {
      console.error("Failed to load mods:", err)
    } finally {
      setIsLoadingMods(false)
    }
  }, [instanceId])

  const handleToggleMod = useCallback(async (filename: string, enabled: boolean) => {
    if (!instanceId) return
    try {
      await invoke("toggle_mod", { instanceId, filename, enabled })
      toast.success(enabled ? t("instanceDetails.modEnabled") : t("instanceDetails.modDisabled"))
      loadMods()
    } catch (err) {
      toast.error(t("instanceDetails.modToggleError"))
      console.error("Failed to toggle mod:", err)
    }
  }, [instanceId, loadMods, t])

  const handleDeleteMod = useCallback(async (filename: string) => {
    if (!instanceId) return
    try {
      await invoke("delete_mod", { instanceId, filename })
      toast.success(t("notifications.modDeleted"))
      loadMods()
    } catch (err) {
      toast.error(t("instanceDetails.modDeleteError"))
      console.error("Failed to delete mod:", err)
    }
  }, [instanceId, loadMods, t])

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

  // Check for mod updates - memoized
  const checkModUpdates = useCallback(async () => {
    if (!instanceId) return
    setIsCheckingUpdates(true)
    try {
      const updates = await invoke<ModUpdateInfo[]>("check_mod_updates", {
        instanceId,
        projectType: contentType === "plugins" ? "plugin" : "mod",
      })
      setModUpdates(updates)
      if (updates.length > 0) {
        toast.success(t("instanceDetails.updatesFound", { count: String(updates.length) }))
      } else {
        toast.success(t("instanceDetails.noUpdatesFound"))
      }
    } catch (err) {
      console.error("Failed to check updates:", err)
      toast.error(t("instanceDetails.checkUpdatesError"))
    } finally {
      setIsCheckingUpdates(false)
    }
  }, [instanceId, contentType, t])

  // Update a single mod - memoized
  const handleUpdateMod = useCallback(async (update: ModUpdateInfo) => {
    if (!instanceId) return
    setUpdatingMods(prev => new Set(prev).add(update.project_id))
    try {
      await invoke("update_mod", {
        instanceId,
        projectId: update.project_id,
        currentFilename: update.filename,
        newVersionId: update.latest_version_id,
        projectType: contentType === "plugins" ? "plugin" : "mod",
      })
      toast.success(t("instanceDetails.modUpdated", { name: update.name }))
      // Remove from updates list
      setModUpdates(prev => prev.filter(u => u.project_id !== update.project_id))
      // Reload mods list
      loadMods()
    } catch (err) {
      console.error("Failed to update mod:", err)
      toast.error(t("instanceDetails.modUpdateError", { name: update.name }))
    } finally {
      setUpdatingMods(prev => {
        const newSet = new Set(prev)
        newSet.delete(update.project_id)
        return newSet
      })
    }
  }, [instanceId, contentType, loadMods, t])

  // Update all mods - uses ref to avoid stale closure
  const modUpdatesRef = useRef(modUpdates)
  modUpdatesRef.current = modUpdates

  const handleUpdateAllMods = useCallback(async () => {
    for (const update of modUpdatesRef.current) {
      await handleUpdateMod(update)
    }
  }, [handleUpdateMod])

  // Toggle mod selection
  const toggleModSelection = useCallback((filename: string) => {
    setSelectedMods(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filename)) {
        newSet.delete(filename)
      } else {
        newSet.add(filename)
      }
      return newSet
    })
  }, [])

  // Deselect all mods
  const deselectAllMods = useCallback(() => {
    setSelectedMods(new Set())
  }, [])

  // Check if a mod has an update available - memoized
  const getModUpdate = useCallback((mod: ModInfo): ModUpdateInfo | undefined => {
    if (!mod.project_id) return undefined
    return modUpdates.find(u => u.project_id === mod.project_id)
  }, [modUpdates])

  // Filter mods by search query
  const filteredMods = useMemo(() => {
    if (!modSearchQuery.trim()) return mods
    const query = modSearchQuery.toLowerCase()
    return mods.filter(mod =>
      mod.name.toLowerCase().includes(query) ||
      mod.filename.toLowerCase().includes(query)
    )
  }, [mods, modSearchQuery])

  // Pagination for mods - memoized
  const totalModsPages = useMemo(() => Math.ceil(filteredMods.length / MODS_PER_PAGE), [filteredMods.length])
  const paginatedMods = useMemo(() => {
    const start = (modsPage - 1) * MODS_PER_PAGE
    return filteredMods.slice(start, start + MODS_PER_PAGE)
  }, [filteredMods, modsPage])

  // Select all filtered mods (defined after filteredMods)
  const selectAllMods = useCallback(() => {
    setSelectedMods(new Set(filteredMods.map(m => m.filename)))
  }, [filteredMods])

  // Delete selected mods
  const handleDeleteSelectedMods = useCallback(async () => {
    if (!instanceId || selectedMods.size === 0) return
    setIsDeletingSelected(true)
    try {
      let deleted = 0
      for (const filename of selectedMods) {
        await invoke("delete_mod", { instanceId, filename })
        deleted++
      }
      toast.success(t("instanceDetails.modsDeleted", { count: String(deleted) }))
      setSelectedMods(new Set())
      loadMods()
    } catch (err) {
      toast.error(t("instanceDetails.modDeleteError"))
      console.error("Failed to delete mods:", err)
    } finally {
      setIsDeletingSelected(false)
    }
  }, [instanceId, selectedMods, loadMods, t])

  // Update selected mods (only those with updates available)
  const handleUpdateSelectedMods = useCallback(async () => {
    const selectedUpdates = modUpdates.filter(u => {
      const mod = mods.find(m => m.project_id === u.project_id)
      return mod && selectedMods.has(mod.filename)
    })
    if (selectedUpdates.length === 0) {
      toast.info(t("instanceDetails.noUpdatesForSelected"))
      return
    }
    for (const update of selectedUpdates) {
      await handleUpdateMod(update)
    }
    setSelectedMods(new Set())
  }, [modUpdates, mods, selectedMods, handleUpdateMod, t])

  // Callback when content is changed - memoized
  const handleContentChanged = useCallback(() => {
    loadMods()
  }, [loadMods])

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
    setIsLaunching(true)
    setLaunchError(null)

    // Auto-backup worlds before launch if enabled
    if (autoBackupEnabled) {
      toast.loading(t("instanceDetails.backingUpWorlds"), { id: "auto-backup" })
      try {
        await invoke("auto_backup_worlds", { instanceId })
        toast.success(t("instanceDetails.backupComplete"), { id: "auto-backup" })
      } catch (err) {
        console.warn("Auto-backup failed:", err)
        toast.warning(t("instanceDetails.backupWarning"), { id: "auto-backup" })
      }
    }

    toast.loading(t("instanceDetails.starting"), { id: "launch-instance" })
    try {
      await invoke("launch_instance", { instanceId, accountId: activeAccountId })
      toast.success(t("instanceDetails.started"), { id: "launch-instance" })
    } catch (err) {
      console.error("Failed to launch instance:", err)
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
    try {
      await invoke("stop_instance", { instanceId })
      toast.success(t("instances.instanceStopped"))
    } catch (err) {
      console.error("Failed to stop instance:", err)
      setLaunchError(`${t("instances.unableToStop")}: ${err}`)
      toast.error(`${t("instances.unableToStop")}: ${err}`)
    }
  }

  const loadLogs = async () => {
    if (!instanceId) return
    setIsLoadingLogs(true)
    try {
      const result = await invoke<LogFileInfo[]>("get_instance_logs", { instanceId })
      setLogFiles(result)
      // Select latest.log by default if available
      if (result.length > 0) {
        const latestLog = result.find(l => l.name === "latest.log")
        if (latestLog) {
          setSelectedLog("latest.log")
        } else {
          setSelectedLog(result[0].name)
        }
      }
    } catch (err) {
      console.error("Failed to load logs:", err)
      setLogFiles([])
    } finally {
      setIsLoadingLogs(false)
    }
  }

  const loadLogContent = async (logName: string) => {
    if (!instanceId || !logName) return
    setIsLoadingLogContent(true)
    try {
      const content = await invoke<string>("read_instance_log", {
        instanceId,
        logName,
        tailLines: 1000 // Limit to last 1000 lines
      })
      setLogContent(content)
      // Auto-scroll to bottom
      if (autoScroll && logScrollRef.current) {
        setTimeout(() => {
          if (logScrollRef.current) {
            logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
          }
        }, 100)
      }
    } catch (err) {
      console.error("Failed to load log content:", err)
      setLogContent("")
    } finally {
      setIsLoadingLogContent(false)
    }
  }

  const handleOpenLogsFolder = async () => {
    if (!instanceId) return
    try {
      await invoke("open_logs_folder", { instanceId })
    } catch (err) {
      console.error("Failed to open logs folder:", err)
    }
  }

  // Sort log files
  const sortedLogFiles = useMemo(() => {
    const sorted = [...logFiles]
    switch (logSortBy) {
      case "date-desc":
        return sorted.sort((a, b) => {
          if (!a.modified && !b.modified) return 0
          if (!a.modified) return 1
          if (!b.modified) return -1
          return new Date(b.modified).getTime() - new Date(a.modified).getTime()
        })
      case "date-asc":
        return sorted.sort((a, b) => {
          if (!a.modified && !b.modified) return 0
          if (!a.modified) return 1
          if (!b.modified) return -1
          return new Date(a.modified).getTime() - new Date(b.modified).getTime()
        })
      case "name-asc":
        return sorted.sort((a, b) => a.name.localeCompare(b.name))
      case "name-desc":
        return sorted.sort((a, b) => b.name.localeCompare(a.name))
      case "size-desc":
        return sorted.sort((a, b) => b.size_bytes - a.size_bytes)
      case "size-asc":
        return sorted.sort((a, b) => a.size_bytes - b.size_bytes)
      default:
        return sorted
    }
  }, [logFiles, logSortBy])

  // Parse log level from line
  const getLogLevel = (line: string): string | null => {
    // Common Minecraft/Java log formats:
    // [HH:MM:SS] [Thread/LEVEL]: message
    // [HH:MM:SS] [LEVEL]: message
    // [LEVEL] message
    const patterns = [
      /\[(?:Thread[^/]*\/)?(\bERROR\b|\bWARN(?:ING)?\b|\bINFO\b|\bDEBUG\b|\bFATAL\b|\bTRACE\b)\]/i,
      /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|TRACE)\b:?/i,
    ]
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match) {
        const level = match[1].toUpperCase()
        return level === "WARNING" ? "WARN" : level
      }
    }
    return null
  }

  // Filter and process log content
  const processedLogLines = useMemo(() => {
    if (!logContent) return []

    let lines = logContent.split("\n")

    // Filter by log level
    if (logLevelFilter !== "ALL") {
      lines = lines.filter(line => {
        const level = getLogLevel(line)
        return level === logLevelFilter
      })
    }

    // Filter by search
    if (logSearch.trim()) {
      const searchLower = logSearch.toLowerCase()
      lines = lines.filter(line => line.toLowerCase().includes(searchLower))
    }

    return lines
  }, [logContent, logLevelFilter, logSearch])

  // Count log levels for badges
  const logLevelCounts = useMemo(() => {
    if (!logContent) return { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 }

    const counts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, FATAL: 0, TRACE: 0 }
    const lines = logContent.split("\n")

    for (const line of lines) {
      const level = getLogLevel(line)
      if (level && level in counts) {
        counts[level as keyof typeof counts]++
      }
    }

    return counts
  }, [logContent])

  // Load saved tunnel URL
  const loadTunnelUrl = useCallback(async () => {
    if (!instanceId) return
    try {
      const config = await invoke<{ tunnel_url: string | null } | null>("get_tunnel_config", { instanceId })
      console.log("Loaded tunnel config:", config, "tunnel_url:", config?.tunnel_url)
      if (config?.tunnel_url) {
        console.log("Setting tunnel URL:", config.tunnel_url)
        setTunnelUrl(config.tunnel_url)
      } else {
        console.log("No tunnel_url in config")
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
      loadMods(),
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
              console.log("Tunnel URL saved from InstanceDetails:", event.payload.url)
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

  useEffect(() => {
    if (selectedLog) {
      loadLogContent(selectedLog)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLog])

  const handleSaveSettings = async () => {
    if (!instanceId) return
    setIsSaving(true)
    try {
      await invoke("update_instance_settings", {
        instanceId,
        name,
        memoryMinMb: memoryMin,
        memoryMaxMb: memoryMax,
        javaPath: javaPath || null,
        jvmArgs: jvmArgs || null,
      })
      await loadInstance()
      toast.success(t("notifications.settingsSaved"))
    } catch (err) {
      console.error("Failed to save settings:", err)
      toast.error(t("errors.saveError"))
    } finally {
      setIsSaving(false)
    }
  }

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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/instances")}>
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
          >
            <FolderOpen className="h-5 w-5" />
          </Button>

          {launchError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span className="max-w-[200px] truncate">{launchError}</span>
            </div>
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
      <Tabs defaultValue={instance?.is_server || instance?.is_proxy ? "console" : "settings"} className="flex-1">
        <TabsList>
          {/* Console tab - only for servers */}
          {(instance?.is_server || instance?.is_proxy) && (
            <TabsTrigger value="console" className="gap-2">
              <Terminal className="h-4 w-4" />
              Console
            </TabsTrigger>
          )}
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            {t("common.settings")}
          </TabsTrigger>
          {contentType !== "none" && (
            <TabsTrigger value="mods" className="gap-2">
              <Package className="h-4 w-4" />
              {contentLabel.plural}
            </TabsTrigger>
          )}
          {contentType !== "none" && (
            <TabsTrigger value="content" className="gap-2">
              <Search className="h-4 w-4" />
              {t("content.manageContent")}
            </TabsTrigger>
          )}
          <TabsTrigger value="worlds" className="gap-2">
            <Globe className="h-4 w-4" />
            {t("instanceDetails.worlds")}
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2" onClick={() => loadLogs()}>
            <FileText className="h-4 w-4" />
            {t("instances.logs")}
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2">
            <Wrench className="h-4 w-4" />
            Config
          </TabsTrigger>
          {/* Tunnel tab - only for servers */}
          {(instance?.is_server || instance?.is_proxy) && (
            <TabsTrigger value="tunnel" className="gap-2">
              <Globe className="h-4 w-4" />
              Tunnel
            </TabsTrigger>
          )}
        </TabsList>

        {/* Console Tab - Server only */}
        {(instance?.is_server || instance?.is_proxy) && (
          <TabsContent value="console" className="mt-4 space-y-4">
            {/* Server Stats */}
            <Suspense fallback={<ComponentLoader />}>
              <ServerStats
                instanceId={instanceId!}
                isRunning={isRunning}
              />
            </Suspense>

            {/* Server Addresses */}
            {isRunning && (
              <Card className="border-green-500/30 bg-green-500/5">
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

            {/* Console */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("instanceDetails.serverConsole")}</CardTitle>
                    <CardDescription>
                      {t("instanceDetails.viewLogsRealtime")}
                    </CardDescription>
                  </div>
                  {isRunning && (
                    <Badge variant="secondary" className="bg-green-500/20 text-green-500">
                      <Server className="h-3 w-3 mr-1" />
                      {t("instanceDetails.online")}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<ComponentLoader />}>
                  <ServerConsole
                    instanceId={instanceId!}
                    isRunning={isRunning}
                  />
                </Suspense>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          {/* General Settings Card */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>{t("instances.settings")}</CardTitle>
              <CardDescription>
                {t("instanceDetails.configureOptions")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Name and Icon row */}
              <div className="grid gap-4 md:grid-cols-[1fr,auto]">
                {/* Instance Name */}
                <div className="space-y-2">
                  <Label htmlFor="name">{t("instanceDetails.instanceName")}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("createInstance.namePlaceholder")}
                  />
                </div>

                {/* Instance Icon - Compact */}
                <div className="space-y-2">
                  <Label>{t("instanceDetails.icon")}</Label>
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
                    <div className="relative flex-1 min-w-[200px]">
                      <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={iconInputUrl}
                        onChange={(e) => setIconInputUrl(e.target.value)}
                        placeholder="URL de l'image..."
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
                      Fichier
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
              </div>

              {/* Memory Settings - Side by side on larger screens */}
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

              {/* Save Button */}
              <Button onClick={handleSaveSettings} disabled={isSaving} className="gap-2">
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("common.save")}
              </Button>
            </CardContent>
          </Card>

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
        </TabsContent>

        {/* Installed Mods/Plugins Tab */}
        {contentType !== "none" && (
        <TabsContent value="mods" className="mt-4 flex flex-col flex-1 min-h-0">
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="flex items-center gap-2">
                    {t("instanceDetails.installedMods")}
                    {mods.length > 0 && (
                      <Badge variant="secondary">{mods.length}</Badge>
                    )}
                  </CardTitle>
                  {modUpdates.length > 0 && (
                    <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                      {modUpdates.length} {t("instanceDetails.updatesAvailable")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {modUpdates.length > 0 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleUpdateAllMods}
                      disabled={updatingMods.size > 0}
                      className="gap-2 bg-green-500 hover:bg-green-600"
                    >
                      <ArrowUp className="h-4 w-4" />
                      {t("instanceDetails.updateAll")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkModUpdates}
                    disabled={isCheckingUpdates || mods.length === 0}
                    className="gap-2"
                  >
                    {isCheckingUpdates ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {t("instanceDetails.checkUpdates")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpenModsFolder} className="gap-2">
                    <FolderOpen className="h-4 w-4" />
                    {t("common.openFolder")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 pt-0">
              {/* Search bar and batch actions for mods */}
              {mods.length > 0 && (
                <div className="space-y-3 mb-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t("instanceDetails.searchMods")}
                      value={modSearchQuery}
                      onChange={(e) => {
                        setModSearchQuery(e.target.value)
                        setModsPage(1) // Reset to first page when searching
                      }}
                      className="pl-9"
                    />
                  </div>
                  {/* Batch actions bar */}
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="select-all-mods"
                        checked={selectedMods.size > 0 && selectedMods.size === filteredMods.length}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            selectAllMods()
                          } else {
                            deselectAllMods()
                          }
                        }}
                      />
                      <label htmlFor="select-all-mods" className="text-muted-foreground cursor-pointer">
                        {selectedMods.size > 0
                          ? t("instanceDetails.selectedCount", { count: String(selectedMods.size) })
                          : t("instanceDetails.selectAll")}
                      </label>
                    </div>
                    {selectedMods.size > 0 && (
                      <div className="flex items-center gap-2 ml-auto">
                        {modUpdates.some(u => {
                          const mod = mods.find(m => m.project_id === u.project_id)
                          return mod && selectedMods.has(mod.filename)
                        }) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleUpdateSelectedMods}
                            disabled={updatingMods.size > 0}
                            className="gap-1 h-7 text-xs"
                          >
                            <ArrowUp className="h-3 w-3" />
                            {t("instanceDetails.updateSelected")}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDeleteSelectedMods}
                          disabled={isDeletingSelected}
                          className="gap-1 h-7 text-xs text-destructive hover:text-destructive"
                        >
                          {isDeletingSelected ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          {t("instanceDetails.deleteSelected")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {isLoadingMods ? (
                <div className="flex items-center justify-center py-8 flex-1">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : mods.length === 0 ? (
                <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">{t("instanceDetails.noModInstalled")}</p>
                  <p className="text-sm text-muted-foreground">{t("instanceDetails.useModrinth")}</p>
                </div>
              ) : filteredMods.length === 0 ? (
                <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t("instances.noResults")}</p>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex-1 min-h-0 overflow-auto">
                    <div className="space-y-2 pr-2">
                      {paginatedMods.map((mod) => {
                        const update = getModUpdate(mod)
                        const isUpdating = mod.project_id ? updatingMods.has(mod.project_id) : false

                        return (
                          <div
                            key={mod.filename}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                              !mod.enabled ? "opacity-50 bg-muted/30" : ""
                            } ${update ? "border-green-500/50 bg-green-500/5" : ""} ${
                              selectedMods.has(mod.filename) ? "bg-accent/50 border-primary/50" : ""
                            }`}
                          >
                            <Checkbox
                              checked={selectedMods.has(mod.filename)}
                              onCheckedChange={() => toggleModSelection(mod.filename)}
                              className="flex-shrink-0"
                            />
                            {mod.icon_url ? (
                              <img
                                src={mod.icon_url}
                                alt={mod.name}
                                className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                                <Package className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{mod.name}</p>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-muted-foreground truncate">{mod.version}</p>
                                {update && (
                                  <Badge variant="outline" className="text-xs text-green-500 border-green-500/50">
                                    → {update.latest_version}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {update && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleUpdateMod(update)}
                                  disabled={isUpdating}
                                  className="gap-1 bg-green-500 hover:bg-green-600"
                                >
                                  {isUpdating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <ArrowUp className="h-3 w-3" />
                                  )}
                                  {t("common.update")}
                                </Button>
                              )}
                              <Switch
                                checked={mod.enabled}
                                onCheckedChange={(checked) => handleToggleMod(mod.filename, checked)}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteMod(mod.filename)}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {/* Pagination */}
                  {totalModsPages > 1 && (
                    <div className="flex items-center justify-between pt-4 border-t mt-4">
                      <p className="text-sm text-muted-foreground">
                        {t("modpack.page", { current: String(modsPage), total: String(totalModsPages) })}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setModsPage(p => Math.max(1, p - 1))}
                          disabled={modsPage === 1}
                          className="h-8 w-8"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setModsPage(p => Math.min(totalModsPages, p + 1))}
                          disabled={modsPage === totalModsPages}
                          className="h-8 w-8"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* Browse Content Tab (Modrinth with tabs for different content types) */}
        {contentType !== "none" && (
        <TabsContent value="content" className="mt-4">
          <Suspense fallback={<ComponentLoader />}>
            <ModrinthBrowser
              instanceId={instanceId!}
              mcVersion={instance.mc_version}
              loader={instance.loader}
              isServer={instance.is_server}
              onModInstalled={handleContentChanged}
              showContentTabs={!instance.is_server && !instance.is_proxy}
            />
          </Suspense>
        </TabsContent>
        )}

        {/* Worlds Tab */}
        <TabsContent value="worlds" className="mt-4 flex flex-col flex-1 min-h-0">
          <Suspense fallback={<ComponentLoader />}>
            <WorldsTab
              instanceId={instanceId!}
              isServer={instance?.is_server || instance?.is_proxy || false}
            />
          </Suspense>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("instanceDetails.instanceLogs")}</CardTitle>
                  <CardDescription>
                    {t("instanceDetails.viewLogs")}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadLogContent(selectedLog)}
                    disabled={isLoadingLogContent}
                    className="gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isLoadingLogContent ? "animate-spin" : ""}`} />
                    {t("common.refresh")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpenLogsFolder} className="gap-2">
                    <FolderOpen className="h-4 w-4" />
                    {t("common.openFolder")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoadingLogs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : logFiles.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">{t("instanceDetails.noLogFiles")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("instanceDetails.logsAppearAfterLaunch")}
                  </p>
                </div>
              ) : (
                <>
                  {/* File selector and sorting */}
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium whitespace-nowrap">{t("instanceDetails.file")}:</Label>
                      <Select value={selectedLog} onValueChange={setSelectedLog}>
                        <SelectTrigger className="w-[220px]">
                          <SelectValue placeholder={t("instanceDetails.selectFile")} />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedLogFiles.map((log) => (
                            <SelectItem key={log.name} value={log.name}>
                              <div className="flex items-center justify-between gap-4">
                                <span className="truncate max-w-[140px]">{log.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {(log.size_bytes / 1024).toFixed(1)} KB
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      <Select value={logSortBy} onValueChange={(v) => setLogSortBy(v as SortOption)}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue placeholder={t("instances.sortBy")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="date-desc">{t("instanceDetails.sortDateRecent")}</SelectItem>
                          <SelectItem value="date-asc">{t("instanceDetails.sortDateOld")}</SelectItem>
                          <SelectItem value="name-asc">{t("instanceDetails.sortNameAZ")}</SelectItem>
                          <SelectItem value="name-desc">{t("instanceDetails.sortNameZA")}</SelectItem>
                          <SelectItem value="size-desc">{t("instanceDetails.sortSizeLarge")}</SelectItem>
                          <SelectItem value="size-asc">{t("instanceDetails.sortSizeSmall")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {logFiles.find(l => l.name === selectedLog)?.modified && (
                      <span className="text-xs text-muted-foreground">
                        {t("instanceDetails.modified")} {logFiles.find(l => l.name === selectedLog)?.modified}
                      </span>
                    )}
                  </div>

                  {/* Log level badges and stats */}
                  <div className="flex flex-wrap items-center gap-2">
                    {logLevelCounts.ERROR > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        ERROR: {logLevelCounts.ERROR}
                      </Badge>
                    )}
                    {logLevelCounts.WARN > 0 && (
                      <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-600 hover:bg-yellow-500/30">
                        WARN: {logLevelCounts.WARN}
                      </Badge>
                    )}
                    {logLevelCounts.INFO > 0 && (
                      <Badge variant="secondary" className="gap-1 bg-blue-500/20 text-blue-500 hover:bg-blue-500/30">
                        INFO: {logLevelCounts.INFO}
                      </Badge>
                    )}
                    {logLevelCounts.DEBUG > 0 && (
                      <Badge variant="secondary" className="gap-1">
                        DEBUG: {logLevelCounts.DEBUG}
                      </Badge>
                    )}
                  </div>

                  {/* Filters row */}
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px] max-w-[400px]">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={t("instanceDetails.searchInLogs")}
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>

                    {/* Level filter */}
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <Select value={logLevelFilter} onValueChange={(v) => setLogLevelFilter(v as LogLevel)}>
                        <SelectTrigger className="w-[140px]">
                          <SelectValue placeholder={t("instanceDetails.filterByLevel")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{t("instanceDetails.allLevels")}</SelectItem>
                          <SelectItem value="ERROR">
                            <span className="text-red-500">ERROR</span>
                          </SelectItem>
                          <SelectItem value="WARN">
                            <span className="text-yellow-500">WARN</span>
                          </SelectItem>
                          <SelectItem value="INFO">
                            <span className="text-blue-400">INFO</span>
                          </SelectItem>
                          <SelectItem value="DEBUG">
                            <span className="text-gray-400">DEBUG</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Results count */}
                    <span className="text-xs text-muted-foreground">
                      {processedLogLines.length} {t("instanceDetails.lines")}
                      {(logLevelFilter !== "ALL" || logSearch) && ` (${t("instanceDetails.filtered")})`}
                    </span>
                  </div>

                  {/* Log content viewer with colors */}
                  {isLoadingLogContent ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <ScrollArea
                      className="h-[400px] rounded-md border bg-zinc-950"
                      ref={logScrollRef}
                    >
                      <div className="p-4 text-xs font-mono">
                        {processedLogLines.length === 0 ? (
                          <span className="text-muted-foreground">{t("instanceDetails.noContent")}</span>
                        ) : (
                          processedLogLines.map((line, index) => {
                            const level = getLogLevel(line)
                            const colorClass = level ? LOG_LEVEL_COLORS[level] || "" : ""
                            const bgClass = level ? LOG_LEVEL_BG[level] || "" : ""

                            // Highlight search term
                            let displayLine = line
                            if (logSearch.trim()) {
                              const regex = new RegExp(`(${logSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
                              displayLine = line.replace(regex, '<mark class="bg-yellow-500/50 text-white rounded px-0.5">$1</mark>')
                            }

                            return (
                              <div
                                key={index}
                                className={`whitespace-pre-wrap break-all py-0.5 ${colorClass} ${bgClass} ${bgClass ? "px-1 -mx-1 rounded" : ""}`}
                                dangerouslySetInnerHTML={{ __html: displayLine }}
                              />
                            )
                          })
                        )}
                      </div>
                      {autoScroll && processedLogLines.length > 0 && (
                        <div className="sticky bottom-2 right-2 flex justify-end pr-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1 text-xs"
                            onClick={() => {
                              if (logScrollRef.current) {
                                logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
                              }
                            }}
                          >
                            <ChevronDown className="h-3 w-3" />
                            {t("instanceDetails.goToBottom")}
                          </Button>
                        </div>
                      )}
                    </ScrollArea>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("instanceDetails.configEditor")}</CardTitle>
              <CardDescription>
                {t("instanceDetails.editConfigFiles")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<ComponentLoader />}>
                <ConfigEditor instanceId={instanceId!} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tunnel Tab - Server only */}
        {(instance?.is_server || instance?.is_proxy) && (
          <TabsContent value="tunnel" className="mt-4">
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
    </div>
  )
}
