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
  FileCode
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
