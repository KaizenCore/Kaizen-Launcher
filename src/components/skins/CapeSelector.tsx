import { Check } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/i18n"

interface Cape {
  id: string
  name: string
  url: string
  source: "mojang" | "optifine"
}

interface CapeSelectorProps {
  capes: Cape[]
  selectedCapeId?: string | null
  onSelect: (cape: Cape | null) => void
  disabled?: boolean
  className?: string
}

export function CapeSelector({
  capes,
  selectedCapeId,
  onSelect,
  disabled = false,
  className,
}: CapeSelectorProps) {
  const { t } = useTranslation()

  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-medium">{t("skins.capes")}</h3>

      <div className="flex flex-wrap gap-2">
        {/* No Cape Option */}
        <CapeOption
          selected={!selectedCapeId}
          onClick={() => onSelect(null)}
          disabled={disabled}
        >
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <span className="text-xs">{t("skins.noCape")}</span>
          </div>
        </CapeOption>

        {/* Cape Options */}
        {capes.map((cape) => (
          <CapeOption
            key={cape.id}
            selected={selectedCapeId === cape.id}
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

      {capes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("skins.noCapeAvailable")}
        </p>
      )}
    </div>
  )
}

interface CapeOptionProps {
  children: React.ReactNode
  selected: boolean
  onClick: () => void
  disabled?: boolean
  label?: string
}

function CapeOption({
  children,
  selected,
  onClick,
  disabled = false,
  label,
}: CapeOptionProps) {
  return (
    <Card
      className={cn(
        "relative w-16 h-20 cursor-pointer transition-all overflow-hidden",
        selected && "ring-2 ring-primary",
        disabled && "opacity-50 cursor-not-allowed"
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
