import { Minus, Square, X } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { getVersion } from "@tauri-apps/api/app"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"

export function TitleBar() {
  const [version, setVersion] = useState<string>("")

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""))
  }, [])
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

  return (
    <div
      data-tauri-drag-region
      className="h-8 flex items-center justify-between bg-background border-b select-none"
    >
      {/* Logo and title */}
      <div className="flex items-center gap-2 px-3" data-tauri-drag-region>
        <img
          src="/minecraft-icon.svg"
          alt="Kaizen"
          className="w-4 h-4"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
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

      {/* Spacer */}
      <div className="flex-1" data-tauri-drag-region />

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
