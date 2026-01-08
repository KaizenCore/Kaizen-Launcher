import { Minus, Square, X, Sparkles, Settings2, BookOpen } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useEffect, useState } from "react"
import { useEasyModeStore } from "@/stores/easyModeStore"
import { useTranslation } from "@/i18n"

export function TitleBar() {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string>("")
  const { enabled: easyMode, loading, load, setEnabled } = useEasyModeStore()

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""))
    load()
  }, [load])
  const handleMinimize = async () => {
    const appWindow = getCurrentWindow()
    await appWindow.minimize()
  }
  const handleMaximize = async () => {
    const appWindow = getCurrentWindow()
    await appWindow.toggleMaximize()
  }
  const handleClose = async () => {
    const appWindow = getCurrentWindow()
    await appWindow.close()
  }

  const handleOpenDocs = async () => {
    try {
      await invoke("open_documentation_window")
    } catch (error) {
      console.error("Failed to open documentation:", error)
    }
  }

  return (
    <div
      data-tauri-drag-region
      className="h-8 flex items-center justify-between bg-background border-b select-none"
    >
      {/* Logo and title */}
      <div className="flex items-center gap-2 px-3" data-tauri-drag-region>
        <img
          src="/kaizen.png"
          alt="Kaizen"
          className="w-5 h-5"
        />
        <span className="text-sm font-medium text-foreground/80">
          Kaizen Launcher
        </span>
        <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded">
          Dev Preview
        </span>
        {version && (
          <span className="text-[10px] text-muted-foreground">
            v{version}
          </span>
        )}
      </div>

      {/* Spacer with Easy/Advanced toggle and Documentation button */}
      <div className="flex-1 flex items-center justify-end pr-2 gap-2" data-tauri-drag-region>
        {!loading && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="easy-mode-toggle"
                    className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1"
                  >
                    {easyMode ? (
                      <>
                        <Sparkles className="h-3 w-3" />
                        {t("easyMode.easy")}
                      </>
                    ) : (
                      <>
                        <Settings2 className="h-3 w-3" />
                        {t("easyMode.advanced")}
                      </>
                    )}
                  </Label>
                  <Switch
                    id="easy-mode-toggle"
                    checked={!easyMode}
                    onCheckedChange={(checked) => setEnabled(!checked)}
                    className="scale-75"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {easyMode ? t("easyMode.easyTooltip") : t("easyMode.advancedTooltip")}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded hover:bg-muted"
                onClick={handleOpenDocs}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{t("documentation.openTooltip")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Window controls */}
      <div className="flex">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-10 rounded-none hover:bg-muted"
          onClick={handleMinimize}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-10 rounded-none hover:bg-muted"
          onClick={handleMaximize}
        >
          <Square className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-10 rounded-none hover:bg-destructive hover:text-destructive-foreground"
          onClick={handleClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
