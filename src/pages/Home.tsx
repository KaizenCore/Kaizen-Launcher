import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react"
import { Link, useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import {
  Play,
  Plus,
  ChevronRight,
  Layers,
  Package,
  Clock,
  User,
  Square,
  Loader2,
  Search,
  Settings,
  ChevronDown,
  Check,
  AlertCircle,
  Download,
  Github,
  Heart,
  ExternalLink,
  Bug,
  Zap,
  History
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useEasyModeStore } from "@/stores/easyModeStore"

// Lazy load QuickPlay for Easy Mode
const QuickPlay = lazy(() => import("@/components/home/QuickPlay").then(m => ({ default: m.QuickPlay })))

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
  color: string | null
}

// Color palette for instances without icons (same as Instances.tsx)
const colorMap: Record<string, { bg: string; text: string }> = {
  "#f59e0b": { bg: "from-amber-500/30 to-amber-600/10", text: "text-amber-300" },
  "#ef4444": { bg: "from-red-500/30 to-red-600/10", text: "text-red-300" },
  "#f97316": { bg: "from-orange-500/30 to-orange-600/10", text: "text-orange-300" },
  "#84cc16": { bg: "from-lime-500/30 to-lime-600/10", text: "text-lime-300" },
  "#22c55e": { bg: "from-green-500/30 to-green-600/10", text: "text-green-300" },
  "#10b981": { bg: "from-emerald-500/30 to-emerald-600/10", text: "text-emerald-300" },
  "#14b8a6": { bg: "from-teal-500/30 to-teal-600/10", text: "text-teal-300" },
  "#06b6d4": { bg: "from-cyan-500/30 to-cyan-600/10", text: "text-cyan-300" },
  "#3b82f6": { bg: "from-blue-500/30 to-blue-600/10", text: "text-blue-300" },
  "#8b5cf6": { bg: "from-violet-500/30 to-violet-600/10", text: "text-violet-300" },
  "#a855f7": { bg: "from-purple-500/30 to-purple-600/10", text: "text-purple-300" },
  "#ec4899": { bg: "from-pink-500/30 to-pink-600/10", text: "text-pink-300" },
}

const defaultColors = Object.keys(colorMap)

