import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Check, X, HelpCircle, Info } from "lucide-react"
import { useTranslation } from "@/i18n"

export type ServerCompatibility = "required" | "optional" | "unsupported" | "unknown"

interface ModCompatibilityBadgeProps {
  compatibility: ServerCompatibility
  source?: "metadata" | "modrinth_lookup" | "unknown"
  showTooltip?: boolean
  className?: string
}

export function ModCompatibilityBadge({
  compatibility,
  source,
  showTooltip = true,
  className = "",
}: ModCompatibilityBadgeProps) {
  const { t } = useTranslation()

  const getConfig = () => {
    switch (compatibility) {
      case "required":
        return {
          icon: Check,
          text: t("modCompatibility.required"),
          variant: "default" as const,
          className: "bg-green-600 hover:bg-green-700",
          tooltip: t("modCompatibility.requiredTooltip"),
        }
      case "optional":
        return {
          icon: Info,
          text: t("modCompatibility.optional"),
          variant: "secondary" as const,
          className: "bg-blue-600 hover:bg-blue-700 text-white",
          tooltip: t("modCompatibility.optionalTooltip"),
        }
      case "unsupported":
        return {
          icon: X,
          text: t("modCompatibility.unsupported"),
          variant: "destructive" as const,
          className: "",
          tooltip: t("modCompatibility.unsupportedTooltip"),
        }
      case "unknown":
      default:
        return {
          icon: HelpCircle,
          text: t("modCompatibility.unknown"),
          variant: "outline" as const,
          className: "border-yellow-500/50 text-yellow-600",
          tooltip: t("modCompatibility.unknownTooltip"),
        }
    }
  }

  const config = getConfig()
  const Icon = config.icon

  const sourceText = source === "metadata"
    ? t("modCompatibility.sourceMetadata")
    : source === "modrinth_lookup"
    ? t("modCompatibility.sourceModrinth")
    : t("modCompatibility.sourceUnknown")

  const badge = (
    <Badge
      variant={config.variant}
      className={`gap-1 text-xs ${config.className} ${className}`}
    >
      <Icon className="h-3 w-3" />
      {config.text}
    </Badge>
  )

  if (!showTooltip) {
    return badge
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p>{config.tooltip}</p>
          {source && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("modCompatibility.source")}: {sourceText}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default ModCompatibilityBadge
