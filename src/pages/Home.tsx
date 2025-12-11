import { useState, useEffect, useCallback } from "react"
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
  Download
} from "lucide-react"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
}

interface Account {
  id: string
  username: string
  uuid: string
  is_active: boolean
  skin_url: string | null
}

type InstanceStatus = "not_installed" | "installing" | "ready" | "running"

export function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [instances, setInstances] = useState<Instance[]>([])
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [instanceStatus, setInstanceStatus] = useState<InstanceStatus>("not_installed")
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchStep, setLaunchStep] = useState<string | null>(null)
  const [totalMods, setTotalMods] = useState<number>(0)
  const [installProgress, setInstallProgress] = useState<{ current: number; message: string } | null>(null)
  const [instanceIcons, setInstanceIcons] = useState<Record<string, string | null>>({})

  const loadData = useCallback(async () => {
    try {
      const [instancesResult, accountResult, modsCount] = await Promise.all([
        invoke<Instance[]>("get_instances"),
        invoke<Account | null>("get_active_account"),
        invoke<number>("get_total_mod_count"),
      ])
      setInstances(instancesResult)
      setActiveAccount(accountResult)
      setTotalMods(modsCount)

      // Load icons in batches of 5 to avoid overwhelming the system
      const BATCH_SIZE = 5
      const instancesWithIcons = instancesResult.filter(i => i.icon_path)
      const icons: Record<string, string | null> = {}

      // Initialize all icons as null first
      instancesResult.forEach(i => { icons[i.id] = null })

      // Load icons in batches
      for (let i = 0; i < instancesWithIcons.length; i += BATCH_SIZE) {
        const batch = instancesWithIcons.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async (instance) => {
            try {
              const iconUrl = await invoke<string | null>("get_instance_icon", {
                instanceId: instance.id
              })
              return { id: instance.id, iconUrl }
            } catch (e) {
              console.error("Failed to load icon for instance:", instance.id, e)
              return { id: instance.id, iconUrl: null }
            }
          })
        )
        // Update icons progressively
        batchResults.forEach(r => { icons[r.id] = r.iconUrl })
        setInstanceIcons({ ...icons })
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
  }, [t])

  useEffect(() => {
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
      interval = setInterval(checkStatus, 2000)
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
  }, [selectedInstance, t])

  const getIconUrl = (instance: Instance): string | null => {
    return instanceIcons[instance.id] || null
  }

  const handleLaunch = async () => {
    if (!selectedInstance || !activeAccount) return

    if (instanceStatus === "not_installed") {
      // Install first
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
      try {
        await invoke("stop_instance", { instanceId: selectedInstance.id })
        toast.success(t("home.instanceStopped"))
      } catch (err) {
        console.error("Failed to stop:", err)
        toast.error(`${t("common.error")}: ${err}`)
      }
      return
    }

    // Launch
    setIsLaunching(true)
    try {
      await invoke("launch_instance", {
        instanceId: selectedInstance.id,
        accountId: activeAccount.id
      })
    } catch (err) {
      console.error("Failed to launch:", err)
      toast.error(`${t("home.launchError")}: ${err}`)
    } finally {
      setIsLaunching(false)
    }
  }

  const totalPlaytime = instances.reduce((acc, i) => acc + i.total_playtime_seconds, 0)
  const formatPlaytime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  const formatLastPlayed = (dateStr: string | null): string => {
    if (!dateStr) return t("common.never")
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t("common.justNow")
    if (diffMins < 60) return `${t("common.ago")} ${diffMins}${t("common.minutes")}`
    if (diffHours < 24) return `${t("common.ago")} ${diffHours}${t("common.hours")}`
    if (diffDays < 7) return `${t("common.ago")} ${diffDays}${t("common.days")}`
    return date.toLocaleDateString()
  }

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

  return (
    <div className="flex flex-col gap-6">
      {/* Hero section with selected instance */}
      <Card className="overflow-hidden">
        <div className="relative">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent" />

          <CardContent className="relative p-6">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Instance icon and info */}
              <div className="flex items-start gap-4 flex-1">
                {selectedInstance ? (
                  <>
                    <div className="h-20 w-20 rounded-xl bg-muted/50 flex items-center justify-center overflow-hidden border border-border/50 flex-shrink-0">
                      {getIconUrl(selectedInstance) ? (
                        <img
                          src={getIconUrl(selectedInstance)!}
                          alt={selectedInstance.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = "none"
                          }}
                        />
                      ) : (
                        <span className="text-3xl font-bold text-muted-foreground">
                          {selectedInstance.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
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
                            {instances.map((instance) => (
                              <DropdownMenuItem
                                key={instance.id}
                                onClick={() => setSelectedInstance(instance)}
                                className="flex items-center gap-2"
                              >
                                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                                  {getIconUrl(instance) ? (
                                    <img
                                      src={getIconUrl(instance)!}
                                      alt={instance.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span className="text-sm font-bold">
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
                            ))}
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
        </div>
      </Card>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => navigate("/instances")}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              {t("nav.instances")}
            </CardDescription>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{instances.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {instances.filter(i => !i.is_server).length} {t("home.clients")}
              {instances.filter(i => i.is_server).length > 0 && (
                <span> • {instances.filter(i => i.is_server).length} {t("home.servers")}</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => navigate("/browse")}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("home.installedMods")}
            </CardDescription>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalMods}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("home.onAllInstances")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t("home.playtime")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatPlaytime(totalPlaytime)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("home.totalAccumulated")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent instances */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{t("home.recentInstances")}</h2>
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
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {instances.slice(0, 6).map((instance) => {
              const iconUrl = getIconUrl(instance)
              const isSelected = selectedInstance?.id === instance.id
              return (
                <Card
                  key={instance.id}
                  className={`cursor-pointer transition-all hover:bg-accent/50 ${
                    isSelected ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => navigate(`/instances/${instance.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
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
                          <span className="text-lg font-bold text-muted-foreground">
                            {instance.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-sm truncate">{instance.name}</h3>
                          {isSelected && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">
                              {t("common.selected")}
                            </Badge>
                          )}
                        </div>
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
  )
}
