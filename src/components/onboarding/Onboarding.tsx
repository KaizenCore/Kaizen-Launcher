import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { motion, AnimatePresence } from "framer-motion"
import {
  Globe,
  User,
  Palette,
  Rocket,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  ExternalLink,
  Copy,
  Monitor,
  Server,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { useTranslation, localeNames, Locale, useI18nStore } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { ThemePresets } from "@/components/theme/ThemePresets"
import { useCustomThemeStore } from "@/stores/customThemeStore"
import { useTourStore } from "@/stores/tourStore"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface OnboardingProps {
  open: boolean
  onComplete: (createdInstanceId?: string) => void
}

interface CreatedInstance {
  id: string
  name: string
}

interface DeviceCodeInfo {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
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

interface LoaderVersion {
  version: string
  stable: boolean
  minecraft_version: string | null
  download_url: string | null
}

const CLIENT_LOADERS = [
  { value: "vanilla", label: "Vanilla" },
  { value: "fabric", label: "Fabric" },
  { value: "quilt", label: "Quilt" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
]

const STEPS = [
  { id: "language", icon: Globe },
  { id: "account", icon: User },
  { id: "theme", icon: Palette },
  { id: "instance", icon: Rocket },
]

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
}

export function Onboarding({ open, onComplete }: OnboardingProps) {
  const { t } = useTranslation()
  const { locale, setLocale } = useI18nStore()
  const [currentStep, setCurrentStep] = useState(0)
  const [direction, setDirection] = useState(0)

  // Account state
  const [accountMode, setAccountMode] = useState<"select" | "microsoft" | "offline">("select")
  const [authStatus, setAuthStatus] = useState<"idle" | "device_code" | "waiting" | "success" | "error">("idle")
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [offlineUsername, setOfflineUsername] = useState("")
  const [hasAccount, setHasAccount] = useState(false)
  const timeoutRefs = useRef<NodeJS.Timeout[]>([])

  // Theme state
  const { activePresetId, setPreset } = useCustomThemeStore()

  // Instance state
  const [instanceName, setInstanceName] = useState("")
  const [mcVersion, setMcVersion] = useState("")
  const [loader, setLoader] = useState("vanilla")
  const [loaderVersion, setLoaderVersion] = useState("")
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [latestRelease, setLatestRelease] = useState("")
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false)
  const [isCreatingInstance, setIsCreatingInstance] = useState(false)
  const [instanceMode, setInstanceMode] = useState<"client" | "server">("client")

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(clearTimeout)
    }
  }, [])

  // Fetch versions when reaching instance step
  useEffect(() => {
    if (currentStep === 3 && versions.length === 0) {
      fetchVersions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  // Fetch loader versions when loader changes
  useEffect(() => {
    if (loader !== "vanilla" && mcVersion) {
      fetchLoaderVersions()
    } else {
      setLoaderVersions([])
      setLoaderVersion("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, mcVersion])

  const fetchVersions = async () => {
    setIsLoadingVersions(true)
    try {
      const result = await invoke<MinecraftVersionList>("get_minecraft_versions", {
        includeSnapshots: false,
      })
      setVersions(result.versions)
      setLatestRelease(result.latest_release)
      if (!mcVersion && result.latest_release) {
        setMcVersion(result.latest_release)
      }
    } catch (err) {
      console.error("Failed to fetch versions:", err)
    } finally {
      setIsLoadingVersions(false)
    }
  }

  const fetchLoaderVersions = async () => {
    if (loader === "vanilla" || !mcVersion) return
    setIsLoadingLoaderVersions(true)
    try {
      const result = await invoke<LoaderVersion[]>("get_loader_versions", {
        loaderType: loader,
        mcVersion: mcVersion,
      })
      setLoaderVersions(result)
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

  const goNext = () => {
    if (currentStep < STEPS.length - 1) {
      // Clear any pending timeouts to prevent double-advancing
      timeoutRefs.current.forEach(clearTimeout)
      timeoutRefs.current = []
      setDirection(1)
      setCurrentStep(prev => prev + 1)
    }
  }

  const goPrev = () => {
    if (currentStep > 0) {
      // Clear any pending timeouts
      timeoutRefs.current.forEach(clearTimeout)
      timeoutRefs.current = []
      setDirection(-1)
      setCurrentStep(prev => prev - 1)
    }
  }

  // Microsoft Auth
  const startMicrosoftLogin = async () => {
    setAuthStatus("device_code")
    setAuthError(null)
    setCopied(false)

    try {
      const codeInfo = await invoke<DeviceCodeInfo>("login_microsoft_start")
      setDeviceCode(codeInfo)
      openUrl(codeInfo.verification_uri)
      setAuthStatus("waiting")

      await invoke("login_microsoft_complete", {
        deviceCode: codeInfo.device_code,
        interval: codeInfo.interval,
        expiresIn: codeInfo.expires_in,
      })

      setAuthStatus("success")
      setHasAccount(true)
      const timeout = setTimeout(() => {
        goNext()
        resetAccountState()
      }, 1500)
      timeoutRefs.current.push(timeout)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
      setAuthStatus("error")
    }
  }

  const createOfflineAccount = async () => {
    if (!offlineUsername.trim()) {
      setAuthError(t("dialogs.addAccount.enterUsername"))
      return
    }

    setAuthStatus("waiting")
    setAuthError(null)

    try {
      await invoke("create_offline_account", { username: offlineUsername.trim() })
      setAuthStatus("success")
      setHasAccount(true)
      const timeout = setTimeout(() => {
        goNext()
        resetAccountState()
      }, 1500)
      timeoutRefs.current.push(timeout)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
      setAuthStatus("error")
    }
  }

  const copyCode = async () => {
    if (deviceCode) {
      try {
        await navigator.clipboard.writeText(deviceCode.user_code)
        setCopied(true)
        const timeout = setTimeout(() => setCopied(false), 2000)
        timeoutRefs.current.push(timeout)
      } catch {
        // Clipboard API not available
      }
    }
  }

  const resetAccountState = () => {
    setAccountMode("select")
    setDeviceCode(null)
    setAuthError(null)
    setAuthStatus("idle")
    setCopied(false)
    setOfflineUsername("")
  }

  // Tour store
  const { setPendingTour } = useTourStore()

  // Create Instance
  const handleCreateInstance = async () => {
    if (!instanceName.trim() || !mcVersion) return

    setIsCreatingInstance(true)
    try {
      const instance = await invoke<CreatedInstance>("create_instance", {
        name: instanceName.trim(),
        mcVersion: mcVersion,
        loader: loader === "vanilla" ? null : loader,
        loaderVersion: loaderVersion || null,
        isServer: instanceMode === "server",
        isProxy: false,
        serverPort: instanceMode === "server" ? 25565 : null,
      })
      // Set pending tour for the created instance
      setPendingTour(instance.id)
      onComplete(instance.id)
    } catch (err) {
      console.error("Failed to create instance:", err)
    } finally {
      setIsCreatingInstance(false)
    }
  }

  const handleSkipInstance = () => {
    onComplete()
  }

  const canProceed = () => {
    switch (currentStep) {
      case 0: return true // Language always ok
      case 1: return hasAccount || authStatus === "success" // Need account
      case 2: return true // Theme always ok
      case 3: return instanceName.trim() && mcVersion // Need name and version
      default: return true
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-background">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-secondary/5" />

      {/* Content */}
      <div className="relative h-full flex flex-col">
        {/* Progress bar */}
        <div className="px-8 pt-8">
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((step, index) => {
              const Icon = step.icon
              const isActive = index === currentStep
              const isCompleted = index < currentStep

              return (
                <div key={step.id} className="flex items-center">
                  <motion.div
                    className={cn(
                      "flex items-center justify-center w-10 h-10 rounded-full transition-colors",
                      isActive && "bg-primary text-primary-foreground",
                      isCompleted && "bg-primary/20 text-primary",
                      !isActive && !isCompleted && "bg-muted text-muted-foreground"
                    )}
                    animate={{
                      scale: isActive ? 1.1 : 1,
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    {isCompleted ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </motion.div>
                  {index < STEPS.length - 1 && (
                    <div className={cn(
                      "w-12 h-1 mx-2 rounded-full transition-colors",
                      index < currentStep ? "bg-primary" : "bg-muted"
                    )} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 flex items-center justify-center px-8 py-12 overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="w-full max-w-lg"
            >
              {/* Step 1: Language */}
              {currentStep === 0 && (
                <div className="text-center space-y-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="flex justify-center"
                  >
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                      <Globe className="w-10 h-10 text-primary" />
                    </div>
                  </motion.div>
                  <div>
                    <h1 className="text-3xl font-bold">{t("onboarding.languageTitle")}</h1>
                    <p className="text-muted-foreground mt-2">{t("onboarding.languageSubtitle")}</p>
                  </div>
                  <div className="flex justify-center gap-4">
                    {(["en", "fr"] as Locale[]).map((lang) => (
                      <motion.button
                        key={lang}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setLocale(lang)}
                        className={cn(
                          "px-8 py-4 rounded-xl border-2 transition-all",
                          locale === lang
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <span className="text-2xl mb-2 block">{lang === "en" ? "🇬🇧" : "🇫🇷"}</span>
                        <span className="font-medium">{localeNames[lang]}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Account */}
              {currentStep === 1 && (
                <div className="text-center space-y-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="flex justify-center"
                  >
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="w-10 h-10 text-primary" />
                    </div>
                  </motion.div>
                  <div>
                    <h1 className="text-3xl font-bold">{t("onboarding.accountTitle")}</h1>
                    <p className="text-muted-foreground mt-2">{t("onboarding.accountSubtitle")}</p>
                  </div>

                  {accountMode === "select" && authStatus === "idle" && !hasAccount && (
                    <div className="space-y-3 max-w-sm mx-auto">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setAccountMode("microsoft")}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-border hover:border-primary/50 transition-all text-left"
                      >
                        <div className="bg-[#00a2ed] p-3 rounded-lg">
                          <ExternalLink className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">{t("accounts.microsoft")}</div>
                          <div className="text-sm text-muted-foreground">{t("dialogs.addAccount.officialLogin")}</div>
                        </div>
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setAccountMode("offline")}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-border hover:border-primary/50 transition-all text-left"
                      >
                        <div className="bg-gray-500 p-3 rounded-lg">
                          <User className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">{t("accounts.offline")}</div>
                          <div className="text-sm text-muted-foreground">{t("dialogs.addAccount.forDevTest")}</div>
                        </div>
                      </motion.button>
                    </div>
                  )}

                  {accountMode === "microsoft" && authStatus === "idle" && (
                    <div className="space-y-4 max-w-sm mx-auto">
                      <p className="text-sm text-muted-foreground">{t("dialogs.addAccount.microsoftInstructions")}</p>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setAccountMode("select")}>
                          <ChevronLeft className="h-4 w-4 mr-2" />
                          {t("common.back")}
                        </Button>
                        <Button className="flex-1" onClick={startMicrosoftLogin}>
                          {t("dialogs.addAccount.signIn")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {accountMode === "offline" && authStatus === "idle" && (
                    <div className="space-y-4 max-w-sm mx-auto">
                      <div className="space-y-2 text-left">
                        <Label htmlFor="username">{t("accounts.offlineUsername")}</Label>
                        <Input
                          id="username"
                          placeholder="Steve"
                          value={offlineUsername}
                          onChange={(e) => setOfflineUsername(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && createOfflineAccount()}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setAccountMode("select")}>
                          <ChevronLeft className="h-4 w-4 mr-2" />
                          {t("common.back")}
                        </Button>
                        <Button className="flex-1" onClick={createOfflineAccount}>
                          {t("dialogs.addAccount.createAccount")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {(authStatus === "device_code" || authStatus === "waiting") && deviceCode && (
                    <div className="space-y-4 max-w-sm mx-auto">
                      <p className="text-sm text-muted-foreground">{t("dialogs.addAccount.enterCodeOnSite")}</p>
                      <div className="bg-muted rounded-xl p-6 relative">
                        <p className="text-4xl font-mono font-bold tracking-widest select-all">
                          {deviceCode.user_code}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-2"
                          onClick={copyCode}
                        >
                          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <Button variant="outline" className="gap-2" onClick={() => openUrl(deviceCode.verification_uri)}>
                        <ExternalLink className="h-4 w-4" />
                        {t("dialogs.addAccount.openMicrosoftLink")}
                      </Button>
                      {authStatus === "waiting" && (
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("accounts.waitingAuth")}
                        </div>
                      )}
                    </div>
                  )}

                  {authStatus === "success" && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="space-y-2"
                    >
                      <div className="flex justify-center">
                        <div className="rounded-full bg-green-500/20 p-4">
                          <Check className="h-10 w-10 text-green-500" />
                        </div>
                      </div>
                      <p className="font-medium text-green-500">{t("dialogs.addAccount.success")}</p>
                    </motion.div>
                  )}

                  {authStatus === "error" && (
                    <div className="space-y-4 max-w-sm mx-auto">
                      <div className="rounded-lg bg-destructive/10 p-4">
                        <p className="text-sm text-destructive">{authError}</p>
                      </div>
                      <Button variant="outline" onClick={() => setAuthStatus("idle")}>
                        {t("dialogs.addAccount.retry")}
                      </Button>
                    </div>
                  )}

                  {hasAccount && authStatus === "idle" && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="space-y-4"
                    >
                      <div className="flex justify-center">
                        <div className="rounded-full bg-green-500/20 p-4">
                          <Check className="h-10 w-10 text-green-500" />
                        </div>
                      </div>
                      <p className="font-medium text-green-500">{t("onboarding.accountAdded")}</p>
                    </motion.div>
                  )}
                </div>
              )}

              {/* Step 3: Theme */}
              {currentStep === 2 && (
                <div className="text-center space-y-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="flex justify-center"
                  >
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                      <Palette className="w-10 h-10 text-primary" />
                    </div>
                  </motion.div>
                  <div>
                    <h1 className="text-3xl font-bold">{t("onboarding.themeTitle")}</h1>
                    <p className="text-muted-foreground mt-2">{t("onboarding.themeSubtitle")}</p>
                  </div>
                  <div className="max-w-md mx-auto">
                    <ThemePresets
                      activePresetId={activePresetId}
                      onSelectPreset={setPreset}
                    />
                  </div>
                </div>
              )}

              {/* Step 4: Create Instance */}
              {currentStep === 3 && (
                <div className="text-center space-y-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="flex justify-center"
                  >
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                      <Rocket className="w-10 h-10 text-primary" />
                    </div>
                  </motion.div>
                  <div>
                    <h1 className="text-3xl font-bold">{t("onboarding.instanceTitle")}</h1>
                    <p className="text-muted-foreground mt-2">{t("onboarding.instanceSubtitle")}</p>
                  </div>

                  <div className="space-y-4 max-w-sm mx-auto text-left">
                    {/* Mode toggle */}
                    <div className="flex gap-2 justify-center">
                      <Button
                        variant={instanceMode === "client" ? "default" : "outline"}
                        onClick={() => setInstanceMode("client")}
                        className="gap-2"
                      >
                        <Monitor className="h-4 w-4" />
                        {t("createInstance.client")}
                      </Button>
                      <Button
                        variant={instanceMode === "server" ? "default" : "outline"}
                        onClick={() => setInstanceMode("server")}
                        className="gap-2"
                      >
                        <Server className="h-4 w-4" />
                        {t("createInstance.server")}
                      </Button>
                    </div>

                    {/* Instance name */}
                    <div className="space-y-2">
                      <Label htmlFor="instanceName">{t("createInstance.name")}</Label>
                      <Input
                        id="instanceName"
                        placeholder={t("createInstance.namePlaceholder")}
                        value={instanceName}
                        onChange={(e) => setInstanceName(e.target.value)}
                      />
                    </div>

                    {/* Minecraft version */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{t("createInstance.minecraftVersion")}</Label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={fetchVersions}
                          disabled={isLoadingVersions}
                        >
                          <RefreshCw className={cn("h-3 w-3", isLoadingVersions && "animate-spin")} />
                        </Button>
                      </div>
                      <Select value={mcVersion} onValueChange={setMcVersion} disabled={isLoadingVersions}>
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingVersions ? t("common.loading") : t("createInstance.minecraftVersion")} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {versions.slice(0, 20).map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.id}{v.id === latestRelease ? " - Latest" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Mod loader (client only) */}
                    {instanceMode === "client" && (
                      <div className="space-y-2">
                        <Label>{t("createInstance.modLoader")}</Label>
                        <Select value={loader} onValueChange={setLoader}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CLIENT_LOADERS.map((l) => (
                              <SelectItem key={l.value} value={l.value}>
                                {l.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Loader version */}
                    {loader !== "vanilla" && instanceMode === "client" && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>{t("createInstance.loaderVersion")}</Label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={fetchLoaderVersions}
                            disabled={isLoadingLoaderVersions}
                          >
                            <RefreshCw className={cn("h-3 w-3", isLoadingLoaderVersions && "animate-spin")} />
                          </Button>
                        </div>
                        <Select
                          value={loaderVersion}
                          onValueChange={setLoaderVersion}
                          disabled={isLoadingLoaderVersions || loaderVersions.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={isLoadingLoaderVersions ? t("common.loading") : t("createInstance.loaderVersion")} />
                          </SelectTrigger>
                          <SelectContent className="max-h-[200px]">
                            {loaderVersions.map((v) => (
                              <SelectItem key={v.version} value={v.version}>
                                {v.version}{v.stable ? "" : " (beta)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation buttons */}
        <div className="px-8 pb-8">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <Button
              variant="ghost"
              onClick={goPrev}
              disabled={currentStep === 0}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("common.back")}
            </Button>

            <div className="flex gap-2">
              {currentStep === 3 && (
                <Button variant="ghost" onClick={handleSkipInstance}>
                  {t("common.skip")}
                </Button>
              )}

              {currentStep < STEPS.length - 1 ? (
                <Button
                  onClick={goNext}
                  disabled={!canProceed()}
                  className="gap-2"
                >
                  {t("common.next")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleCreateInstance}
                  disabled={!canProceed() || isCreatingInstance}
                  className="gap-2"
                >
                  {isCreatingInstance ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {t("onboarding.letsGo")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
