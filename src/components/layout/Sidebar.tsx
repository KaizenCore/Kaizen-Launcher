import { useState, useEffect } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  Home,
  Layers,
  Search,
  Archive,
  User,
  Settings,
  Sparkles,
  Share2,
  Palette,
  Boxes,
  type LucideIcon
} from "lucide-react"
import { useTranslation } from "@/i18n"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from "@/components/ui/tooltip"
import { useSharingStore } from "@/stores/sharingStore"

interface Account {
  id: string
  uuid: string
  username: string
  access_token: string
  refresh_token: string
  is_active: boolean
}

function isOfflineAccount(account: Account): boolean {
  return (
    account.access_token === "offline" ||
    account.refresh_token === "offline" ||
    account.access_token.length < 50
  )
}

interface NavItemProps {
  to: string
  icon: LucideIcon
  label: string
  exact?: boolean
}

function NavItem({ to, icon: Icon, label, exact = false }: NavItemProps) {
  const location = useLocation()
  const isActive = exact
    ? location.pathname === to
    : location.pathname.startsWith(to)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200",
            isActive
              ? "text-primary-foreground bg-primary shadow-md"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}
        >
          {isActive && (
            <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-full" />
          )}
          <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function NavItemWithBadge({ to, icon: Icon, label, badge, exact = false }: NavItemProps & { badge?: number }) {
  const location = useLocation()
  const isActive = exact
    ? location.pathname === to
    : location.pathname.startsWith(to)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200",
            isActive
              ? "text-primary-foreground bg-primary shadow-md"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}
        >
          {isActive && (
            <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-full" />
          )}
          <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
          {badge !== undefined && badge > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-green-500 rounded-full">
              {badge}
            </span>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const location = useLocation()
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)
  const activeSeedsCount = useSharingStore((state) => state.activeSeeds.size)
  const syncSharing = useSharingStore((state) => state.syncWithBackend)

  // Sync sharing store with backend on mount
  useEffect(() => {
    syncSharing()
  }, [syncSharing])

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    let isPaused = false
    let unlisten: (() => void) | null = null

    const loadActiveAccount = async () => {
      // Skip if page is hidden (visibility optimization)
      if (document.hidden || isPaused) return

      try {
        const account = await invoke<Account | null>("get_active_account")
        if (account) {
          console.log(`[Sidebar] Active account loaded: ${account.username}`)
        }
        setActiveAccount(account)
      } catch (err) {
        console.error("[Sidebar] Failed to load active account:", err)
      }
    }

    const startPolling = () => {
      if (interval) clearInterval(interval)
      // PERFORMANCE: Increased from 10s to 30s - active account rarely changes
      // We also reload on window focus, so polling can be very infrequent
      interval = setInterval(loadActiveAccount, 30000)
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
        loadActiveAccount()
        startPolling()
      }
    }

    // Listen for account change events from the backend
    listen("active-account-changed", () => {
      console.log("[Sidebar] Received active-account-changed event")
      loadActiveAccount()
    }).then((fn) => {
      unlisten = fn
    })

    loadActiveAccount()
    startPolling()

    const handleFocus = () => loadActiveAccount()
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      if (interval) clearInterval(interval)
      if (unlisten) unlisten()
    }
  }, [])

  const isAccountsActive = location.pathname === "/accounts"

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex flex-col items-center py-4 px-3 bg-secondary/20 border-r border-border/50">
        {/* Main navigation */}
        <nav className="flex flex-col items-center gap-2">
          <NavItem to="/" icon={Home} label={t("nav.home")} exact />
          <NavItem to="/instances" icon={Layers} label={t("nav.instances")} />
          <NavItem to="/browse" icon={Search} label={t("nav.browse")} />
          <NavItem to="/backups" icon={Archive} label={t("nav.backups")} />
          <NavItem to="/schematics" icon={Boxes} label={t("nav.schematics")} exact />
          <NavItemWithBadge to="/sharing" icon={Share2} label={t("nav.sharing")} badge={activeSeedsCount} exact />
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom navigation */}
        <Separator className="my-4 bg-border/50" />
        <nav className="flex flex-col items-center gap-2">
          {/* Account button with avatar */}
          <Tooltip>
            <TooltipTrigger asChild>
              {activeAccount ? (
                <NavLink
                  to="/accounts"
                  className={cn(
                    "relative block rounded-lg overflow-hidden transition-all",
                    isAccountsActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                  style={{
                    boxShadow: !isAccountsActive
                      ? isOfflineAccount(activeAccount)
                        ? "0 0 0 2px #f97316"
                        : "0 0 0 2px #22c55e"
                      : undefined,
                  }}
                >
                  {isAccountsActive && (
                    <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-full z-10" />
                  )}
                  <img
                    src={`https://mc-heads.net/avatar/${activeAccount.username}/36`}
                    alt={activeAccount.username}
                    className="w-9 h-9 block"
                  />
                </NavLink>
              ) : (
                <NavLink
                  to="/accounts"
                  className={cn(
                    "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200",
                    isAccountsActive
                      ? "text-primary-foreground bg-primary shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  {isAccountsActive && (
                    <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-full" />
                  )}
                  <User size={20} strokeWidth={isAccountsActive ? 2 : 1.5} />
                </NavLink>
              )}
            </TooltipTrigger>
            <TooltipContent side="right">
              {activeAccount
                ? `${activeAccount.username} (${isOfflineAccount(activeAccount) ? t("accounts.offline") : "Microsoft"})`
                : t("nav.accounts")
              }
            </TooltipContent>
          </Tooltip>
          <NavItem to="/skins" icon={Palette} label={t("nav.skins")} exact />
          <NavItem to="/changelog" icon={Sparkles} label={t("nav.changelog")} exact />
          <NavItem to="/settings" icon={Settings} label={t("nav.settings")} exact />
        </nav>
      </aside>
    </TooltipProvider>
  )
}
