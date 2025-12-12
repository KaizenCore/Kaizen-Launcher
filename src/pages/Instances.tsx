import { useState, useEffect, useMemo, memo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useInstallationStore } from "@/stores/installationStore"
import { useSharingStore } from "@/stores/sharingStore"
import { Plus, Play, Trash2, Download, Loader2, Coffee, Monitor, Server, Network, Square, Circle, Search, Star, LayoutGrid, LayoutList, Columns, ArrowUpDown, FolderDown } from "lucide-react"
import { toast } from "sonner"
import { useTranslation, TranslationKey } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CreateInstanceDialog } from "@/components/dialogs/CreateInstanceDialog"
import { DeleteInstanceDialog } from "@/components/dialogs/DeleteInstanceDialog"
import { ImportInstanceDialog } from "@/components/sharing/ImportInstanceDialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

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
  is_server: boolean
  is_proxy: boolean
}

interface Account {
  id: string
  username: string
  is_active: boolean
}

interface InstallProgress {
  stage: string
  current: number
  total: number
  message: string
}

interface JavaInfo {
  version: string
  path: string
  is_bundled: boolean
}

type InstanceTab = "client" | "server" | "proxy"
type ViewMode = "grid" | "list" | "compact"
type SortBy = "name" | "last_played" | "playtime" | "version"

// Memoized instance card props
interface InstanceCardProps {
  instance: Instance
  viewMode: ViewMode
  isInstalled: boolean
  isInstalling: boolean
  isLaunching: boolean
  launchStep: string | null
  isRunning: boolean
  isStopping: boolean
  iconUrl: string | null
  isFavorite: boolean
  installProgress: InstallProgress | null
  onNavigate: (id: string) => void
  onToggleFavorite: (id: string) => void
  onLaunch: (instance: Instance) => void
  onInstall: (instance: Instance) => void
  onStop: (id: string) => void
  onDelete: (instance: Instance) => void
  formatPlaytime: (seconds: number) => string
  t: (key: TranslationKey) => string
}

