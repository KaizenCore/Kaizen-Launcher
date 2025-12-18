import { lazy, Suspense, useState, useEffect, useCallback, useRef } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { AnimatePresence } from "framer-motion"
import { Toaster, toast } from "sonner"
import { Loader2 } from "lucide-react"
import { MainLayout } from "@/components/layout/MainLayout"
import { Home } from "@/pages/Home"
import { Onboarding } from "@/components/onboarding/Onboarding"
import { TourOverlay } from "@/components/onboarding/TourOverlay"
import { SystemCheck } from "@/components/system-check"
import { SplashScreen } from "@/components/splash/SplashScreen"
import { UpdateNotification } from "@/components/notifications/UpdateNotification"
import { DevMonitor } from "@/components/dev/DevMonitor"
import { BugReportDialog } from "@/components/dev/BugReportDialog"
import { MajorUpdateDialog } from "@/components/dialogs/MajorUpdateDialog"
import { useOnboardingStore } from "@/stores/onboardingStore"
import { useSystemCheckStore } from "@/stores/systemCheckStore"
import { useDevModeStore } from "@/stores/devModeStore"
import { useTheme } from "@/hooks/useTheme"
import { useUpdateChecker } from "@/hooks/useUpdateChecker"
import { useTranslation } from "@/i18n"

// Set up console interception to send logs to backend buffer
// This runs once at module load to capture all console output
const setupConsoleInterception = (() => {
  let initialized = false

  return () => {
    if (initialized) return
    initialized = true

    const originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    }

    const sendToBackend = (level: string, args: unknown[]) => {
      const message = args.map(arg => {
        if (typeof arg === "string") return arg
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }).join(" ")

      // Don't log empty messages or recursive calls
      if (!message || message.includes("[Backend Log]")) return

      // Send to backend asynchronously (fire and forget)
      invoke("add_frontend_log", {
        level,
        target: "frontend",
        message,
      }).catch(() => {
        // Silently ignore errors to avoid infinite loops
      })
    }

    console.log = (...args: unknown[]) => {
      originalConsole.log(...args)
      sendToBackend("INFO", args)
    }

    console.info = (...args: unknown[]) => {
      originalConsole.info(...args)
      sendToBackend("INFO", args)
    }

    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args)
      sendToBackend("WARN", args)
    }

    console.error = (...args: unknown[]) => {
      originalConsole.error(...args)
      sendToBackend("ERROR", args)
    }

    console.debug = (...args: unknown[]) => {
      originalConsole.debug(...args)
      sendToBackend("DEBUG", args)
    }
  }
})()

// Initialize console interception immediately
setupConsoleInterception()

// Lazy load pages for better initial bundle size
const Instances = lazy(() => import("@/pages/Instances").then(m => ({ default: m.Instances })))
const InstanceDetails = lazy(() => import("@/pages/InstanceDetails").then(m => ({ default: m.InstanceDetails })))
const Browse = lazy(() => import("@/pages/Browse").then(m => ({ default: m.Browse })))
const ModpackDetails = lazy(() => import("@/pages/ModpackDetails").then(m => ({ default: m.ModpackDetails })))
const Backups = lazy(() => import("@/pages/Backups").then(m => ({ default: m.Backups })))
const Accounts = lazy(() => import("@/pages/Accounts").then(m => ({ default: m.Accounts })))
const Settings = lazy(() => import("@/pages/Settings").then(m => ({ default: m.Settings })))
const Changelog = lazy(() => import("@/pages/Changelog"))
const Sharing = lazy(() => import("@/pages/Sharing").then(m => ({ default: m.Sharing })))
const Skins = lazy(() => import("@/pages/Skins").then(m => ({ default: m.Skins })))
const Schematics = lazy(() => import("@/pages/Schematics").then(m => ({ default: m.Schematics })))
const CreateServerFromClient = lazy(() => import("@/pages/CreateServerFromClient").then(m => ({ default: m.CreateServerFromClient })))
const LogViewer = lazy(() => import("@/pages/LogViewer"))

