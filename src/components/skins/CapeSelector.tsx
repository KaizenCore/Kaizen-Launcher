import { Check, Eye } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/i18n"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"

interface Cape {
  id: string
  name: string
  url: string
  source: "mojang" | "optifine" | "labymod" | "minecraftcapes" | "fivezig"
}

interface CapeSelectorProps {
  capes: Cape[]
  selectedCapeId?: string | null
  previewCapeId?: string | null
  onSelect: (cape: Cape | null) => void
  onPreview?: (cape: Cape | null) => void
  disabled?: boolean
  className?: string
}

// Check if a cape can be set via Mojang API (only official Mojang capes from the API)
function isSettableCape(cape: Cape): boolean {
  // Mojang API capes have UUID-style IDs (no underscore prefix pattern)
  // Capes.dev capes have IDs like "minecraft_username", "optifine_username", etc.
  if (cape.source !== "mojang") return false

  // Check if ID looks like it came from Capes.dev (has a prefix pattern)
  const capesDevPrefixes = ["minecraft_", "optifine_", "labymod_", "minecraftcapes_", "5zig_"]
  const isFromCapesDev = capesDevPrefixes.some(prefix => cape.id.toLowerCase().startsWith(prefix))

  return !isFromCapesDev
}

// Group capes by source for display
function groupCapesBySource(capes: Cape[]): Record<string, Cape[]> {
  const groups: Record<string, Cape[]> = {}
  for (const cape of capes) {
    const source = cape.source
    if (!groups[source]) {
      groups[source] = []
    }
    groups[source].push(cape)
  }
  return groups
}

// Get display name for cape source
function getSourceDisplayName(source: string): string {
  const names: Record<string, string> = {
    mojang: "Mojang",
    optifine: "OptiFine",
    labymod: "LabyMod",
    minecraftcapes: "MC Capes",
    fivezig: "5zig",
  }
  return names[source] || source
}

export function CapeSelector({
  capes,
  selectedCapeId,
  previewCapeId,
  onSelect,
  onPreview,
  disabled = false,
  className,
}: CapeSelectorProps) {
  const { t } = useTranslation()

  // Separate settable (Mojang) capes from display-only (third-party) capes
  const settableCapes = capes.filter(isSettableCape)
  const displayOnlyCapes = capes.filter(c => !isSettableCape(c))

  // Count capes by source for display
  const capeCounts = groupCapesBySource(capes)

  return (
    <TooltipProvider>
      <div className={cn("space-y-3", className)}>
        {/* Cape count badges */}
        {capes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(capeCounts).map(([source, sourceCapes]) => (
              <Badge key={source} variant="secondary" className="text-[10px] px-1.5 py-0">
                {getSourceDisplayName(source)}: {sourceCapes.length}
              </Badge>
            ))}
          </div>
        )}

        {/* Settable Capes (Mojang official) */}
        <div className="flex flex-wrap gap-2">
          {/* No Cape Option */}
          <CapeOption
            selected={!selectedCapeId && !previewCapeId}
            onClick={() => onSelect(null)}
            disabled={disabled}
          >
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <span className="text-xs">{t("skins.noCape")}</span>
            </div>
          </CapeOption>

          {/* Settable Cape Options */}
          {settableCapes.map((cape) => (
            <CapeOption
              key={cape.id}
              selected={selectedCapeId === cape.id}
              previewing={previewCapeId === cape.id}
              onClick={() => onSelect(cape)}
              disabled={disabled}
              label={cape.name}
            >
              <img
                src={cape.url}
                alt={cape.name}
                className="w-full h-full object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            </CapeOption>
          ))}
        </div>

        {/* Display-only Capes (third-party mods) */}
        {displayOnlyCapes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {t("skins.thirdPartyCapes")}
            </p>
            <div className="flex flex-wrap gap-2">
              {displayOnlyCapes.map((cape) => (
                <Tooltip key={cape.id}>
                  <TooltipTrigger asChild>
                    <div>
                      <CapeOption
                        selected={false}
                        previewing={previewCapeId === cape.id}
                        onClick={() => onPreview?.(cape)}
                        disabled={false}
                        label={cape.name}
                        displayOnly
                      >
                        <img
                          src={cape.url}
                          alt={cape.name}
                          className="w-full h-full object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      </CapeOption>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">{t("skins.capePreviewOnly")}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {capes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("skins.noCapeAvailable")}
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}

interface CapeOptionProps {
  children: React.ReactNode
  selected: boolean
  previewing?: boolean
  onClick: () => void
  disabled?: boolean
  label?: string
  displayOnly?: boolean
}

function CapeOption({
  children,
  selected,
  previewing = false,
  onClick,
  disabled = false,
  label,
  displayOnly = false,
}: CapeOptionProps) {
  return (
    <Card
      className={cn(
        "relative w-16 h-20 cursor-pointer transition-all overflow-hidden",
        selected && "ring-2 ring-primary",
        previewing && !selected && "ring-2 ring-blue-400",
        disabled && "opacity-50 cursor-not-allowed",
        displayOnly && "opacity-80"
      )}
      onClick={() => !disabled && onClick()}
    >
      <CardContent className="p-0 h-full">
        <div className="w-full h-full bg-muted/30">{children}</div>
        {selected && (
          <div className="absolute bottom-1 right-1 bg-primary rounded-full p-0.5">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        )}
        {previewing && !selected && (
          <div className="absolute bottom-1 right-1 bg-blue-400 rounded-full p-0.5">
            <Eye className="h-3 w-3 text-white" />
          </div>
        )}
        {displayOnly && (
          <div className="absolute top-1 right-1 bg-orange-500/80 rounded-full p-0.5">
            <Eye className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </CardContent>
      {label && (
        <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
          <p className="text-[9px] text-white truncate text-center">{label}</p>
        </div>
      )}
    </Card>
  )
}

export type { Cape }
