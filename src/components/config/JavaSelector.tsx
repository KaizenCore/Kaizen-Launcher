import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Check, ChevronDown, Coffee, Download, Loader2, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "@/i18n"

interface JavaInstallation {
  version: string
  major_version: number
  path: string
  vendor: string
  is_bundled: boolean
}

interface JavaSelectorProps {
  value: string
  onChange: (value: string) => void
  recommendedVersion?: number
}

export function JavaSelector({ value, onChange, recommendedVersion = 21 }: JavaSelectorProps) {
  const { t } = useTranslation()
  const [installations, setInstallations] = useState<JavaInstallation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    loadInstallations()
  }, [])

  const loadInstallations = async () => {
    try {
      const result = await invoke<JavaInstallation[]>("get_java_installations")
      setInstallations(result)
    } catch (error) {
      console.error("Failed to load Java installations:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInstallRecommended = async () => {
    setIsInstalling(true)
    try {
      await invoke("install_java_version", { majorVersion: recommendedVersion })
      await loadInstallations()
      toast.success(t("java.installedSuccess", { version: String(recommendedVersion) }))
    } catch (error) {
      console.error("Failed to install Java:", error)
      toast.error(t("java.installError", { version: String(recommendedVersion) }))
    } finally {
      setIsInstalling(false)
    }
  }

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Java Executable",
            extensions: process.platform === "win32" ? ["exe"] : ["*"],
          },
        ],
      })
      if (selected) {
        onChange(selected)
      }
    } catch (error) {
      console.error("Failed to open file dialog:", error)
    }
  }

  const selectedInstallation = installations.find(i => i.path === value)
  const hasRecommendedVersion = installations.some(i => i.major_version === recommendedVersion)

  const getVersionBadgeColor = (majorVersion: number) => {
    if (majorVersion === recommendedVersion) return "bg-green-500/20 text-green-500"
    if (majorVersion >= 17) return "bg-blue-500/20 text-blue-500"
    if (majorVersion >= 11) return "bg-amber-500/20 text-amber-500"
    return "bg-red-500/20 text-red-500"
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("java.version")}</Label>
        {!hasRecommendedVersion && !isLoading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleInstallRecommended}
            disabled={isInstalling}
            className="h-6 px-2 text-xs gap-1 text-amber-500 hover:text-amber-500"
          >
            {isInstalling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {t("java.installVersion", { version: String(recommendedVersion) })}
          </Button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-9 font-normal"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("common.loading")}
              </span>
            ) : value ? (
              selectedInstallation ? (
                <span className="flex items-center gap-2 truncate">
                  <Coffee className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  <span className="truncate">Java {selectedInstallation.major_version}</span>
                  <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", getVersionBadgeColor(selectedInstallation.major_version))}>
                    {selectedInstallation.vendor}
                  </Badge>
                  {selectedInstallation.is_bundled && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {t("java.bundled")}
                    </Badge>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-2 truncate text-muted-foreground">
                  <Coffee className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate font-mono text-xs">{value}</span>
                </span>
              )
            ) : (
              <span className="text-muted-foreground">{t("java.defaultAuto")}</span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {/* Default option */}
          <DropdownMenuItem onClick={() => onChange("")} className="gap-2">
            <div className="w-4 h-4 flex items-center justify-center">
              {!value && <Check className="h-3.5 w-3.5" />}
            </div>
            <span>{t("java.defaultAuto")}</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Installed versions */}
          {installations.length === 0 ? (
            <div className="px-2 py-3 text-center">
              <p className="text-sm text-muted-foreground mb-2">{t("java.noInstallation")}</p>
              <Button
                size="sm"
                onClick={handleInstallRecommended}
                disabled={isInstalling}
                className="gap-2"
              >
                {isInstalling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {t("java.installVersion", { version: String(recommendedVersion) })}
              </Button>
            </div>
          ) : (
            installations
              .sort((a, b) => b.major_version - a.major_version)
              .map((installation) => (
                <DropdownMenuItem
                  key={installation.path}
                  onClick={() => onChange(installation.path)}
                  className="gap-2"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    {value === installation.path && <Check className="h-3.5 w-3.5" />}
                  </div>
                  <Coffee className="h-3.5 w-3.5 text-amber-500" />
                  <span className="flex-1">Java {installation.major_version}</span>
                  <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", getVersionBadgeColor(installation.major_version))}>
                    {installation.vendor}
                  </Badge>
                  {installation.is_bundled && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {t("java.bundled")}
                    </Badge>
                  )}
                  {installation.major_version === recommendedVersion && (
                    <Badge className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-500 hover:bg-green-500/30">
                      {t("java.recommended")}
                    </Badge>
                  )}
                </DropdownMenuItem>
              ))
          )}

          <DropdownMenuSeparator />

          {/* Browse option */}
          <DropdownMenuItem onClick={handleBrowse} className="gap-2">
            <div className="w-4 h-4" />
            <FolderOpen className="h-3.5 w-3.5" />
            <span>{t("java.browse")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {value && !selectedInstallation && (
        <p className="text-xs text-muted-foreground font-mono truncate">
          {value}
        </p>
      )}
    </div>
  )
}
