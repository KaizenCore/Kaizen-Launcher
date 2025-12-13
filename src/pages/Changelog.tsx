import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Sparkles,
  Cloud,
  Shield,
  Globe,
  Users,
  Gamepad2,
  Settings,
  Archive,
  Zap,
  MessageSquare,
  Bell,
  Bug,
  Wrench,
  FileCode,
  Monitor,
  Gauge,
  Database,
  RefreshCw,
  Cpu,
  Share2,
  Download,
  Package,
  Palette,
  Camera,
  Heart,
  Upload,
  Layout,
  Network,
  Terminal,
  ScrollText,
} from "lucide-react"
import { useTranslation } from "@/i18n"

interface ChangelogEntry {
  version: string
  date: string
  highlights?: string[]
  features: {
    icon: React.ReactNode
    title: string
    description: string
    tag?: "new" | "improved" | "fix"
  }[]
}

const changelog: ChangelogEntry[] = [
  {
    version: "0.5.7",
    date: "2025-12-13",
    highlights: [
      "Dev Tools System",
      "Log Viewer Window",
      "Bug Report via Discord",
    ],
    features: [
      {
        icon: <Terminal className="h-5 w-5" />,
        title: "Dev Tools System",
        description: "New Dev Mode toggle in Settings > DevTools. When enabled, access powerful debugging tools with keyboard shortcuts: Ctrl+Shift+D (DevMonitor), Ctrl+Shift+L (Log Viewer), Ctrl+Shift+B (Bug Report).",
        tag: "new",
      },
      {
        icon: <ScrollText className="h-5 w-5" />,
        title: "Log Viewer Window",
        description: "Dedicated window showing real-time logs from both frontend and backend. Filter by log level (info, warn, error), search, pause/resume, and download logs. Perfect for debugging issues.",
        tag: "new",
      },
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Bug Report via Discord",
        description: "Submit bug reports directly to a Discord webhook. Includes automatic screenshot capture (without the modal visible), system info, and recent logs. Configure your webhook URL in Settings > DevTools.",
        tag: "new",
      },
      {
        icon: <FileCode className="h-5 w-5" />,
        title: "Comprehensive Logging",
        description: "Added detailed console logs throughout the entire application. All user actions, API calls, and state changes are now logged with consistent prefixes like [Home], [Modrinth], [Skins], etc.",
        tag: "improved",
      },
      {
        icon: <Camera className="h-5 w-5" />,
        title: "Screenshot Capture Fix",
        description: "Bug report screenshots are now captured before the dialog appears, ensuring the actual app content is visible instead of the modal overlay.",
        tag: "fix",
      },
    ],
  },
  {
    version: "0.5.6",
    date: "2025-12-13",
    highlights: [
      "Settings Sub-Tabs",
      "Auto-Save Settings",
      "Improved General Tab",
    ],
    features: [
      {
        icon: <Settings className="h-5 w-5" />,
        title: "Settings Sub-Tabs",
        description: "Instance settings are now organized into sub-tabs: General, Performance, Backups, and Server. Easier navigation and better organization.",
        tag: "new",
      },
      {
        icon: <RefreshCw className="h-5 w-5" />,
        title: "Auto-Save Settings",
        description: "Settings now save automatically as you change them. No more manual Save button - changes are saved with a 500ms debounce.",
        tag: "improved",
      },
      {
        icon: <Monitor className="h-5 w-5" />,
        title: "Enhanced General Tab",
        description: "Redesigned General tab with instance information (type, version, loader), statistics (playtime, last played), and quick actions.",
        tag: "improved",
      },
      {
        icon: <Sparkles className="h-5 w-5" />,
        title: "Create Server Beta Badge",
        description: "The 'Create Server from Client' feature now shows an Early Beta badge with a warning about mod detection limitations.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.5.5",
    date: "2025-12-12",
    highlights: [
      "Security Improvements",
      "Accessibility Enhancements",
      "Better User Experience",
    ],
    features: [
      {
        icon: <Shield className="h-5 w-5" />,
        title: "Enhanced Security",
        description: "Comprehensive security audit and fixes. Protection against common vulnerabilities, improved data validation, and secure URL handling.",
        tag: "improved",
      },
      {
        icon: <Users className="h-5 w-5" />,
        title: "Accessibility Improvements",
        description: "Added screen reader support with ARIA labels on all interactive elements. Better keyboard navigation throughout the app.",
        tag: "improved",
      },
      {
        icon: <Zap className="h-5 w-5" />,
        title: "Smoother Loading Experience",
        description: "New skeleton loaders provide visual feedback while content loads. Error boundaries prevent page crashes from component failures.",
        tag: "improved",
      },
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Mod Deletion Confirmation",
        description: "Added confirmation dialog before deleting mods to prevent accidental data loss.",
        tag: "fix",
      },
      {
        icon: <Settings className="h-5 w-5" />,
        title: "Memory Settings Reset",
        description: "New 'Reset to Default' button for memory sliders in instance settings.",
        tag: "new",
      },
      {
        icon: <Wrench className="h-5 w-5" />,
        title: "Backend Stability",
        description: "Improved error handling and connection timeouts. More robust backend operations with better reliability.",
        tag: "improved",
      },
    ],
  },
  {
    version: "0.5.4",
    date: "2025-12-12",
    highlights: [
      "AppImage Linux Builds",
      "CI/CD Improvements",
      "Code Quality Fixes",
    ],
    features: [
      {
        icon: <Package className="h-5 w-5" />,
        title: "AppImage Linux Builds",
        description: "Re-enabled AppImage format for Linux users. Provides portable, self-contained application bundles.",
        tag: "new",
      },
      {
        icon: <Wrench className="h-5 w-5" />,
        title: "CI/CD Pipeline Improvements",
        description: "Simplified workflows, added concurrency controls, and prevented duplicate releases during deployment.",
        tag: "improved",
      },
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Clippy & Code Quality",
        description: "Resolved all Clippy warnings across Rust modules. Fixed npm rollup issue in CI environments.",
        tag: "fix",
      },
    ],
  },
  {
    version: "0.5.3",
    date: "2025-12-12",
    highlights: [
      "i18n Integrity Check",
      "4K Display Support",
      "Bug fixes & translations",
    ],
    features: [
      {
        icon: <Globe className="h-5 w-5" />,
        title: "i18n Integrity Check Script",
        description: "New npm run i18n:check command to verify translation completeness. Reports missing keys, coverage percentage for each locale.",
        tag: "new",
      },
      {
        icon: <Monitor className="h-5 w-5" />,
        title: "Enhanced 4K Display Support",
        description: "Improved responsive grid layouts with 4xl breakpoint (2560px) for ultra-wide and 4K displays. Up to 12 columns on Skins page.",
        tag: "improved",
      },
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Sidebar Badge Fix",
        description: "Sidebar badge count now updates correctly when shares are deleted together with an instance.",
        tag: "fix",
      },
      {
        icon: <Globe className="h-5 w-5" />,
        title: "Dutch & German Translations",
        description: "Added 85+ missing skin-related translation keys for Dutch (nl) and German (de) languages. All 4 locales now at 100% coverage.",
        tag: "fix",
      },
      {
        icon: <FileCode className="h-5 w-5" />,
        title: "Hardcoded Strings Fixed",
        description: "Replaced hardcoded strings with i18n translation keys in 10+ components including ConfigEditor, CloudStorage, Discord, and more.",
        tag: "fix",
      },
    ],
  },
  {
    version: "0.5.2",
    date: "2025-12-12",
    highlights: [
      "Skin Manager",
      "3D skin viewer with animations",
      "Browse & favorite community skins",
    ],
    features: [
      {
        icon: <Palette className="h-5 w-5" />,
        title: "Skin Manager",
        description: "Complete skin customization system with interactive 3D viewer, pose animations (idle, walk, run, wave), and camera controls.",
        tag: "new",
      },
      {
        icon: <Globe className="h-5 w-5" />,
        title: "Community Skins Browser",
        description: "Browse trending skins from MineSkin gallery or search for player skins by Minecraft username. Preview any skin in 3D before applying.",
        tag: "new",
      },
      {
        icon: <Heart className="h-5 w-5" />,
        title: "Favorites System",
        description: "Save your favorite skins for quick access. Build your personal collection of skins you love.",
        tag: "new",
      },
      {
        icon: <Upload className="h-5 w-5" />,
        title: "Custom Skin Upload",
        description: "Upload your own skins from a local file or URL. Supports both Classic (Steve) and Slim (Alex) skin variants.",
        tag: "new",
      },
      {
        icon: <Camera className="h-5 w-5" />,
        title: "Screenshot Capture",
        description: "Take screenshots of your skin in the 3D viewer with your chosen pose. Save directly to your computer.",
        tag: "new",
      },
      {
        icon: <Layout className="h-5 w-5" />,
        title: "Large Screen Support",
        description: "Responsive grid layouts with support for up to 4K displays. More skins visible at once on larger monitors.",
        tag: "improved",
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2024-12-11",
    highlights: [
      "HTTP Tunnel Sharing",
      "Improved update checker",
    ],
    features: [
      {
        icon: <Network className="h-5 w-5" />,
        title: "HTTP Tunnel Sharing",
        description: "Instance sharing now uses HTTP tunnels instead of WebTorrent P2P. More reliable transfers with better firewall compatibility.",
        tag: "improved",
      },
      {
        icon: <RefreshCw className="h-5 w-5" />,
        title: "Manual Update Check",
        description: "Check for updates manually from Settings. Now detects all version types including dev and patch releases.",
        tag: "improved",
      },
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Update Notifications",
        description: "Fixed issue where update notifications weren't showing for all version types.",
        tag: "fix",
      },
    ],
  },
  {
    version: "0.4.1",
    date: "2024-12-11",
    highlights: [
      "P2P Instance Sharing",
      "Share instances with friends via magnet links",
      "No server required",
    ],
    features: [
      {
        icon: <Share2 className="h-5 w-5" />,
        title: "P2P Instance Sharing",
        description: "Share your Minecraft instances directly with friends using WebTorrent P2P technology. No upload to external servers required - share directly from your computer.",
        tag: "new",
      },
      {
        icon: <Package className="h-5 w-5" />,
        title: "Selective Content Export",
        description: "Choose exactly what to share: mods, configs, saves, resourcepacks, shaderpacks. Each component can be included or excluded before sharing.",
        tag: "new",
      },
      {
        icon: <Download className="h-5 w-5" />,
        title: "Easy Import via Magnet Links",
        description: "Import shared instances by pasting a magnet link or scanning a QR code. Preview the contents before importing to your launcher.",
        tag: "new",
      },
      {
        icon: <Users className="h-5 w-5" />,
        title: "Sharing Management Page",
        description: "New Sharing page in sidebar to manage active shares. See peer count, upload stats, and stop sharing at any time. Badge shows number of active shares.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2024-12-11",
    highlights: [
      "Major Performance Overhaul",
      "CPU usage reduced by 90%",
      "Database optimizations",
    ],
    features: [
      {
        icon: <Gauge className="h-5 w-5" />,
        title: "Performance Overhaul",
        description: "A comprehensive audit has been conducted. The application now operates with significantly reduced resource consumption. CPU utilization has been brought down from peak values to nominal levels.",
        tag: "improved",
      },
      {
        icon: <RefreshCw className="h-5 w-5" />,
        title: "React Rendering Optimization",
        description: "Twenty render cycle inefficiencies have been identified and resolved. Translation hook dependencies have been corrected across all components. Callback memoization has been properly implemented.",
        tag: "improved",
      },
      {
        icon: <Database className="h-5 w-5" />,
        title: "Database Connection Management",
        description: "The SQLite connection pool has been reconfigured with appropriate parameters. Concurrent operations now proceed without contention. Instance storage calculations execute in parallel.",
        tag: "improved",
      },
      {
        icon: <Cpu className="h-5 w-5" />,
        title: "Backend Async Operations",
        description: "Blocking operations have been relocated to dedicated thread pools. Discord RPC, Java detection, and file operations no longer impede the async runtime. Yield points ensure cooperative scheduling.",
        tag: "improved",
      },
      {
        icon: <Zap className="h-5 w-5" />,
        title: "Polling Intervals Calibrated",
        description: "All polling intervals have been adjusted to appropriate frequencies. Home status checks: 15 seconds. Server statistics: 10 seconds. Account refresh: 30 seconds. Visibility detection pauses inactive polls.",
        tag: "improved",
      },
    ],
  },
  {
    version: "0.3.9",
    date: "2024-12-11",
    highlights: [
      "Linux build fix",
    ],
    features: [
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Linux Build Fix",
        description: "Fixed Linux build by disabling AppImage (Tauri infrastructure issue). Linux users can now install via .deb or .rpm packages.",
        tag: "fix",
      },
    ],
  },
  {
    version: "0.3.8",
    date: "2024-12-11",
    highlights: [
      "Windows Discord Rich Presence support",
    ],
    features: [
      {
        icon: <Monitor className="h-5 w-5" />,
        title: "Windows Discord Rich Presence",
        description: "Discord Rich Presence now works on Windows using named pipes. Show your activity on Discord when playing Minecraft on Windows.",
        tag: "fix",
      },
    ],
  },
  {
    version: "0.3.7",
    date: "2024-12-11",
    highlights: [
      "Bug fixes and code quality improvements",
      "Tunnel stability fix",
    ],
    features: [
      {
        icon: <Bug className="h-5 w-5" />,
        title: "Tunnel Auto-Start Fix",
        description: "Fixed a crash that could occur when tunnels auto-started after server launch. The tunnel system is now more stable.",
        tag: "fix",
      },
      {
        icon: <Wrench className="h-5 w-5" />,
        title: "React Hooks Optimization",
        description: "Fixed 12 React hooks dependency warnings across the app for better performance and fewer potential bugs.",
        tag: "fix",
      },
      {
        icon: <FileCode className="h-5 w-5" />,
        title: "Code Quality Improvements",
        description: "Replaced 100+ debug statements with proper logging system. Removed unused code from cloud storage and Discord modules.",
        tag: "improved",
      },
    ],
  },
  {
    version: "0.3.6",
    date: "2024-12-11",
    highlights: [
      "Discord Rich Presence",
      "Discord Webhooks for server events",
    ],
    features: [
      {
        icon: <MessageSquare className="h-5 w-5" />,
        title: "Discord Rich Presence",
        description: "Show your activity on Discord: Idle when browsing, Playing when in-game with instance name, version, and modloader. Persistent connection keeps status visible.",
        tag: "new",
      },
      {
        icon: <Bell className="h-5 w-5" />,
        title: "Discord Webhooks",
        description: "Get notified on Discord when your server starts/stops or players join/leave. Configure webhook URL in Settings > Discord.",
        tag: "new",
      },
      {
        icon: <Settings className="h-5 w-5" />,
        title: "Discord Settings Tab",
        description: "New Discord tab in Settings to enable/disable Rich Presence features and configure webhook notifications with test buttons.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.3.5",
    date: "2024-12-11",
    highlights: [
      "Cloud Backup Storage (Google Drive, Dropbox, Nextcloud, S3)",
      "OAuth Device Code Flow for secure authentication",
    ],
    features: [
      {
        icon: <Cloud className="h-5 w-5" />,
        title: "Cloud Backup Storage",
        description: "Sync your world backups to Google Drive, Dropbox, Nextcloud (WebDAV), or any S3-compatible storage (AWS, MinIO). Automatic upload option available.",
        tag: "new",
      },
      {
        icon: <Shield className="h-5 w-5" />,
        title: "Secure OAuth Authentication",
        description: "Sign in with Google or Dropbox using Device Code Flow - no need to copy-paste tokens manually. Credentials are securely embedded at build time.",
        tag: "new",
      },
      {
        icon: <Archive className="h-5 w-5" />,
        title: "Cloud Upload from Worlds Tab",
        description: "Upload backups directly from the instance Worlds tab. See sync status badges (Synced/Pending/Failed) for each backup.",
        tag: "new",
      },
      {
        icon: <Settings className="h-5 w-5" />,
        title: "Cloud Settings Tab",
        description: "New Cloud tab in Settings to configure your preferred storage provider with connection testing.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.3.4",
    date: "2024-12-10",
    highlights: [
      "Onboarding Wizard for new users",
      "Guided Tour with interactive tooltips",
    ],
    features: [
      {
        icon: <Sparkles className="h-5 w-5" />,
        title: "Onboarding Wizard",
        description: "New users are guided through initial setup: language selection, Java installation, Microsoft account login, and first instance creation.",
        tag: "new",
      },
      {
        icon: <Zap className="h-5 w-5" />,
        title: "Interactive Guided Tour",
        description: "After onboarding, a guided tour highlights key features with animated tooltips. Can be restarted from Settings.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.3.3",
    date: "2024-12-09",
    highlights: [
      "Microsoft Authentication",
      "Account badges and management",
    ],
    features: [
      {
        icon: <Users className="h-5 w-5" />,
        title: "Microsoft Authentication",
        description: "Full Microsoft OAuth flow with Device Code. Secure token storage with AES-256-GCM encryption.",
        tag: "new",
      },
      {
        icon: <Shield className="h-5 w-5" />,
        title: "Account Badges",
        description: "Visual badges to distinguish Microsoft accounts from offline accounts. Default account indicator.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.3.2",
    date: "2024-12-08",
    highlights: [
      "Worlds Tab with backup management",
      "Centralized Backups page",
    ],
    features: [
      {
        icon: <Globe className="h-5 w-5" />,
        title: "Worlds Tab",
        description: "New tab in instance details to manage worlds: view, backup, restore, duplicate, rename, and delete worlds.",
        tag: "new",
      },
      {
        icon: <Archive className="h-5 w-5" />,
        title: "Centralized Backups Page",
        description: "View all backups across all instances in one place. Filter by instance, search, and manage backups globally.",
        tag: "new",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2024-12-07",
    highlights: [
      "Mods batch actions",
      "Server port configuration",
      "Tunnel URL persistence",
    ],
    features: [
      {
        icon: <Gamepad2 className="h-5 w-5" />,
        title: "Mods Batch Actions",
        description: "Select multiple mods and enable/disable or delete them all at once. Checkbox selection with select all option.",
        tag: "new",
      },
      {
        icon: <Settings className="h-5 w-5" />,
        title: "Server Port Configuration",
        description: "Configure server port directly from the instance settings. Automatically updates server.properties.",
        tag: "new",
      },
      {
        icon: <Globe className="h-5 w-5" />,
        title: "Tunnel URL Persistence",
        description: "Tunnel URLs are now saved and restored when restarting the launcher. Supports Cloudflare, Playit, Ngrok, and Bore.",
        tag: "improved",
      },
    ],
  },
]

export default function Changelog() {
  const { t } = useTranslation()

  const getTagColor = (tag?: string) => {
    switch (tag) {
      case "new":
        return "bg-green-500/10 text-green-500 border-green-500/20"
      case "improved":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20"
      case "fix":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20"
      default:
        return ""
    }
  }

  const getTagLabel = (tag?: string) => {
    switch (tag) {
      case "new":
        return t("changelog.new")
      case "improved":
        return t("changelog.improved")
      case "fix":
        return t("changelog.fix")
      default:
        return ""
    }
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div>
        <h1 className="text-2xl font-bold">{t("changelog.title")}</h1>
        <p className="text-muted-foreground">{t("changelog.subtitle")}</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 pr-4">
          {changelog.map((entry, index) => (
            <Card key={entry.version} className={index === 0 ? "border-primary/50" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <span className="text-xl">v{entry.version}</span>
                    {index === 0 && (
                      <Badge className="bg-primary/10 text-primary border-primary/20">
                        {t("changelog.latest")}
                      </Badge>
                    )}
                  </CardTitle>
                  <span className="text-sm text-muted-foreground">{entry.date}</span>
                </div>
                {entry.highlights && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {entry.highlights.map((highlight, i) => (
                      <Badge key={i} variant="secondary" className="font-normal">
                        {highlight}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {entry.features.map((feature, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                      {feature.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{feature.title}</span>
                        {feature.tag && (
                          <Badge variant="outline" className={getTagColor(feature.tag)}>
                            {getTagLabel(feature.tag)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
