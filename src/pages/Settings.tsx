import { useState, useEffect, useCallback } from "react"
import { Moon, Sun, Monitor, Globe, Download, Trash2, RefreshCw, Check, HardDrive, FolderOpen, Github, Database, Cpu, Info, Palette, Loader2, Sparkles } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { useTheme } from "@/hooks/useTheme"
import { useTranslation, localeNames, Locale } from "@/i18n"
import { cn } from "@/lib/utils"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { open } from "@tauri-apps/plugin-dialog"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { ThemeCustomizer } from "@/components/theme/ThemeCustomizer"
import { useUpdateChecker } from "@/hooks/useUpdateChecker"
import { useOnboardingStore } from "@/stores/onboardingStore"

interface JavaInstallation {
  version: string
  major_version: number
  path: string
  vendor: string
  is_bundled: boolean
}

interface AvailableJavaVersion {
  major_version: number
  release_name: string
  release_type: string
}

interface SystemMemoryInfo {
  total_mb: number
  available_mb: number
  recommended_min_mb: number
  recommended_max_mb: number
}

interface StorageInfo {
  data_dir: string
  total_size_bytes: number
  instances_size_bytes: number
  java_size_bytes: number
  cache_size_bytes: number
  other_size_bytes: number
  instance_count: number
}

interface InstanceStorageInfo {
  id: string
  name: string
  size_bytes: number
  mc_version: string
  loader: string | null
  last_played: string | null
}

