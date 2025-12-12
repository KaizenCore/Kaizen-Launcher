import { lazy, Suspense, useState, useEffect, useCallback, useRef } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { Toaster, toast } from "sonner"
import { Loader2 } from "lucide-react"
import { MainLayout } from "@/components/layout/MainLayout"
import { Home } from "@/pages/Home"
import { Onboarding } from "@/components/onboarding/Onboarding"
import { TourOverlay } from "@/components/onboarding/TourOverlay"
import { UpdateNotification } from "@/components/notifications/UpdateNotification"
import { DevMonitor } from "@/components/dev/DevMonitor"
import { useOnboardingStore } from "@/stores/onboardingStore"
import { useTheme } from "@/hooks/useTheme"
import { useUpdateChecker } from "@/hooks/useUpdateChecker"

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

// Loading fallback for lazy components
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

function App() {
  const { completed, setCompleted } = useOnboardingStore()
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

  // Dev Monitor state
  const [devMonitorVisible, setDevMonitorVisible] = useState(false)

  // Keyboard shortcut: Ctrl+Shift+D (or Cmd+Shift+D on Mac)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault()
      setDevMonitorVisible(prev => !prev)
    }
  }, [])

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

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Home />} />
            <Route path="instances" element={<Suspense fallback={<PageLoader />}><Instances /></Suspense>} />
            <Route path="instances/:instanceId" element={<Suspense fallback={<PageLoader />}><InstanceDetails /></Suspense>} />
            <Route path="browse" element={<Suspense fallback={<PageLoader />}><Browse /></Suspense>} />
            <Route path="browse/modpack/:projectId" element={<Suspense fallback={<PageLoader />}><ModpackDetails /></Suspense>} />
            <Route path="backups" element={<Suspense fallback={<PageLoader />}><Backups /></Suspense>} />
            <Route path="sharing" element={<Suspense fallback={<PageLoader />}><Sharing /></Suspense>} />
            <Route path="accounts" element={<Suspense fallback={<PageLoader />}><Accounts /></Suspense>} />
            <Route path="skins" element={<Suspense fallback={<PageLoader />}><Skins /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
            <Route path="changelog" element={<Suspense fallback={<PageLoader />}><Changelog /></Suspense>} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        theme={resolvedTheme}
      />
      <Onboarding
        open={!completed}
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
    </>
  )
}

export default App