const getInstanceColor = (instance: Instance): { bg: string; text: string } => {
  // Use persisted color if available
  if (instance.color && colorMap[instance.color]) {
    return colorMap[instance.color]
  }
  // Fallback to hash-based color
  let hash = 0
  for (let i = 0; i < instance.name.length; i++) {
    hash = instance.name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colorIndex = Math.abs(hash) % defaultColors.length
  return colorMap[defaultColors[colorIndex]]
}

// Safe account info from backend - NO TOKENS (security)
interface Account {
  id: string
  username: string
  uuid: string
  is_active: boolean
  skin_url: string | null
  has_valid_token: boolean
  is_offline: boolean
}

type InstanceStatus = "not_installed" | "installing" | "ready" | "running"

export function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { load: loadEasyMode } = useEasyModeStore()
  const [instances, setInstances] = useState<Instance[]>([])
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [instanceStatus, setInstanceStatus] = useState<InstanceStatus>("not_installed")
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchStep, setLaunchStep] = useState<string | null>(null)
  const [totalMods, setTotalMods] = useState<number>(0)
  const [installProgress, setInstallProgress] = useState<{ current: number; message: string } | null>(null)
  const [instanceIcons, setInstanceIcons] = useState<Record<string, string | null>>({})

  // Load easy mode state
  useEffect(() => {
    loadEasyMode()
  }, [loadEasyMode])

  const loadData = useCallback(async () => {
    console.log("[Home] Loading dashboard data...")
    try {
      const [instancesResult, accountResult, modsCount] = await Promise.all([
        invoke<Instance[]>("get_instances"),
        invoke<Account | null>("get_active_account"),
        invoke<number>("get_total_mod_count"),
      ])
      console.log(`[Home] Loaded ${instancesResult.length} instances, ${modsCount} mods, account: ${accountResult?.username || "none"}`)
      setInstances(instancesResult)
      setActiveAccount(accountResult)
      setTotalMods(modsCount)

      // Load all icons in a single batch call
      const instancesForIcons: [string, string, string | null][] = instancesResult.map(
        instance => [instance.id, instance.game_dir, instance.icon_path]
      )
      try {
        const iconsMap = await invoke<Record<string, string | null>>("get_instance_icons", {
          instances: instancesForIcons
        })
        setInstanceIcons(iconsMap)
      } catch (e) {
        console.error("Failed to load instance icons:", e)
        const emptyIcons: Record<string, string | null> = {}
        instancesResult.forEach(i => { emptyIcons[i.id] = null })
        setInstanceIcons(emptyIcons)
      }

      // Select the most recently played instance (only if none selected)
      setSelectedInstance(prev => {
        if (prev) return prev // Keep current selection
        if (instancesResult.length === 0) return null
        const sorted = [...instancesResult].sort((a, b) => {
          if (!a.last_played) return 1
          if (!b.last_played) return -1
          return new Date(b.last_played).getTime() - new Date(a.last_played).getTime()
        })
        return sorted[0]
      })
    } catch (err) {
      console.error("Failed to load data:", err)
      toast.error(t("home.unableToLoadData"))
    }
  }, [])

  useEffect(() => {
    console.log("[Home] Page mounted")
    loadData()
  }, [loadData])

  // Check instance status when selected instance changes
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    let isPaused = false

    const checkStatus = async () => {
      // Skip checking if page is hidden (visibility optimization)
      if (document.hidden || isPaused) return

      if (!selectedInstance) {
        setInstanceStatus("not_installed")
        return
      }

      try {
        const [isInstalled, isRunning] = await Promise.all([
          invoke<boolean>("is_instance_installed", { instanceId: selectedInstance.id }),
          invoke<boolean>("is_instance_running", { instanceId: selectedInstance.id }),
        ])

        if (isRunning) {
          setInstanceStatus("running")
        } else if (isInstalled) {
          setInstanceStatus("ready")
        } else {
          setInstanceStatus("not_installed")
        }
      } catch {
        setInstanceStatus("not_installed")
      }
    }

    const startPolling = () => {
      if (interval) clearInterval(interval)
      // PERFORMANCE: Reduced from 5s to 15s to minimize DB load and CPU usage
      interval = setInterval(checkStatus, 15000)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        isPaused = true
        if (interval) {
          clearInterval(interval)
          interval = null
        }
      } else {
        isPaused = false
        checkStatus()
        startPolling()
      }
    }

    checkStatus()
    startPolling()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [selectedInstance])

  // Listen for install progress and launch progress
  useEffect(() => {
    const unlistenInstall = listen<{ stage: string; current: number; total: number; message: string }>("install-progress", (event) => {
      if (event.payload.stage === "complete") {
        setInstallProgress(null)
        setInstanceStatus("ready")
        toast.success(t("home.installComplete"))
      } else {
        setInstallProgress({
          current: event.payload.current,
          message: event.payload.message,
        })
      }
    })

    const unlistenLaunchProgress = listen<{ instance_id: string; step: string }>("launch-progress", (event) => {
      if (selectedInstance && event.payload.instance_id === selectedInstance.id) {
        setLaunchStep(event.payload.step)
      }
    })

    const unlistenStatus = listen<{ instance_id: string; status: string }>("instance-status", (event) => {
      if (selectedInstance && event.payload.instance_id === selectedInstance.id) {
        if (event.payload.status === "running") {
          setInstanceStatus("running")
          setIsLaunching(false)
          setLaunchStep(null)
        } else {
          setInstanceStatus("ready")
          setLaunchStep(null)
        }
      }
    })

    return () => {
      unlistenInstall.then(fn => fn()).catch(() => {})
      unlistenLaunchProgress.then(fn => fn()).catch(() => {})
      unlistenStatus.then(fn => fn()).catch(() => {})
    }
  }, [selectedInstance])

  const getIconUrl = useCallback((instance: Instance): string | null => {
    return instanceIcons[instance.id] || null
  }, [instanceIcons])

  const handleLaunch = async () => {
    if (!selectedInstance || !activeAccount) return

    if (instanceStatus === "not_installed") {
      // Install first
      console.log(`[Home] Installing instance: ${selectedInstance.name}`)
      setInstanceStatus("installing")
      setInstallProgress({ current: 0, message: t("home.startingInstall") })
      try {
        await invoke("install_instance", { instanceId: selectedInstance.id })
      } catch (err) {
        console.error("Failed to install:", err)
        toast.error(`${t("home.installError")}: ${err}`)
        setInstanceStatus("not_installed")
        setInstallProgress(null)
      }
      return
    }

    if (instanceStatus === "running") {
      // Stop the instance
      console.log(`[Home] Stopping instance: ${selectedInstance.name}`)
      try {
        await invoke("stop_instance", { instanceId: selectedInstance.id })
        console.log(`[Home] Instance stopped: ${selectedInstance.name}`)
        toast.success(t("home.instanceStopped"))
      } catch (err) {
        console.error("Failed to stop:", err)
        toast.error(`${t("common.error")}: ${err}`)
      }
      return
    }

    // Launch
    console.log(`[Home] Launching instance: ${selectedInstance.name} with account: ${activeAccount.username}`)
    setIsLaunching(true)
    try {
      await invoke("launch_instance", {
        instanceId: selectedInstance.id,
        accountId: activeAccount.id
      })
      console.log(`[Home] Launch command sent for: ${selectedInstance.name}`)
    } catch (err) {
      console.error("Failed to launch:", err)
      toast.error(`${t("home.launchError")}: ${err}`)
    } finally {
      setIsLaunching(false)
    }
  }

  const totalPlaytime = useMemo(() =>
    instances.reduce((acc, i) => acc + i.total_playtime_seconds, 0),
    [instances]
  )

  const formatPlaytime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }, [])

  const formatLastPlayed = useCallback((dateStr: string | null): string => {
    if (!dateStr) return "Never"
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins} minutes ago`
    if (diffHours < 24) return `${diffHours} hours ago`
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }, [])

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

  const getButtonContent = () => {
    if (isLaunching) {
      return (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          {getLaunchStepText()}
        </>
      )
    }

    switch (instanceStatus) {
      case "not_installed":
        return (
          <>
            <Download className="h-5 w-5" />
            {t("instances.install")}
          </>
        )
      case "installing":
        return (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("instances.installing")}
          </>
        )
      case "running":
        return (
          <>
            <Square className="h-5 w-5" />
            {t("instances.stop")}
          </>
        )
      default:
        return (
          <>
            <Play className="h-5 w-5" />
            {t("instances.play")}
          </>
        )
    }
  }

  const getStatusBadge = () => {
    switch (instanceStatus) {
      case "not_installed":
        return <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">{t("instances.notInstalled")}</Badge>
      case "installing":
        return <Badge variant="outline" className="text-blue-500 border-blue-500/50">{t("instances.installing")}</Badge>
      case "running":
        return <Badge variant="outline" className="text-green-500 border-green-500/50">{t("instances.running")}</Badge>
      default:
        return <Badge variant="outline" className="text-emerald-500 border-emerald-500/50">{t("home.ready")}</Badge>
    }
  }

  const canLaunch = selectedInstance && activeAccount && instanceStatus !== "installing"

  // Default tab is always Last Played
  const defaultTab = "lastPlayed"

  return (
    <div className="flex flex-col min-h-full overflow-auto">
      <div className="flex flex-col gap-4 flex-1">
      {/* Combined Quick Play / Last Played section */}
      <Card className="overflow-hidden relative">
        {/* Gradient covering entire card */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent pointer-events-none" />

        <Tabs defaultValue={defaultTab} className="w-full relative">
          <CardHeader className="pb-2 pt-4">
            <TabsList className="w-fit">
              <TabsTrigger value="lastPlayed" className="gap-2">
                <History className="h-4 w-4" />
                {t("home.lastPlayed")}
              </TabsTrigger>
              <TabsTrigger value="quickPlay" className="gap-2">
                <Zap className="h-4 w-4" />
                {t("quickPlay.title")}
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          {/* Last Played Tab */}
          <TabsContent value="lastPlayed" className="mt-0">
              <CardContent className="p-4 pt-2">
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Instance icon and info */}
                  <div className="flex items-start gap-4 flex-1">
                    {selectedInstance ? (
                      <>
                        {(() => {
                          const heroIconUrl = getIconUrl(selectedInstance)
                          const heroColor = getInstanceColor(selectedInstance)
                          return (
                            <div className={`h-20 w-20 rounded-xl flex items-center justify-center overflow-hidden border border-border/50 flex-shrink-0 ${
                              heroIconUrl ? 'bg-muted/50' : `bg-gradient-to-br ${heroColor.bg}`
                            }`}>
                              {heroIconUrl ? (
                                <img
                                  src={heroIconUrl}
                                  alt={selectedInstance.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement
                                    target.style.display = "none"
                                  }}
                                />
                              ) : (
                                <span className={`text-3xl font-bold ${heroColor.text}`}>
                                  {selectedInstance.name.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                          )
                        })()}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-auto p-0 hover:bg-transparent">
                                  <h2 className="text-2xl font-bold truncate">{selectedInstance.name}</h2>
                                  <ChevronDown className="h-5 w-5 ml-1 text-muted-foreground" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-64">
                                {instances.map((instance) => {
                                  const dropdownIconUrl = getIconUrl(instance)
                                  const dropdownColor = getInstanceColor(instance)
                                  return (
                                    <DropdownMenuItem
                                      key={instance.id}
                                      onClick={() => setSelectedInstance(instance)}
                                      className="flex items-center gap-2"
                                    >
                                      <div className={`h-8 w-8 rounded flex items-center justify-center overflow-hidden flex-shrink-0 ${
                                        dropdownIconUrl ? 'bg-muted' : `bg-gradient-to-br ${dropdownColor.bg}`
                                      }`}>
                                        {dropdownIconUrl ? (
                                          <img
                                            src={dropdownIconUrl}
                                            alt={instance.name}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <span className={`text-sm font-bold ${dropdownColor.text}`}>
                                            {instance.name.charAt(0).toUpperCase()}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{instance.name}</p>
                                        <p className="text-xs text-muted-foreground">{instance.mc_version}</p>
                                      </div>
                                      {selectedInstance?.id === instance.id && (
                                        <Check className="h-4 w-4 text-primary" />
                                      )}
                                    </DropdownMenuItem>
                                  )
                                })}
                                {instances.length === 0 && (
                                  <DropdownMenuItem disabled>
                                    {t("home.noInstances")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {getStatusBadge()}
                          </div>
                          <p className="text-muted-foreground mb-2">
                            Minecraft {selectedInstance.mc_version}
                            {selectedInstance.loader && (
                              <span className="ml-2">
                                • {selectedInstance.loader}
                                {selectedInstance.loader_version && ` ${selectedInstance.loader_version}`}
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {formatPlaytime(selectedInstance.total_playtime_seconds)}
                            </span>
                            <span>
                              {formatLastPlayed(selectedInstance.last_played)}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
                        <Layers className="h-12 w-12 text-muted-foreground mb-2" />
                        <p className="text-muted-foreground mb-2">{t("home.noInstanceSelected")}</p>
                        <Button variant="outline" size="sm" asChild>
                          <Link to="/browse" className="gap-2">
                            <Search className="h-4 w-4" />
                            {t("home.browseModpacks")}
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Play button and actions */}
                  <div className="flex flex-col gap-3 items-end justify-center">
                    <Button
                      size="lg"
                      className="gap-2 px-8 h-12 text-lg"
                      disabled={!canLaunch || isLaunching}
                      onClick={handleLaunch}
                      variant={instanceStatus === "running" ? "destructive" : "default"}
                    >
                      {getButtonContent()}
                    </Button>

                    {selectedInstance && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => navigate(`/instances/${selectedInstance.id}`)}
                      >
                        <Settings className="h-4 w-4 mr-1" />
                        {t("home.manageInstance")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Install progress bar */}
                {instanceStatus === "installing" && installProgress && (
                  <div className="mt-4 space-y-2">
                    <Progress value={installProgress.current} className="h-2" />
                    <p className="text-sm text-muted-foreground text-center">
                      {installProgress.message} ({installProgress.current}%)
                    </p>
                  </div>
                )}

                {/* Account warning */}
                {!activeAccount && (
                  <div className="mt-4 flex items-center gap-2 text-amber-500 bg-amber-500/10 rounded-lg p-3">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm">
                      {t("home.requireAccount")}
                    </span>
                    <Button variant="outline" size="sm" asChild className="ml-auto">
                      <Link to="/accounts">
                        <User className="h-4 w-4 mr-1" />
                        {t("home.addAccount")}
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
          </TabsContent>

          {/* Quick Play Tab */}
          <TabsContent value="quickPlay" className="mt-0">
            <Suspense fallback={
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            }>
              <QuickPlay embedded />
            </Suspense>
          </TabsContent>
        </Tabs>
      </Card>

      {/* Stats cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => navigate("/instances")}>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardDescription className="flex items-center gap-2 text-xs">
              <Layers className="h-3.5 w-3.5" />
              {t("nav.instances")}
            </CardDescription>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4">
            <div className="text-2xl font-bold">{instances.length}</div>
            <p className="text-xs text-muted-foreground">
              {instances.filter(i => !i.is_server).length} {t("home.clients")}
              {instances.filter(i => i.is_server).length > 0 && (
                <span> • {instances.filter(i => i.is_server).length} {t("home.servers")}</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => navigate("/browse")}>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardDescription className="flex items-center gap-2 text-xs">
              <Package className="h-3.5 w-3.5" />
              {t("home.installedMods")}
            </CardDescription>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4">
            <div className="text-2xl font-bold">{totalMods}</div>
            <p className="text-xs text-muted-foreground">
              {t("home.onAllInstances")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardDescription className="flex items-center gap-2 text-xs">
              <Clock className="h-3.5 w-3.5" />
              {t("home.playtime")}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4">
            <div className="text-2xl font-bold">{formatPlaytime(totalPlaytime)}</div>
            <p className="text-xs text-muted-foreground">
              {t("home.totalAccumulated")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent instances */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{t("home.recentInstances")}</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/instances" className="gap-1">
              {t("home.viewAll")}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {instances.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Layers className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                {t("home.noInstanceCreated")}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/instances" className="gap-2">
                    <Plus className="h-4 w-4" />
                    {t("home.createManually")}
                  </Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/browse" className="gap-2">
                    <Search className="h-4 w-4" />
                    {t("home.browseModpacks")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6 p-0.5">
            {instances.slice(0, 6).map((instance) => {
              const iconUrl = getIconUrl(instance)
              const instanceColor = getInstanceColor(instance)
              return (
                <Card
                  key={instance.id}
                  className="cursor-pointer transition-all hover:ring-2 hover:ring-primary/50"
                  onClick={() => navigate(`/instances/${instance.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-12 w-12 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 ${
                        iconUrl ? 'bg-muted' : `bg-gradient-to-br ${instanceColor.bg}`
                      }`}>
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt={instance.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = "none"
                            }}
                          />
                        ) : (
                          <span className={`text-lg font-bold ${instanceColor.text}`}>
                            {instance.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate">{instance.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {instance.mc_version}
                          {instance.loader && ` • ${instance.loader}`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatLastPlayed(instance.last_played)}
                          {instance.total_playtime_seconds > 0 && (
                            <span> • {formatPlaytime(instance.total_playtime_seconds)}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
      </div>

      {/* Footer */}
      <footer className="mt-auto pt-6 border-t border-border/50">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Github className="h-3 w-3" />
              {t("home.footer.openSource")}
            </Badge>
            <span className="text-xs">v0.7.6</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => openUrl("https://github.com/KaizenCore/Kaizen-Launcher")}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Github className="h-4 w-4" />
              <span>{t("home.footer.viewOnGithub")}</span>
              <ExternalLink className="h-3 w-3" />
            </button>

            <button
              onClick={() => openUrl("https://github.com/KaizenCore/Kaizen-Launcher/issues")}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Bug className="h-4 w-4" />
              <span>{t("home.footer.reportBug")}</span>
            </button>
          </div>

          <div className="flex items-center gap-1 text-xs">
            <span>{t("home.footer.madeWith")}</span>
            <Heart className="h-3 w-3 text-red-500 fill-red-500" />
            <span>by Kaizen Team</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