interface InstancesDirectoryInfo {
  current_path: string
  default_path: string
  is_custom: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

export function Settings() {
  const { theme, setTheme } = useTheme()
  const { t, locale, setLocale, availableLocales } = useTranslation()

  // Update checker
  const { checking, checkForUpdates, updateInfo, updateAvailable, downloadAndInstall, installing, downloadProgress } = useUpdateChecker(false)

  // Onboarding
  const { setCompleted: setOnboardingCompleted } = useOnboardingStore()

  // App version
  const [appVersion, setAppVersion] = useState<string>("...")

  // Java state
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([])
  const [availableVersions, setAvailableVersions] = useState<AvailableJavaVersion[]>([])
  const [systemMemory, setSystemMemory] = useState<SystemMemoryInfo | null>(null)
  const [loadingJava, setLoadingJava] = useState(true)
  const [installingVersion, setInstallingVersion] = useState<number | null>(null)
  const [uninstallingVersion, setUninstallingVersion] = useState<number | null>(null)

  // Storage state
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [instancesStorage, setInstancesStorage] = useState<InstanceStorageInfo[]>([])
  const [loadingStorage, setLoadingStorage] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [instancesDir, setInstancesDir] = useState<InstancesDirectoryInfo | null>(null)
  const [changingInstancesDir, setChangingInstancesDir] = useState(false)

  // Memory settings (stored in localStorage for now)
  const [minMemory, setMinMemory] = useState(() => {
    const stored = localStorage.getItem("java_min_memory")
    return stored ? parseInt(stored, 10) : 1024
  })
  const [maxMemory, setMaxMemory] = useState(() => {
    const stored = localStorage.getItem("java_max_memory")
    return stored ? parseInt(stored, 10) : 4096
  })

  const loadJavaData = useCallback(async () => {
    setLoadingJava(true)
    try {
      const [installations, versions, memory] = await Promise.all([
        invoke<JavaInstallation[]>("get_java_installations"),
        invoke<AvailableJavaVersion[]>("get_available_java_versions"),
        invoke<SystemMemoryInfo>("get_system_memory"),
      ])
      setJavaInstallations(installations)
      setAvailableVersions(versions)
      setSystemMemory(memory)

      // Set recommended memory if not already set
      if (!localStorage.getItem("java_min_memory") && memory) {
        setMinMemory(memory.recommended_min_mb)
        localStorage.setItem("java_min_memory", memory.recommended_min_mb.toString())
      }
      if (!localStorage.getItem("java_max_memory") && memory) {
        setMaxMemory(memory.recommended_max_mb)
        localStorage.setItem("java_max_memory", memory.recommended_max_mb.toString())
      }
    } catch (error) {
      console.error("Failed to load Java data:", error)
      toast.error(t("settings.unableToLoadJava"))
    } finally {
      setLoadingJava(false)
    }
  }, [])

  const loadStorageData = useCallback(async () => {
    setLoadingStorage(true)
    try {
      const [storage, instances, dirInfo] = await Promise.all([
        invoke<StorageInfo>("get_storage_info"),
        invoke<InstanceStorageInfo[]>("get_instances_storage"),
        invoke<InstancesDirectoryInfo>("get_instances_directory"),
      ])
      setStorageInfo(storage)
      setInstancesStorage(instances)
      setInstancesDir(dirInfo)
    } catch (error) {
      console.error("Failed to load storage data:", error)
      toast.error(t("settings.unableToLoadStorage"))
    } finally {
      setLoadingStorage(false)
    }
  }, [])

  useEffect(() => {
    loadJavaData()
  }, [loadJavaData])

  // Load app version
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"))
  }, [])

  const handleInstallJava = async (majorVersion: number) => {
    setInstallingVersion(majorVersion)
    try {
      await invoke("install_java_version", { majorVersion })
      await loadJavaData()
      toast.success(`${t("settings.javaInstalled")}: Java ${majorVersion}`)
    } catch (error) {
      console.error("Failed to install Java:", error)
      toast.error(`${t("settings.javaInstallError")}: Java ${majorVersion}`)
    } finally {
      setInstallingVersion(null)
    }
  }

  const handleUninstallJava = async (majorVersion: number) => {
    setUninstallingVersion(majorVersion)
    try {
      await invoke("uninstall_java_version", { majorVersion })
      await loadJavaData()
      toast.success(`${t("settings.javaUninstalled")}: Java ${majorVersion}`)
    } catch (error) {
      console.error("Failed to uninstall Java:", error)
      toast.error(`${t("settings.javaUninstallError")}: Java ${majorVersion}`)
    } finally {
      setUninstallingVersion(null)
    }
  }

  const handleMinMemoryChange = (value: number[]) => {
    const newMin = value[0]
    setMinMemory(newMin)
    localStorage.setItem("java_min_memory", newMin.toString())
    if (maxMemory < newMin) {
      setMaxMemory(newMin)
      localStorage.setItem("java_max_memory", newMin.toString())
    }
  }

  const handleMaxMemoryChange = (value: number[]) => {
    const newMax = value[0]
    setMaxMemory(newMax)
    localStorage.setItem("java_max_memory", newMax.toString())
    if (minMemory > newMax) {
      setMinMemory(newMax)
      localStorage.setItem("java_min_memory", newMax.toString())
    }
  }

  const handleOpenDataFolder = async () => {
    try {
      await invoke("open_data_folder")
    } catch (error) {
      console.error("Failed to open data folder:", error)
      toast.error(t("settings.openFolderError"))
    }
  }

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      const clearedBytes = await invoke<number>("clear_cache")
      await loadStorageData()
      toast.success(`${t("settings.cacheCleared")} (${formatBytes(clearedBytes)} ${t("settings.freed")})`)
    } catch (error) {
      console.error("Failed to clear cache:", error)
      toast.error(t("settings.clearCacheError"))
    } finally {
      setClearingCache(false)
    }
  }

  const handleChangeInstancesDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("settings.selectFolder"),
      })

      if (selected) {
        setChangingInstancesDir(true)
        await invoke("set_instances_directory", { path: selected })
        await loadStorageData()
        toast.success(t("settings.pathChanged"))
      }
    } catch (error) {
      console.error("Failed to change instances directory:", error)
      toast.error(t("settings.pathChangeError"))
    } finally {
      setChangingInstancesDir(false)
    }
  }

  const handleResetInstancesDir = async () => {
    setChangingInstancesDir(true)
    try {
      await invoke("set_instances_directory", { path: null })
      await loadStorageData()
      toast.success(t("settings.pathReset"))
    } catch (error) {
      console.error("Failed to reset instances directory:", error)
      toast.error(t("settings.pathChangeError"))
    } finally {
      setChangingInstancesDir(false)
    }
  }

  const handleOpenInstancesFolder = async () => {
    try {
      await invoke("open_instances_folder")
    } catch (error) {
      console.error("Failed to open instances folder:", error)
      toast.error(t("settings.openFolderError"))
    }
  }

  // Get installed major versions for quick lookup
  const installedMajorVersions = new Set(javaInstallations.map(j => j.major_version))

  // Filter available versions to show only those not installed (bundled)
  const installableVersions = availableVersions.filter(v => {
    const hasBundled = javaInstallations.some(
      j => j.major_version === v.major_version && j.is_bundled
    )
    return !hasBundled
  })

  // Memory slider max based on system memory
  const memoryMax = systemMemory ? Math.min(systemMemory.total_mb - 1024, 32768) : 16384

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="appearance" className="flex-1">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="appearance" className="gap-2">
            <Palette className="h-4 w-4" />
            {t("settings.appearance")}
          </TabsTrigger>
          <TabsTrigger value="java" className="gap-2">
            <Cpu className="h-4 w-4" />
            {t("settings.java")}
          </TabsTrigger>
          <TabsTrigger value="storage" className="gap-2" onClick={() => loadStorageData()}>
            <Database className="h-4 w-4" />
            {t("settings.storage")}
          </TabsTrigger>
          <TabsTrigger value="about" className="gap-2">
            <Info className="h-4 w-4" />
            {t("settings.about")}
          </TabsTrigger>
        </TabsList>

        {/* Appearance Tab */}
        <TabsContent value="appearance" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.appearance")}</CardTitle>
              <CardDescription>
                {t("settings.customizeAppearance")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Theme selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.theme")}</label>
                <div className="flex gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    size="sm"
                    className={cn("gap-2", theme === "light" && "bg-primary")}
                    onClick={() => setTheme("light")}
                  >
                    <Sun className="h-4 w-4" />
                    {t("settings.themeLight")}
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    size="sm"
                    className={cn("gap-2", theme === "dark" && "bg-primary")}
                    onClick={() => setTheme("dark")}
                  >
                    <Moon className="h-4 w-4" />
                    {t("settings.themeDark")}
                  </Button>
                  <Button
                    variant={theme === "system" ? "default" : "outline"}
                    size="sm"
                    className={cn("gap-2", theme === "system" && "bg-primary")}
                    onClick={() => setTheme("system")}
                  >
                    <Monitor className="h-4 w-4" />
                    {t("settings.themeSystem")}
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Language selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.language")}</label>
                <div className="flex gap-2">
                  {availableLocales.map((loc) => (
                    <Button
                      key={loc}
                      variant={locale === loc ? "default" : "outline"}
                      size="sm"
                      className={cn("gap-2", locale === loc && "bg-primary")}
                      onClick={() => setLocale(loc as Locale)}
                    >
                      <Globe className="h-4 w-4" />
                      {localeNames[loc as Locale]}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Theme customization */}
              <div className="space-y-4">
                <label className="text-sm font-medium">{t("theme.customize")}</label>
                <ThemeCustomizer />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Java Tab */}
        <TabsContent value="java" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("settings.java")}</CardTitle>
                  <CardDescription>
                    {t("settings.manageJavaMemory")}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={loadJavaData}
                  disabled={loadingJava}
                >
                  <RefreshCw className={cn("h-4 w-4", loadingJava && "animate-spin")} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Installed Java versions */}
              <div className="space-y-3">
                <label className="text-sm font-medium">{t("settings.detectedInstallations")}</label>
                {loadingJava ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : javaInstallations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("settings.noJavaDetected")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {javaInstallations.map((java, index) => (
                      <div
                        key={`${java.path}-${index}`}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Java {java.major_version}</span>
                            {java.is_bundled && (
                              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                                {t("settings.bundled")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {java.vendor} - {java.version}
                          </p>
                          <p className="text-xs text-muted-foreground truncate" title={java.path}>
                            {java.path}
                          </p>
                        </div>
                        {java.is_bundled && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleUninstallJava(java.major_version)}
                            disabled={uninstallingVersion === java.major_version}
                          >
                            {uninstallingVersion === java.major_version ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Install Java */}
              <div className="space-y-3">
                <label className="text-sm font-medium">{t("settings.installJavaTemurin")}</label>
                {loadingJava ? (
                  <p className="text-sm text-muted-foreground">{t("settings.loadingVersions")}</p>
                ) : installableVersions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("settings.allVersionsInstalled")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {installableVersions.map((version) => {
                      const isInstalled = installedMajorVersions.has(version.major_version)
                      return (
                        <Button
                          key={version.major_version}
                          variant={isInstalled ? "secondary" : "outline"}
                          size="sm"
                          className="gap-2"
                          onClick={() => handleInstallJava(version.major_version)}
                          disabled={installingVersion !== null || isInstalled}
                        >
                          {installingVersion === version.major_version ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : isInstalled ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {version.release_name}
                        </Button>
                      )
                    })}
                  </div>
                )}
              </div>

              <Separator />

              {/* Memory settings */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  <label className="text-sm font-medium">{t("settings.defaultMemory")}</label>
                </div>

                {systemMemory && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.systemMemory")} {Math.round(systemMemory.total_mb / 1024)} GB {t("settings.total")}, {Math.round(systemMemory.available_mb / 1024)} GB {t("settings.available")}
                  </p>
                )}

                {/* Memory explanation tip */}
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                  <p className="font-medium text-blue-500 mb-1">{t("ram.tipTitle")}</p>
                  <p className="text-muted-foreground text-xs">{t("ram.tipContent")}</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <label className="text-sm font-medium">{t("ram.minMemoryTitle")}</label>
                        <span className="text-sm font-medium">{minMemory} MB</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("ram.minMemoryDesc")}</p>
                    </div>
                    <Slider
                      value={[minMemory]}
                      onValueChange={handleMinMemoryChange}
                      min={512}
                      max={Math.min(maxMemory, memoryMax)}
                      step={256}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <label className="text-sm font-medium">{t("ram.maxMemoryTitle")}</label>
                        <span className="text-sm font-medium">{maxMemory} MB</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("ram.maxMemoryDesc")}</p>
                    </div>
                    <Slider
                      value={[maxMemory]}
                      onValueChange={handleMaxMemoryChange}
                      min={Math.max(minMemory, 1024)}
                      max={memoryMax}
                      step={256}
                      className="w-full"
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t("settings.defaultMemoryNote")}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Storage Tab */}
        <TabsContent value="storage" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("settings.storage")}</CardTitle>
                  <CardDescription>
                    {t("settings.manageStorage")}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenDataFolder}
                    className="gap-2"
                  >
                    <FolderOpen className="h-4 w-4" />
                    {t("common.openFolder")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={loadStorageData}
                    disabled={loadingStorage}
                  >
                    <RefreshCw className={cn("h-4 w-4", loadingStorage && "animate-spin")} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {loadingStorage ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : storageInfo ? (
                <>
                  {/* Storage overview */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t("settings.totalUsedSpace")}</span>
                      <span className="text-sm font-bold">{formatBytes(storageInfo.total_size_bytes)}</span>
                    </div>

                    <div className="space-y-2">
                      {/* Instances */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Instances ({storageInfo.instance_count})</span>
                          <span>{formatBytes(storageInfo.instances_size_bytes)}</span>
                        </div>
                        <Progress
                          value={(storageInfo.instances_size_bytes / storageInfo.total_size_bytes) * 100}
                          className="h-2"
                        />
                      </div>

                      {/* Java */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Java</span>
                          <span>{formatBytes(storageInfo.java_size_bytes)}</span>
                        </div>
                        <Progress
                          value={(storageInfo.java_size_bytes / storageInfo.total_size_bytes) * 100}
                          className="h-2"
                        />
                      </div>

                      {/* Cache */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Cache</span>
                          <span>{formatBytes(storageInfo.cache_size_bytes)}</span>
                        </div>
                        <Progress
                          value={(storageInfo.cache_size_bytes / storageInfo.total_size_bytes) * 100}
                          className="h-2"
                        />
                      </div>

                      {/* Other */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{t("common.other")} (DB, config...)</span>
                          <span>{formatBytes(storageInfo.other_size_bytes)}</span>
                        </div>
                        <Progress
                          value={(storageInfo.other_size_bytes / storageInfo.total_size_bytes) * 100}
                          className="h-2"
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground truncate" title={storageInfo.data_dir}>
                        {t("common.location")}: {storageInfo.data_dir}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Instances directory */}
                  {instancesDir && (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium">{t("settings.instancesDirectory")}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("settings.instancesDirectoryDesc")}
                        </p>
                      </div>

                      <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            instancesDir.is_custom
                              ? "bg-blue-500/20 text-blue-500"
                              : "bg-muted text-muted-foreground"
                          )}>
                            {instancesDir.is_custom ? t("settings.customPath") : t("settings.defaultPath")}
                          </span>
                        </div>
                        <p className="text-sm font-mono truncate" title={instancesDir.current_path}>
                          {instancesDir.current_path}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleChangeInstancesDir}
                          disabled={changingInstancesDir}
                          className="gap-2"
                        >
                          {changingInstancesDir ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <FolderOpen className="h-4 w-4" />
                          )}
                          {t("settings.changePath")}
                        </Button>
                        {instancesDir.is_custom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleResetInstancesDir}
                            disabled={changingInstancesDir}
                          >
                            {t("settings.resetToDefault")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleOpenInstancesFolder}
                          className="gap-2"
                        >
                          <FolderOpen className="h-4 w-4" />
                          {t("settings.openInstancesFolder")}
                        </Button>
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* Clear cache button */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{t("settings.clearCache")}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(storageInfo.cache_size_bytes)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearCache}
                      disabled={clearingCache || storageInfo.cache_size_bytes === 0}
                      className="gap-2"
                    >
                      {clearingCache ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      {t("common.clear")}
                    </Button>
                  </div>

                  <Separator />

                  {/* Instances storage */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium">{t("settings.spacePerInstance")}</label>
                    {instancesStorage.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("settings.noInstance")}</p>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {instancesStorage.map((instance) => (
                          <div
                            key={instance.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{instance.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {instance.mc_version}
                                {instance.loader && ` - ${instance.loader}`}
                              </p>
                            </div>
                            <span className="text-sm font-medium ml-4">
                              {formatBytes(instance.size_bytes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t("settings.clickToLoadStorage")}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* About Tab */}
        <TabsContent value="about" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.about")}</CardTitle>
              <CardDescription>
                {t("settings.aboutLauncher")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.application")}</span>
                  <span className="text-sm font-medium">Kaizen Launcher</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.version")}</span>
                  <span className="text-sm font-medium">{appVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.build")}</span>
                  <span className="text-sm font-medium">{t("common.development")}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => checkForUpdates()}
                  disabled={checking || installing}
                >
                  {checking ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t("updater.checking")}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t("updater.checkForUpdates")}
                    </>
                  )}
                </Button>
                {updateAvailable && updateInfo ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-primary font-medium">
                      {t("updater.newVersionAvailable", { version: updateInfo.version })}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => downloadAndInstall()}
                      disabled={installing}
                    >
                      {installing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {downloadProgress > 0 ? `${downloadProgress}%` : t("updater.installing")}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          {t("updater.installUpdate")}
                        </>
                      )}
                    </Button>
                  </div>
                ) : !checking && (
                  <span className="text-sm text-muted-foreground">
                    {t("updater.upToDate")}
                  </span>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.developedBy")}</span>
                  <span className="text-sm font-medium">Kaizen Core Team</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.license")}</span>
                  <span className="text-sm font-medium">MIT</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {t("settings.launcherDescription")}
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-2"
                  onClick={() => openUrl("https://github.com/KaizenCore")}
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-2"
                  onClick={() => openUrl("https://discord.gg/eRKRSeBxrZ")}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  Discord
                </Button>
              </div>

              <Separator />

              {/* Restart onboarding */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t("settings.restartOnboarding")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.restartOnboardingDesc")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOnboardingCompleted(false)}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  {t("settings.restartOnboardingButton")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