// Loading fallback for lazy components
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

function App() {
  console.log("[App] Kaizen Launcher initializing...")
  const { t } = useTranslation()
  const { completed, setCompleted } = useOnboardingStore()
  const {
    hasCheckedThisSession,
    java,
    cloudflare,
    cloudflareSkipped,
    setHasCheckedThisSession,
  } = useSystemCheckStore()
  const { enabled: devModeEnabled, load: loadDevMode, openLogViewer } = useDevModeStore()
  const { resolvedTheme } = useTheme()
  const {
    updateAvailable,
    updateInfo,
    installing,
    downloadProgress,
    error,
    downloadAndInstall,
    dismissUpdate,
  } = useUpdateChecker(true)

  // Splash screen state
  const [showSplash, setShowSplash] = useState(true)
  const [splashProgress, setSplashProgress] = useState(0)
  const [splashMessage, setSplashMessage] = useState("Loading...")

  // Dev Monitor state
  const [devMonitorVisible, setDevMonitorVisible] = useState(false)
  // Bug Report Dialog state
  const [bugReportOpen, setBugReportOpen] = useState(false)

  // Splash screen progress animation
  useEffect(() => {
    if (!showSplash) return

    // Animate progress bar
    const stages = [
      { progress: 20, message: t("common.loading"), delay: 100 },
      { progress: 40, message: t("systemCheck.checking"), delay: 300 },
      { progress: 70, message: t("systemCheck.checking"), delay: 500 },
      { progress: 100, message: t("common.ready"), delay: 700 },
    ]

    const timeouts: NodeJS.Timeout[] = []

    stages.forEach(({ progress, message, delay }) => {
      const timeout = setTimeout(() => {
        setSplashProgress(progress)
        setSplashMessage(message)
      }, delay)
      timeouts.push(timeout)
    })

    // Hide splash after progress completes
    const hideTimeout = setTimeout(() => {
      setShowSplash(false)
    }, 1000)
    timeouts.push(hideTimeout)

    return () => {
      timeouts.forEach(clearTimeout)
    }
  }, [showSplash, t])

  // Load dev mode state on mount
  useEffect(() => {
    loadDevMode()
  }, [loadDevMode])

  // Determine if system check needs to be shown
  // Show if: not checked this session OR Java is missing/error/installing
  // OR Cloudflare is missing/error/installing (and not skipped)
  const needsSystemCheck = !hasCheckedThisSession ||
    java.status === "missing" ||
    java.status === "error" ||
    java.status === "installing" ||
    ((cloudflare.status === "missing" || cloudflare.status === "error" || cloudflare.status === "installing") && !cloudflareSkipped)

  // Onboarding shows only after system check is complete
  const showOnboarding = !needsSystemCheck && !completed

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      const key = e.key.toLowerCase()

      // Ctrl+Shift+D: Toggle DevMonitor
      if (key === "d") {
        e.preventDefault()
        setDevMonitorVisible(prev => !prev)
      }

      // Ctrl+Shift+B: Open Bug Report (only if dev mode enabled)
      if (key === "b" && devModeEnabled) {
        e.preventDefault()
        setBugReportOpen(true)
      }

      // Ctrl+Shift+L: Open Log Viewer (only if dev mode enabled)
      if (key === "l" && devModeEnabled) {
        e.preventDefault()
        openLogViewer().catch(console.error)
      }
    }
  }, [devModeEnabled, openLogViewer])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Restore persistent shares on app startup
  const sharesRestored = useRef(false)
  useEffect(() => {
    if (sharesRestored.current) return
    sharesRestored.current = true

    const restoreShares = async () => {
      try {
        interface ActiveShare {
          share_id: string
          instance_name: string
          public_url: string | null
        }
        const restored = await invoke<ActiveShare[]>("restore_shares")
        if (restored.length > 0) {
          toast.success(`${restored.length} partage(s) restauré(s)`, {
            description: restored.map(s => s.instance_name).join(", "),
          })
        }
      } catch (err) {
        console.error("[SHARE] Failed to restore shares:", err)
      }
    }

    restoreShares()
  }, [])

  // Sync Kaizen accounts on app startup (refresh tags, badges, permissions)
  const kaizenSynced = useRef(false)
  useEffect(() => {
    if (kaizenSynced.current) return
    kaizenSynced.current = true

    const syncKaizenAccounts = async () => {
      try {
        await invoke("sync_kaizen_accounts")
        console.log("[KAIZEN] Accounts synced successfully")
      } catch (err) {
        console.error("[KAIZEN] Failed to sync accounts:", err)
      }
    }

    syncKaizenAccounts()
  }, [])

  return (
    <>
      {/* Splash Screen */}
      <AnimatePresence>
        {showSplash && (
          <SplashScreen progress={splashProgress} message={splashMessage} />
        )}
      </AnimatePresence>

      <BrowserRouter>
        <Routes>
          {/* Log Viewer - separate window without MainLayout */}
          <Route path="log-viewer" element={<Suspense fallback={<PageLoader />}><LogViewer /></Suspense>} />
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Home />} />
            <Route path="instances" element={<Suspense fallback={<PageLoader />}><Instances /></Suspense>} />
            <Route path="instances/:instanceId" element={<Suspense fallback={<PageLoader />}><InstanceDetails /></Suspense>} />
            <Route path="instances/:instanceId/create-server" element={<Suspense fallback={<PageLoader />}><CreateServerFromClient /></Suspense>} />
            <Route path="browse" element={<Suspense fallback={<PageLoader />}><Browse /></Suspense>} />
            <Route path="browse/modpack/:projectId" element={<Suspense fallback={<PageLoader />}><ModpackDetails /></Suspense>} />
            <Route path="backups" element={<Suspense fallback={<PageLoader />}><Backups /></Suspense>} />
            <Route path="sharing" element={<Suspense fallback={<PageLoader />}><Sharing /></Suspense>} />
            <Route path="schematics" element={<Suspense fallback={<PageLoader />}><Schematics /></Suspense>} />
            <Route path="accounts" element={<Suspense fallback={<PageLoader />}><Accounts /></Suspense>} />
            <Route path="skins" element={<Suspense fallback={<PageLoader />}><Skins /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
            <Route path="changelog" element={<Suspense fallback={<PageLoader />}><Changelog /></Suspense>} />
          </Route>
        </Routes>
        <MajorUpdateDialog />
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        theme={resolvedTheme}
      />
      {/* System Check - runs first, before onboarding */}
      <SystemCheck
        open={needsSystemCheck}
        onComplete={() => setHasCheckedThisSession(true)}
      />
      {/* Onboarding - only shows after system check passes */}
      <Onboarding
        open={showOnboarding}
        onComplete={(instanceId) => {
          setCompleted(true)
          // Navigate to the created instance if provided
          if (instanceId) {
            // Use history.pushState to navigate without full reload
            setTimeout(() => {
              window.history.pushState({}, "", `/instances/${instanceId}`)
              window.dispatchEvent(new PopStateEvent("popstate"))
            }, 100)
          }
        }}
      />
      <TourOverlay />
      <UpdateNotification
        open={updateAvailable}
        updateInfo={updateInfo}
        downloading={installing}
        downloadProgress={downloadProgress}
        error={error}
        onDownload={downloadAndInstall}
        onDismiss={dismissUpdate}
      />
      <DevMonitor
        visible={devMonitorVisible}
        onClose={() => setDevMonitorVisible(false)}
      />
      <BugReportDialog
        open={bugReportOpen}
        onOpenChange={setBugReportOpen}
      />
    </>
  )
}

export default App