// Memoized card component to prevent unnecessary re-renders
const InstanceCard = memo(function InstanceCard({
  instance,
  viewMode,
  isInstalled,
  isInstalling,
  isLaunching,
  launchStep,
  isRunning,
  isStopping,
  iconUrl,
  isFavorite,
  installProgress,
  onNavigate,
  onToggleFavorite,
  onLaunch,
  onInstall,
  onStop,
  onDelete,
  formatPlaytime,
  t,
}: InstanceCardProps) {
  // Helper to get launch step text
  const getLaunchStepText = () => {
    if (!launchStep) return t("home.launching")
    switch (launchStep) {
      case "preparing": return t("launch.preparing")
      case "checking_java": return t("launch.checking_java")
      case "building_args": return t("launch.building_args")
      case "starting": return t("launch.starting")
      default: return t("home.launching")
    }
  }
  if (viewMode === "list") {
    return (
      <div
        className={cn(
          "flex items-center gap-4 p-3 rounded-lg border bg-card cursor-pointer transition-colors hover:bg-accent/50",
          isRunning && "border-green-500/50"
        )}
        onClick={() => onNavigate(instance.id)}
      >
        {/* Favorite button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(instance.id)
          }}
        >
          <Star className={cn("h-4 w-4", isFavorite && "fill-yellow-500 text-yellow-500")} />
        </Button>

        {/* Icon */}
        <div className={cn(
          "h-10 w-10 rounded-lg flex items-center justify-center relative overflow-hidden shrink-0",
          isRunning ? "bg-green-500/20" : "bg-muted"
        )}>
          {iconUrl ? (
            <img src={iconUrl} alt={instance.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-bold">{instance.name.charAt(0).toUpperCase()}</span>
          )}
          {isRunning && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{instance.name}</span>
            {isRunning && (
              <span className="inline-flex items-center gap-1 text-xs text-green-500 font-medium">
                <Circle className="h-2 w-2 fill-current" />
                {t("instances.running")}
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {instance.mc_version}
            {instance.loader && ` - ${instance.loader}`}
            {!isInstalled && !isInstalling && (
              <span className="ml-2 text-yellow-500">({t("instances.notInstalled")})</span>
            )}
          </div>
        </div>

        {/* Playtime */}
        <div className="text-sm text-muted-foreground hidden md:block">
          {instance.total_playtime_seconds > 0 && formatPlaytime(instance.total_playtime_seconds)}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <Button size="sm" variant="destructive" onClick={() => onStop(instance.id)} disabled={isStopping}>
              {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            </Button>
          ) : isInstalled ? (
            <Button size="sm" onClick={() => onLaunch(instance)} disabled={isLaunching}>
              {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            </Button>
          ) : (
            <Button size="sm" onClick={() => onInstall(instance)} disabled={isInstalling}>
              {isInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onDelete(instance)} disabled={isInstalling || isLaunching || isRunning}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (viewMode === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-2 rounded-md border bg-card cursor-pointer transition-colors hover:bg-accent/50",
          isRunning && "border-green-500/50"
        )}
        onClick={() => onNavigate(instance.id)}
      >
        {/* Favorite */}
        <button
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(instance.id)
          }}
        >
          <Star className={cn("h-3.5 w-3.5", isFavorite ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground")} />
        </button>

        {/* Icon */}
        <div className={cn(
          "h-7 w-7 rounded flex items-center justify-center relative overflow-hidden shrink-0",
          isRunning ? "bg-green-500/20" : "bg-muted"
        )}>
          {iconUrl ? (
            <img src={iconUrl} alt={instance.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-bold">{instance.name.charAt(0).toUpperCase()}</span>
          )}
          {isRunning && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500"></span>
          )}
        </div>

        {/* Name */}
        <span className="flex-1 text-sm font-medium truncate">{instance.name}</span>

        {/* Version */}
        <span className="text-xs text-muted-foreground hidden sm:block">
          {instance.mc_version}
        </span>

        {/* Quick action */}
        <div onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onStop(instance.id)} disabled={isStopping}>
              {isStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            </Button>
          ) : isInstalled ? (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onLaunch(instance)} disabled={isLaunching}>
              {isLaunching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onInstall(instance)} disabled={isInstalling}>
              {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Grid view (default) - Modern card design
  return (
    <div
      className={cn(
        "group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300",
        "bg-gradient-to-br from-card to-card/80",
        "border border-border/50 hover:border-border",
        "hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5",
        isRunning && "border-green-500/50 shadow-green-500/10"
      )}
      onClick={() => onNavigate(instance.id)}
    >
      {/* Background image/gradient overlay */}
      <div className="absolute inset-0 opacity-10">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover blur-2xl scale-150"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-transparent" />
        )}
      </div>

      {/* Content */}
      <div className="relative p-4">
        {/* Header with icon and favorite */}
        <div className="flex items-start justify-between mb-3">
          <div className={cn(
            "h-14 w-14 rounded-xl flex items-center justify-center relative overflow-hidden",
            "bg-background/80 backdrop-blur-sm border border-border/50",
            "shadow-sm",
            isRunning && "ring-2 ring-green-500/50"
          )}>
            {iconUrl ? (
              <img
                src={iconUrl}
                alt={instance.name}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = "none"
                }}
              />
            ) : (
              <span className="text-2xl font-bold bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
                {instance.name.charAt(0).toUpperCase()}
              </span>
            )}
            {isRunning && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500 border-2 border-background"></span>
              </span>
            )}
          </div>

          {/* Favorite button */}
          <button
            className={cn(
              "p-2 rounded-lg transition-all",
              "opacity-0 group-hover:opacity-100",
              isFavorite && "opacity-100",
              "hover:bg-background/50"
            )}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(instance.id)
            }}
          >
            <Star className={cn(
              "h-4 w-4 transition-colors",
              isFavorite ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"
            )} />
          </button>
        </div>

        {/* Title and info */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-base truncate">{instance.name}</h3>
            {isRunning && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-xs font-medium">
                <Circle className="h-1.5 w-1.5 fill-current" />
                {t("instances.running")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="px-2 py-0.5 rounded-md bg-muted/50 text-xs font-medium">
              {instance.mc_version}
            </span>
            {instance.loader && (
              <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">
                {instance.loader}
              </span>
            )}
            {!isInstalled && !isInstalling && (
              <span className="px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-500 text-xs font-medium">
                {t("instances.notInstalled")}
              </span>
            )}
          </div>
        </div>

        {/* Playtime info */}
        {instance.total_playtime_seconds > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <Play className="h-3 w-3" />
            <span>{formatPlaytime(instance.total_playtime_seconds)}</span>
          </div>
        )}

        {/* Install progress */}
        {isInstalling && installProgress && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span className="truncate">{installProgress.message}</span>
              <span className="font-medium">{installProgress.current}%</span>
            </div>
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full transition-all duration-300"
                style={{ width: `${installProgress.current}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <Button
              size="sm"
              variant="destructive"
              className="flex-1 gap-2 h-9 rounded-lg"
              onClick={() => onStop(instance.id)}
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {isStopping ? t("instances.stopping") : t("instances.stop")}
            </Button>
          ) : isInstalled ? (
            <Button
              size="sm"
              className="flex-1 gap-2 h-9 rounded-lg bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80"
              onClick={() => onLaunch(instance)}
              disabled={isLaunching}
            >
              {isLaunching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isLaunching ? getLaunchStepText() : t("instances.play")}
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1 gap-2 h-9 rounded-lg"
              onClick={() => onInstall(instance)}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isInstalling ? t("instances.installing") : t("instances.install")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-9 w-9 p-0 rounded-lg border-border/50 hover:border-destructive hover:text-destructive"
            onClick={() => onDelete(instance)}
            disabled={isInstalling || isLaunching || isRunning}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
})

export function Instances() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [instances, setInstances] = useState<Instance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [installedVersions, setInstalledVersions] = useState<Set<string>>(new Set())
  const [launchingInstance, setLaunchingInstance] = useState<string | null>(null)
  const [launchStep, setLaunchStep] = useState<string | null>(null)

  // Use global installation store
  const { startInstallation, isInstalling, getInstallation } = useInstallationStore()
  const { removeSeed, activeSeeds } = useSharingStore()
  const [error, setError] = useState<string | null>(null)
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null)
  const [javaChecked, setJavaChecked] = useState(false)
  const [installingJava, setInstallingJava] = useState(false)
  const [activeTab, setActiveTab] = useState<InstanceTab>("client")
  const [runningInstances, setRunningInstances] = useState<Set<string>>(new Set())
  const [stoppingInstance, setStoppingInstance] = useState<string | null>(null)
  const [instanceIcons, setInstanceIcons] = useState<Record<string, string | null>>({})

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [instanceToDelete, setInstanceToDelete] = useState<Instance | null>(null)

  // New UI state
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem("instances_view_mode")
    return (stored as ViewMode) || "grid"
  })
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const stored = localStorage.getItem("instances_sort_by")
    return (stored as SortBy) || "name"
  })
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("instances_favorites")
    if (!stored) return new Set()
    try {
      return new Set(JSON.parse(stored))
    } catch {
      return new Set()
    }
  })

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem("instances_view_mode", viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem("instances_sort_by", sortBy)
  }, [sortBy])

  useEffect(() => {
    localStorage.setItem("instances_favorites", JSON.stringify([...favorites]))
  }, [favorites])

  // Filter and sort instances
  const filteredInstances = useMemo(() => {
    const filtered = instances.filter((instance) => {
      // Filter by tab
      if (activeTab === "client" && (instance.is_server || instance.is_proxy)) return false
      if (activeTab === "server" && (!instance.is_server || instance.is_proxy)) return false
      if (activeTab === "proxy" && !instance.is_proxy) return false

      // Filter by search
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          instance.name.toLowerCase().includes(query) ||
          instance.mc_version.toLowerCase().includes(query) ||
          (instance.loader?.toLowerCase().includes(query) ?? false)
        )
      }
      return true
    })

    // Sort
    filtered.sort((a, b) => {
      // Favorites first
      const aFav = favorites.has(a.id)
      const bFav = favorites.has(b.id)
      if (aFav && !bFav) return -1
      if (!aFav && bFav) return 1

      // Then by selected sort
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name)
        case "last_played":
          if (!a.last_played && !b.last_played) return 0
          if (!a.last_played) return 1
          if (!b.last_played) return -1
          return new Date(b.last_played).getTime() - new Date(a.last_played).getTime()
        case "playtime":
          return b.total_playtime_seconds - a.total_playtime_seconds
        case "version":
          return b.mc_version.localeCompare(a.mc_version)
        default:
          return 0
      }
    })

    return filtered
  }, [instances, activeTab, searchQuery, sortBy, favorites])

  // Count instances per tab
  const clientCount = instances.filter(i => !i.is_server && !i.is_proxy).length
  const serverCount = instances.filter(i => i.is_server && !i.is_proxy).length
  const proxyCount = instances.filter(i => i.is_proxy).length

  const toggleFavorite = useCallback((instanceId: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(instanceId)) {
        newFavorites.delete(instanceId)
      } else {
        newFavorites.add(instanceId)
      }
      return newFavorites
    })
  }, [])

  const checkJava = async () => {
    try {
      const result = await invoke<JavaInfo | null>("check_java")
      setJavaInfo(result)
    } catch (e) {
      console.error("Failed to check Java:", e)
    } finally {
      setJavaChecked(true)
    }
  }

  const handleInstallJava = async () => {
    setInstallingJava(true)
    setError(null)
    try {
      const result = await invoke<JavaInfo>("install_java")
      setJavaInfo(result)
      toast.success(t("settings.javaInstalled"))
    } catch (err) {
      console.error("Failed to install Java:", err)
      toast.error(t("settings.javaInstallError"))
      setError(String(err))
    } finally {
      setInstallingJava(false)
    }
  }

  const loadInstances = useCallback(async () => {
    try {
      const result = await invoke<Instance[]>("get_instances")
      setInstances(result)

      // Check which instances are installed (single batch call instead of N calls)
      const instancesWithDirs: [string, string][] = result.map(instance => [instance.id, instance.game_dir])
      try {
        const installedMap = await invoke<Record<string, boolean>>("check_instances_installed", {
          instances: instancesWithDirs
        })
        const installed = new Set<string>(
          Object.entries(installedMap).filter(([, isInstalled]) => isInstalled).map(([id]) => id)
        )
        setInstalledVersions(installed)
      } catch (e) {
        console.error("Failed to check installed instances:", e)
        setInstalledVersions(new Set())
      }

      // Load all icons in a single batch call (no database queries, just file reads)
      const instancesForIcons: [string, string, string | null][] = result.map(
        instance => [instance.id, instance.game_dir, instance.icon_path]
      )
      try {
        const iconsMap = await invoke<Record<string, string | null>>("get_instance_icons", {
          instances: instancesForIcons
        })
        setInstanceIcons(iconsMap)
      } catch (e) {
        console.error("Failed to load instance icons:", e)
        // Initialize all icons as null on error
        const emptyIcons: Record<string, string | null> = {}
        result.forEach(i => { emptyIcons[i.id] = null })
        setInstanceIcons(emptyIcons)
      }
    } catch (err) {
      console.error("Failed to load instances:", err)
      toast.error(t("instances.unableToLoad"))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInstances()
    checkJava()

    // Listen for launch progress events
    const unlistenLaunchProgress = listen<{ instance_id: string; step: string }>("launch-progress", (event) => {
      const { step } = event.payload
      // Always update - we filter by instance in the UI
      setLaunchStep(step)
    })

    // Listen for instance status changes
    const unlistenStatus = listen<{ instance_id: string; status: string }>("instance-status", (event) => {
      const { instance_id, status } = event.payload
      setRunningInstances(prev => {
        const newSet = new Set(prev)
        if (status === "running") {
          newSet.add(instance_id)
        } else {
          newSet.delete(instance_id)
        }
        return newSet
      })
      // Clear launch step when instance starts or stops
      setLaunchStep(null)
      setLaunchingInstance(null)
    })

    // Listen for install completion to reload instances
    const unlistenInstall = listen<{ stage: string; instance_id?: string }>("install-progress", (event) => {
      if (event.payload.stage === "complete") {
        setTimeout(() => loadInstances(), 1000)
      }
    })

    return () => {
      unlistenLaunchProgress.then(fn => fn()).catch(() => {})
      unlistenStatus.then(fn => fn()).catch(() => {})
      unlistenInstall.then(fn => fn()).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check running instances once on mount only
  useEffect(() => {
    if (instances.length > 0) {
      checkRunningInstances()
    }
  }, [instances.length])

  const handleInstall = useCallback(async (instance: Instance) => {
    setError(null)
    // Start installation in global store (shows notification)
    startInstallation(instance.id, instance.name)
    try {
      await invoke("install_instance", { instanceId: instance.id })
      setInstalledVersions(prev => new Set([...prev, instance.id]))
      toast.success(`${t("instances.instanceInstalled")}: "${instance.name}"`)
    } catch (err) {
      console.error("Failed to install instance:", err)
      toast.error(t("instances.unableToInstall"))
      setError(String(err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInstallation])

  const handleLaunch = useCallback(async (instance: Instance) => {
    setError(null)
    setLaunchingInstance(instance.id)
    try {
      // Get active account
      const account = await invoke<Account | null>("get_active_account")
      if (!account) {
        toast.error(t("instances.loginBeforePlay"))
        setError(t("instances.loginBeforePlay"))
        setLaunchingInstance(null)
        return
      }

      await invoke("launch_instance", {
        instanceId: instance.id,
        accountId: account.id
      })
      toast.success(`${t("instances.launchingInstance")} "${instance.name}"`)
    } catch (err) {
      console.error("Failed to launch instance:", err)
      toast.error(t("instances.unableToLaunch"))
      setError(String(err))
    } finally {
      setLaunchingInstance(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDeleteDialog = useCallback((instance: Instance) => {
    setInstanceToDelete(instance)
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = async (deleteShares?: boolean) => {
    if (!instanceToDelete) return

    try {
      // If deleteShares is true, stop and delete shares for this instance first
      if (deleteShares) {
        try {
          interface ActiveShare {
            share_id: string
            instance_name: string
            package_path: string
          }
          const shares = await invoke<ActiveShare[]>("get_active_shares")
          const instanceShares = shares.filter(s => s.instance_name === instanceToDelete.name)
          for (const share of instanceShares) {
            await invoke("stop_share", { shareId: share.share_id })
            // Also remove from the store to update sidebar badge
            for (const [exportId, seed] of activeSeeds.entries()) {
              if (seed.packagePath === share.package_path) {
                removeSeed(exportId)
                break
              }
            }
          }
        } catch (shareErr) {
          console.error("Failed to delete shares:", shareErr)
          // Continue with instance deletion even if share deletion fails
        }
      }

      await invoke("delete_instance", { instanceId: instanceToDelete.id })
      // Remove from favorites if it was favorited
      setFavorites(prev => {
        const newFavorites = new Set(prev)
        newFavorites.delete(instanceToDelete.id)
        return newFavorites
      })
      toast.success(t("instances.instanceDeleted"))
      loadInstances()
    } catch (err) {
      console.error("Failed to delete instance:", err)
      toast.error(t("instances.unableToDelete"))
      setError(String(err))
    } finally {
      setInstanceToDelete(null)
    }
  }

  const handleStop = useCallback(async (instanceId: string) => {
    setStoppingInstance(instanceId)
    try {
      await invoke("stop_instance", { instanceId })
      setRunningInstances(prev => {
        const newSet = new Set(prev)
        newSet.delete(instanceId)
        return newSet
      })
      toast.success(t("instances.instanceStopped"))
    } catch (err) {
      console.error("Failed to stop instance:", err)
      toast.error(t("instances.unableToStop"))
      setError(String(err))
    } finally {
      setStoppingInstance(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkRunningInstances = async () => {
    try {
      // Use batch command - single call instead of N calls
      const runningIds = await invoke<string[]>("get_running_instances")
      setRunningInstances(new Set(runningIds))
    } catch {
      // Ignore errors
      setRunningInstances(new Set())
    }
  }

  // Helper to get icon URL for an instance
  const getIconUrl = useCallback((instanceId: string): string | null => {
    return instanceIcons[instanceId] || null
  }, [instanceIcons])

  // Format playtime - memoized
  const formatPlaytime = useCallback((seconds: number): string => {
    if (seconds < 60) return "< 1 min"
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  }, [])

  // Memoized handlers for InstanceCard
  const handleNavigate = useCallback((id: string) => {
    navigate(`/instances/${id}`)
  }, [navigate])

  // Render instance card using memoized component
  const renderInstanceCard = useCallback((instance: Instance) => {
    return (
      <InstanceCard
        key={instance.id}
        instance={instance}
        viewMode={viewMode}
        isInstalled={installedVersions.has(instance.id)}
        isInstalling={isInstalling(instance.id)}
        isLaunching={launchingInstance === instance.id}
        launchStep={launchingInstance === instance.id ? launchStep : null}
        isRunning={runningInstances.has(instance.id)}
        isStopping={stoppingInstance === instance.id}
        iconUrl={getIconUrl(instance.id)}
        isFavorite={favorites.has(instance.id)}
        installProgress={getInstallation(instance.id)?.progress || null}
        onNavigate={handleNavigate}
        onToggleFavorite={toggleFavorite}
        onLaunch={handleLaunch}
        onInstall={handleInstall}
        onStop={handleStop}
        onDelete={openDeleteDialog}
        formatPlaytime={formatPlaytime}
        t={t}
      />
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, installedVersions, isInstalling, getInstallation, launchingInstance, launchStep, runningInstances, stoppingInstance, getIconUrl, favorites, handleNavigate, toggleFavorite, handleLaunch, handleInstall, handleStop, openDeleteDialog, formatPlaytime])

  const sortLabels: Record<SortBy, string> = {
    name: t("common.name"),
    last_played: t("instances.lastPlayed"),
    playtime: t("home.playtime"),
    version: t("common.version")
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("instances.title")}</h1>
            <p className="text-muted-foreground">
              {t("instances.subtitle")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setImportDialogOpen(true)}>
              <FolderDown className="h-4 w-4" />
              {t("sharing.import")}
            </Button>
            <Button className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("instances.create")}
            </Button>
          </div>
        </div>

        {/* Java warning */}
        {javaChecked && !javaInfo && (
          <Alert className="border-amber-500/50 bg-amber-500/10">
            <Coffee className="h-4 w-4 text-amber-500" />
            <AlertTitle className="text-amber-500">{t("java.required")}</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{t("java.notInstalled")}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-4"
                onClick={handleInstallJava}
                disabled={installingJava}
              >
                {installingJava ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("instances.installing")}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {t("java.install21")}
                  </>
                )}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Search and filters */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("instances.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Sort dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowUpDown className="h-4 w-4" />
                {sortLabels[sortBy]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("name")}>
                {t("common.name")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("last_played")}>
                {t("instances.lastPlayed")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("playtime")}>
                {t("home.playtime")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("version")}>
                {t("common.version")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View mode toggles */}
          <div className="flex items-center border rounded-md">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0 rounded-r-none"
                  onClick={() => setViewMode("grid")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("instances.grid")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0 rounded-none border-x"
                  onClick={() => setViewMode("list")}
                >
                  <LayoutList className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("instances.list")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "compact" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0 rounded-l-none"
                  onClick={() => setViewMode("compact")}
                >
                  <Columns className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("instances.compact")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Instance type tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as InstanceTab)}>
          <TabsList className="w-fit">
            <TabsTrigger value="client" className="gap-2">
              <Monitor className="h-4 w-4" />
              {t("instances.clients")}
              {clientCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {clientCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="server" className="gap-2">
              <Server className="h-4 w-4" />
              {t("instances.servers")}
              {serverCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {serverCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="proxy" className="gap-2">
              <Network className="h-4 w-4" />
              {t("instances.proxies")}
              {proxyCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {proxyCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Instances */}
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : filteredInstances.length === 0 ? (
          /* Empty state */
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                {activeTab === "client" && <Monitor className="h-8 w-8 text-muted-foreground" />}
                {activeTab === "server" && <Server className="h-8 w-8 text-muted-foreground" />}
                {activeTab === "proxy" && <Network className="h-8 w-8 text-muted-foreground" />}
              </div>
              <h3 className="font-semibold mb-1">
                {searchQuery ? t("instances.noResults") : (
                  <>
                    {activeTab === "client" && t("instances.noClients")}
                    {activeTab === "server" && t("instances.noServers")}
                    {activeTab === "proxy" && t("instances.noProxies")}
                  </>
                )}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {searchQuery ? (
                  `${t("instances.noMatch")} "${searchQuery}"`
                ) : (
                  <>
                    {activeTab === "client" && t("instances.createFirstClient")}
                    {activeTab === "server" && t("instances.createFirstServer")}
                    {activeTab === "proxy" && t("instances.createFirstProxy")}
                  </>
                )}
              </p>
              {!searchQuery && (
                <Button className="gap-2" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t("instances.create")}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className={cn(
            viewMode === "grid" && "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6",
            viewMode === "list" && "flex flex-col gap-2",
            viewMode === "compact" && "grid gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6"
          )}>
            {filteredInstances.map(renderInstanceCard)}
          </div>
        )}

        {/* Create Instance Dialog */}
        <CreateInstanceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={loadInstances}
        />

        {/* Import Instance Dialog */}
        <ImportInstanceDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onSuccess={loadInstances}
        />

        {/* Delete Instance Dialog */}
        <DeleteInstanceDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          instanceName={instanceToDelete?.name || ""}
          onConfirm={handleConfirmDelete}
        />
      </div>
    </TooltipProvider>
  )
}
