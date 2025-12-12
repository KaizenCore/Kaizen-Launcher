import { useState, useMemo } from "react"
import { Cpu, Zap, Leaf, Rocket, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTranslation, type TranslationKey } from "@/i18n"

interface JvmTemplate {
  id: string
  nameKey: TranslationKey
  icon: React.ReactNode
  descKey: TranslationKey
  getArgs: (ramMb: number) => string
  recommended?: (loader: string | null, ramMb: number) => boolean
}

interface JvmTemplatesProps {
  value: string
  onChange: (value: string) => void
  ramMb: number
  loader: string | null
}

// JVM argument templates optimized for different use cases
const templates: JvmTemplate[] = [
  {
    id: "vanilla",
    nameKey: "jvmTemplates.vanilla",
    icon: <Leaf className="h-4 w-4" />,
    descKey: "jvmTemplates.vanillaDesc",
    recommended: (loader, ram) => !loader && ram <= 4096,
    getArgs: (_ramMb) => {
      return `-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+ParallelRefProcEnabled`
    },
  },
  {
    id: "modded-light",
    nameKey: "jvmTemplates.lightMods",
    icon: <Zap className="h-4 w-4" />,
    descKey: "jvmTemplates.lightModsDesc",
    recommended: (loader, ram) =>
      (loader === "fabric" || loader === "quilt") && ram <= 6144,
    getArgs: (ramMb) => {
      const g1HeapRegion = ramMb >= 4096 ? 16 : 8
      return `-XX:+UseG1GC -XX:MaxGCPauseMillis=37 -XX:+ParallelRefProcEnabled -XX:G1HeapRegionSize=${g1HeapRegion}M -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1ReservePercent=20`
    },
  },
  {
    id: "modded-heavy",
    nameKey: "jvmTemplates.heavyModpack",
    icon: <Cpu className="h-4 w-4" />,
    descKey: "jvmTemplates.heavyModpackDesc",
    recommended: (loader, ram) =>
      (loader === "forge" || loader === "neoforge") || ram >= 6144,
    getArgs: (ramMb) => {
      const g1HeapRegion = ramMb >= 8192 ? 32 : ramMb >= 4096 ? 16 : 8
      const concGCThreads = Math.max(2, Math.floor(ramMb / 4096))
      return `-XX:+UseG1GC -XX:MaxGCPauseMillis=30 -XX:+ParallelRefProcEnabled -XX:G1HeapRegionSize=${g1HeapRegion}M -XX:G1NewSizePercent=40 -XX:G1MaxNewSizePercent=50 -XX:G1ReservePercent=15 -XX:ConcGCThreads=${concGCThreads} -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:+UnlockExperimentalVMOptions -XX:G1MixedGCLiveThresholdPercent=35`
    },
  },
  {
    id: "performance",
    nameKey: "jvmTemplates.performance",
    icon: <Rocket className="h-4 w-4" />,
    descKey: "jvmTemplates.performanceDesc",
    recommended: () => false,
    getArgs: (ramMb) => {
      const g1HeapRegion = ramMb >= 8192 ? 32 : ramMb >= 4096 ? 16 : 8
      const parallelGCThreads = Math.max(2, Math.floor(ramMb / 2048))
      return `-XX:+UseG1GC -XX:MaxGCPauseMillis=25 -XX:+ParallelRefProcEnabled -XX:G1HeapRegionSize=${g1HeapRegion}M -XX:G1NewSizePercent=40 -XX:G1MaxNewSizePercent=50 -XX:G1ReservePercent=15 -XX:ParallelGCThreads=${parallelGCThreads} -XX:ConcGCThreads=${Math.max(1, Math.floor(parallelGCThreads / 2))} -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:+UnlockExperimentalVMOptions -XX:G1MixedGCLiveThresholdPercent=35 -XX:+UseStringDeduplication -XX:+OptimizeStringConcat`
    },
  },
]

// Get the tip key based on RAM range
const getRamTipKey = (ramMb: number): TranslationKey => {
  if (ramMb < 2048) return "jvmTemplates.ramTipLow"
  if (ramMb <= 4096) return "jvmTemplates.ramTip2to4"
  if (ramMb <= 8192) return "jvmTemplates.ramTip4to8"
  if (ramMb <= 12288) return "jvmTemplates.ramTip8to12"
  return "jvmTemplates.ramTipHigh"
}

export function JvmTemplates({ value, onChange, ramMb, loader }: JvmTemplatesProps) {
  const { t } = useTranslation()
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  // Find the recommended template
  const recommendedTemplate = useMemo(() => {
    return templates.find(t => t.recommended?.(loader, ramMb))?.id || "modded-light"
  }, [loader, ramMb])

  const handleSelectTemplate = (template: JvmTemplate) => {
    const args = template.getArgs(ramMb)
    onChange(args)
    setSelectedTemplate(template.id)
  }

  const ramTipKey = getRamTipKey(ramMb)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>{t("jvmTemplates.jvmArgs")}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-xs text-muted-foreground">
                <Info className="h-3 w-3" />
                {t("jvmTemplates.help")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-sm">
              <p className="text-sm">{t(ramTipKey)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Template buttons */}
      <div className="grid grid-cols-2 gap-2">
        {templates.map((template) => {
          const isRecommended = template.id === recommendedTemplate
          const isSelected = selectedTemplate === template.id

          return (
            <TooltipProvider key={template.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleSelectTemplate(template)}
                    className={cn(
                      "justify-start gap-2 h-auto py-2",
                      isRecommended && !isSelected && "border-green-500/50 text-green-600"
                    )}
                  >
                    {template.icon}
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium">
                        {t(template.nameKey)}
                        {isRecommended && (
                          <span className="ml-1 text-xs text-green-500">*</span>
                        )}
                      </span>
                    </div>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-sm">{t(template.descKey)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        })}
      </div>

      {/* Current RAM info */}
      <p className="text-xs text-muted-foreground">
        * {t("jvmTemplates.recommendedFor").replace("{ram}", ramMb >= 1024 ? `${(ramMb / 1024).toFixed(1)}GB` : `${ramMb}MB`)}
        {loader && ` ${t("jvmTemplates.withLoader").replace("{loader}", loader)}`}
      </p>

      {/* Textarea for manual editing */}
      <Textarea
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setSelectedTemplate(null)
        }}
        placeholder={t("jvmTemplates.customArgs")}
        className="font-mono text-xs h-24 resize-none"
      />

      {/* Quick explanation */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>G1GC:</strong> {t("jvmTemplates.g1gc")}</p>
        <p><strong>MaxGCPauseMillis:</strong> {t("jvmTemplates.maxGcPause")}</p>
        <p><strong>G1HeapRegionSize:</strong> {t("jvmTemplates.g1HeapRegion")}</p>
      </div>
    </div>
  )
}
