import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useNavigate } from "react-router-dom"
import {
  Play,
  Loader2,
  Search,
  Settings2,
  Zap,
  Download,
  Check,
  AlertCircle,
  Gauge,
  Shield,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslation } from "@/i18n"
import { useQuickPlayStore } from "@/stores/quickPlayStore"
import { useInstallationStore } from "@/stores/installationStore"
import { toast } from "sonner"

interface SearchResult {
  project_id: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  categories: string[]
}

interface ModpackInstallResult {
  instance_id: string
  name: string
  mc_version: string
  loader: string | null
  loader_version: string | null
  files_count: number
}

interface QuickPlayProps {
  embedded?: boolean
}

export function QuickPlay({ embedded = false }: QuickPlayProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    defaultModpack,
    loading: storeLoading,
    load: loadStore,
    setDefaultModpack,
    versionCache,
    versionsLoading,
    selectedVersionId,
    loadVersions: loadVersionsFromStore,
    setSelectedVersion: setSelectedVersionInStore,
    checkInstance,
    updateInstanceCache,
    currentInstance: existingInstance,
    installStage,
    setCurrentInstance: setExistingInstance,
    setInstallStage,
    activeAccountId,
    checkAccount,
  } = useQuickPlayStore()
  const { startInstallation, migrateInstallation, setStep } = useInstallationStore()

  // Get versions from cache
  const versions = versionCache?.versions || []
  const selectedVersion = selectedVersionId || ""
  const loadingVersions = versionsLoading

  // Local state (only for transient UI state)
  const [installProgress, setInstallProgress] = useState(0)
  const [installMessage, setInstallMessage] = useState("")

  // Change modpack dialog
  const [changeModpackOpen, setChangeModpackOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Wrapper for setSelectedVersion
  const setSelectedVersion = useCallback((versionId: string) => {
    setSelectedVersionInStore(versionId)
  }, [setSelectedVersionInStore])

  // Load store and check account on mount
  useEffect(() => {
    loadStore()
    checkAccount()
  }, [loadStore, checkAccount])

  // Load versions when modpack changes (with cache)
  useEffect(() => {
    if (!defaultModpack.projectId || storeLoading) return
    loadVersionsFromStore(defaultModpack.projectId)
  }, [defaultModpack.projectId, storeLoading, loadVersionsFromStore])

  // Check if instance already exists for selected version (with cache)
  useEffect(() => {
    if (!selectedVersion || !defaultModpack.projectId) return

    const version = versions.find((v) => v.id === selectedVersion)
    if (!version) return

    const mcVersion = version.game_versions[0]

    checkInstance(defaultModpack.projectId, defaultModpack.name, mcVersion).then(({ instance, isInstalled }) => {
      setExistingInstance(instance)
      setInstallStage(isInstalled ? "ready" : "idle")
    })
  }, [selectedVersion, defaultModpack.projectId, defaultModpack.name, versions, checkInstance])

  // Listen for installation progress
  useEffect(() => {
    const unlistenModpack = listen<{
      stage: string
      progress: number
      message: string
    }>("modpack-progress", (event) => {
      setInstallProgress(event.payload.progress)
      setInstallMessage(event.payload.message)
    })

    const unlistenInstall = listen<{
      stage: string
      current: number
      total: number
      message: string
    }>("install-progress", (event) => {
      const progress = event.payload.total > 0
        ? Math.round((event.payload.current / event.payload.total) * 100)
        : 0
      setInstallProgress(progress)
      setInstallMessage(event.payload.message)
    })

    return () => {
      unlistenModpack.then((fn) => fn())
      unlistenInstall.then((fn) => fn())
    }
  }, [])

  // Search modpacks
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      const results = await invoke<{ hits: SearchResult[] }>("search_modrinth_mods", {
        query,
        facets: JSON.stringify([["project_type:modpack"]]),
        limit: 10,
        offset: 0,
      })
      setSearchResults(results?.hits ?? [])
    } catch (error) {
      console.error("Search failed:", error)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, handleSearch])

  // Select a modpack from search
  const handleSelectModpack = async (result: SearchResult) => {
    await setDefaultModpack({
      projectId: result.project_id,
      name: result.title,
      iconUrl: result.icon_url,
    })
    setChangeModpackOpen(false)
    setSearchQuery("")
    setSearchResults([])
    toast.success(t("quickPlay.modpackChanged", { name: result.title }))
  }

  // Main play/install action
  const handlePlay = async () => {
    if (!activeAccountId) {
      toast.error(t("quickPlay.loginRequired"))
      navigate("/accounts")
      return
    }

    const version = versions.find((v) => v.id === selectedVersion)
    if (!version) return

    try {
      // If instance exists and is ready, just launch
      if (existingInstance && installStage === "ready") {
        setInstallStage("launching")
        await invoke("launch_instance", {
          instanceId: existingInstance.id,
          accountId: activeAccountId
        })
        toast.success(t("quickPlay.launching"))
        return
      }

      // Need to install
      setInstallStage("modpack")
      setInstallProgress(0)

      let instanceId: string

      if (existingInstance) {
        // Instance exists but not installed
        instanceId = existingInstance.id
      } else {
        // Create new instance from modpack
        const trackingId = `quickplay_${defaultModpack.projectId}_${version.game_versions[0]}`
        startInstallation(trackingId, defaultModpack.name, "modpack", defaultModpack.projectId)

        const result = await invoke<ModpackInstallResult>("install_modrinth_modpack", {
          projectId: defaultModpack.projectId,
          versionId: selectedVersion,
          instanceName: `${defaultModpack.name} ${version.game_versions[0]}`,
        })

        instanceId = result.instance_id
        migrateInstallation(trackingId, instanceId)
        setExistingInstance({
          id: instanceId,
          name: result.name,
          mc_version: result.mc_version,
          loader: result.loader,
          modrinth_project_id: defaultModpack.projectId,
        })
      }

      // Install Minecraft
      setInstallStage("minecraft")
      setStep(instanceId, "minecraft")
      await invoke("install_instance", { instanceId })

      // Ready to play - update cache
      setInstallStage("ready")
      const newInstance = existingInstance || {
        id: instanceId,
        name: `${defaultModpack.name} ${version.game_versions[0]}`,
        mc_version: version.game_versions[0],
        loader: null,
        modrinth_project_id: defaultModpack.projectId,
      }
      updateInstanceCache(defaultModpack.projectId, version.game_versions[0], newInstance, true)

      // Auto-launch
      setInstallStage("launching")
      await invoke("launch_instance", {
        instanceId,
        accountId: activeAccountId
      })
      toast.success(t("quickPlay.launching"))

    } catch (error) {
      console.error("Quick play failed:", error)
      toast.error(t("quickPlay.installFailed"))
      setInstallStage("idle")
    }
  }

  if (storeLoading) {
    if (embedded) {
      return (
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      )
    }
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  // Change modpack dialog (shared between modes)
  const changeModpackDialog = (
    <Dialog open={changeModpackOpen} onOpenChange={setChangeModpackOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="h-4 w-4" />
          {t("quickPlay.changeModpack")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("quickPlay.selectModpack")}</DialogTitle>
          <DialogDescription>
            {t("quickPlay.selectModpackDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("quickPlay.searchModpacks")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-[300px]">
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
                {searchResults.map((result) => (
                  <button
                    key={result.project_id}
                    onClick={() => handleSelectModpack(result)}
                    className="w-full p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left flex items-center gap-3"
                  >
                    {result.icon_url ? (
                      <img
                        src={result.icon_url}
                        alt={result.title}
                        className="h-10 w-10 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                        <Zap className="h-5 w-5" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{result.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {result.downloads.toLocaleString()} downloads
                      </p>
                    </div>
                    {result.project_id === defaultModpack.projectId && (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                  </button>
                ))}
              </div>
            ) : searchQuery ? (
              <p className="text-center text-muted-foreground py-8">
                {t("quickPlay.noResults")}
              </p>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                {t("quickPlay.searchPrompt")}
              </p>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )

  // Get selected version info
  const selectedVersionInfo = versions.find((v) => v.id === selectedVersion)

  // Filter versions to show only one per Minecraft version (the latest modpack version for each MC version)
  const uniqueMcVersions = versions.reduce((acc, version) => {
    const mcVersion = version.game_versions[0]
    // Keep only the first occurrence (latest modpack version) for each MC version
    if (!acc.some(v => v.game_versions[0] === mcVersion)) {
      acc.push(version)
    }
    return acc
  }, [] as typeof versions)

  // Main content (shared between modes)
  const quickPlayContent = (
    <div className="p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Modpack icon and info */}
          <div className="flex items-start gap-4 flex-1">
            <div className="h-20 w-20 rounded-xl flex items-center justify-center overflow-hidden border border-border/50 flex-shrink-0 bg-muted/50">
              {defaultModpack.iconUrl ? (
                <img
                  src={defaultModpack.iconUrl}
                  alt={defaultModpack.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Zap className="h-10 w-10 text-muted-foreground" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {/* Version selector as dropdown */}
                {loadingVersions ? (
                  <h2 className="text-2xl font-bold truncate flex items-center gap-2">
                    {defaultModpack.name}
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </h2>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-auto p-0 hover:bg-transparent">
                        <h2 className="text-2xl font-bold truncate">
                          {defaultModpack.name} {selectedVersionInfo?.game_versions[0] || ""}
                        </h2>
                        <ChevronDown className="h-5 w-5 ml-1 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
                      {uniqueMcVersions.map((version) => (
                        <DropdownMenuItem
                          key={version.id}
                          onClick={() => setSelectedVersion(version.id)}
                          className="flex items-center justify-between"
                        >
                          <span>Minecraft {version.game_versions[0]}</span>
                          {selectedVersionInfo?.game_versions[0] === version.game_versions[0] && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Status badge */}
                {existingInstance && installStage === "ready" ? (
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/50">
                    {t("home.ready")}
                  </Badge>
                ) : existingInstance ? (
                  <Badge variant="outline" className="text-blue-500 border-blue-500/50">
                    {t("instances.installing")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">
                    {t("instances.notInstalled")}
                  </Badge>
                )}
              </div>

              <p className="text-muted-foreground mb-2">
                {t("quickPlay.vanillaExperience")}
              </p>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Gauge className="h-4 w-4 text-green-500" />
                  {t("quickPlay.featureFps")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-purple-500" />
                  {t("quickPlay.featureSafe")}
                </span>
              </div>
            </div>
          </div>

          {/* Play button and actions */}
          <div className="flex flex-col gap-3 items-end justify-center">
            <Button
              size="lg"
              className="gap-2 px-8 h-12 text-lg"
              disabled={
                !selectedVersion ||
                loadingVersions ||
                !activeAccountId ||
                installStage === "modpack" ||
                installStage === "minecraft" ||
                installStage === "launching"
              }
              onClick={handlePlay}
            >
              {!activeAccountId ? (
                <>
                  <AlertCircle className="h-5 w-5" />
                  {t("quickPlay.loginFirst")}
                </>
              ) : installStage === "launching" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("quickPlay.launching")}
                </>
              ) : installStage === "modpack" || installStage === "minecraft" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("quickPlay.installing")}
                </>
              ) : existingInstance && installStage === "ready" ? (
                <>
                  <Play className="h-5 w-5" />
                  {t("quickPlay.play")}
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  {t("quickPlay.installAndPlay")}
                </>
              )}
            </Button>

            {changeModpackDialog}
          </div>
        </div>

        {/* Installation progress */}
        {(installStage === "modpack" || installStage === "minecraft") && (
          <div className="mt-4 space-y-2">
            <Progress value={installProgress} className="h-2" />
            <p className="text-sm text-muted-foreground text-center">
              {installMessage} ({installProgress}%)
            </p>
          </div>
        )}

        {/* Account warning */}
        {!activeAccountId && (
          <div className="mt-4 flex items-center gap-2 text-amber-500 bg-amber-500/10 rounded-lg p-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">
              {t("home.requireAccount")}
            </span>
          </div>
        )}
    </div>
  )

  // Embedded mode: return content directly (no CardContent wrapper)
  if (embedded) {
    return quickPlayContent
  }

  // Standalone mode: return full Card
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              {t("quickPlay.title")}
            </CardTitle>
            <CardDescription>{t("quickPlay.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {quickPlayContent}
      </CardContent>
    </Card>
  )
}
