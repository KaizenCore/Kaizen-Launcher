import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Palette, X, Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTranslation } from "@/i18n"
import { cn } from "@/lib/utils"

// Curated color palette - 12 colors that work well in both light/dark themes
export const COLOR_PALETTE = [
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#f97316", name: "Orange" },
  { hex: "#84cc16", name: "Lime" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#10b981", name: "Emerald" },
  { hex: "#14b8a6", name: "Teal" },
  { hex: "#06b6d4", name: "Cyan" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#8b5cf6", name: "Violet" },
  { hex: "#a855f7", name: "Purple" },
  { hex: "#ec4899", name: "Pink" },
]

interface InstanceColorPickerProps {
  instanceId: string
  currentColor: string | null
  onColorChange: (color: string | null) => void
  trigger?: React.ReactNode
}

export function InstanceColorPicker({
  instanceId,
  currentColor,
  onColorChange,
  trigger,
}: InstanceColorPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  const handleSelectColor = async (color: string | null) => {
    setIsUpdating(true)
    try {
      await invoke("update_instance_color", { instanceId, color })
      onColorChange(color)
      setOpen(false)
      toast.success(t("instances.colorUpdated"))
    } catch (err) {
      console.error("Failed to update color:", err)
      toast.error(t("instances.colorUpdateError"))
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            {currentColor ? (
              <div
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: currentColor }}
              />
            ) : (
              <Palette className="h-4 w-4" />
            )}
            {t("instances.changeColor")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-3" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">{t("instances.selectColor")}</div>
          <div className="grid grid-cols-6 gap-2">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color.hex}
                className={cn(
                  "h-7 w-7 rounded-md transition-all hover:scale-110 flex items-center justify-center",
                  currentColor === color.hex
                    ? "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                    : "hover:ring-1 hover:ring-border"
                )}
                style={{ backgroundColor: color.hex }}
                onClick={() => handleSelectColor(color.hex)}
                disabled={isUpdating}
                title={color.name}
              >
                {currentColor === color.hex && (
                  <Check className="h-4 w-4 text-white drop-shadow-md" />
                )}
              </button>
            ))}
          </div>
          {currentColor && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-muted-foreground"
              onClick={() => handleSelectColor(null)}
              disabled={isUpdating}
            >
              <X className="h-4 w-4" />
              {t("instances.resetColor")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Inline color picker for context menus (no popover wrapper)
interface InlineColorPickerProps {
  currentColor: string | null
  onSelectColor: (color: string | null) => void
  disabled?: boolean
}

export function InlineColorPicker({
  currentColor,
  onSelectColor,
  disabled,
}: InlineColorPickerProps) {
  return (
    <div className="grid grid-cols-6 gap-1.5 p-2">
      {COLOR_PALETTE.map((color) => (
        <button
          key={color.hex}
          className={cn(
            "h-6 w-6 rounded-md transition-all hover:scale-110 flex items-center justify-center",
            currentColor === color.hex && "ring-2 ring-offset-1 ring-offset-background ring-foreground"
          )}
          style={{ backgroundColor: color.hex }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onSelectColor(color.hex)
          }}
          disabled={disabled}
          title={color.name}
        >
          {currentColor === color.hex && (
            <Check className="h-3 w-3 text-white drop-shadow-md" />
          )}
        </button>
      ))}
    </div>
  )
}
