import { useState, useMemo } from "react"
import { Server, Zap, Rocket, Cpu, Info } from "lucide-react"
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

interface ServerJvmTemplate {
  id: string
  name: string
  icon: React.ReactNode
  descriptionKey: TranslationKey
  getArgs: (ramMb: number) => string
  recommended?: (ramMb: number) => boolean
}

interface ServerJvmTemplatesProps {
  value: string
  onChange: (value: string) => void
  ramMb: number
}

// Aikar's flags - the gold standard for Paper/Spigot servers
const getAikarFlags = (ramMb: number): string => {
  const g1NewSize = ramMb >= 12288 ? 40 : 30
  const g1MaxNewSize = ramMb >= 12288 ? 50 : 40
  const g1HeapRegion = ramMb >= 12288 ? "16M" : "8M"
  const g1Reserve = ramMb >= 12288 ? 20 : 15
  const g1MixedGCCount = ramMb >= 12288 ? 4 : 8
  const initiatingHeap = ramMb >= 12288 ? 15 : 20

  return `-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=${g1NewSize} -XX:G1MaxNewSizePercent=${g1MaxNewSize} -XX:G1HeapRegionSize=${g1HeapRegion} -XX:G1ReservePercent=${g1Reserve} -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=${g1MixedGCCount} -XX:InitiatingHeapOccupancyPercent=${initiatingHeap} -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true`
}

// Server-specific JVM templates
const serverTemplates: ServerJvmTemplate[] = [
  {
    id: "aikar",
    name: "Aikar's Flags",
    icon: <Rocket className="h-4 w-4" />,
    descriptionKey: "serverJvmTemplates.aikarDesc",
    recommended: (ram) => ram >= 4096,
    getArgs: getAikarFlags,
  },
  {
    id: "basic",
    name: "Basic G1GC",
    icon: <Server className="h-4 w-4" />,
    descriptionKey: "serverJvmTemplates.basicDesc",
    recommended: (ram) => ram < 4096,
    getArgs: () => {
      return `-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC`
    },
  },
  {
    id: "zgc",
    name: "ZGC (Java 17+)",
    icon: <Zap className="h-4 w-4" />,
    descriptionKey: "serverJvmTemplates.zgcDesc",
    recommended: () => false,
    getArgs: () => {
      return `-XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch -XX:+DisableExplicitGC -XX:+PerfDisableSharedMem`
    },
  },
  {
    id: "graalvm",
    name: "GraalVM",
    icon: <Cpu className="h-4 w-4" />,
    descriptionKey: "serverJvmTemplates.graalvmDesc",
    recommended: () => false,
    getArgs: () => {
      return `-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:+EnableJVMCI -XX:+UseJVMCICompiler`
    },
  },
]

// Tips based on RAM - returns translation key
const getServerRamTipKey = (ramMb: number): TranslationKey => {
  if (ramMb < 2048) {
    return "serverJvmTemplates.ramTipLow"
  }
  if (ramMb <= 4096) {
    return "serverJvmTemplates.ramTip2to4"
  }
  if (ramMb <= 8192) {
    return "serverJvmTemplates.ramTip4to8"
  }
  if (ramMb <= 12288) {
    return "serverJvmTemplates.ramTip8to12"
  }
  return "serverJvmTemplates.ramTipHigh"
}

export function ServerJvmTemplates({ value, onChange, ramMb }: ServerJvmTemplatesProps) {
  const { t } = useTranslation()
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  // Find the recommended template
  const recommendedTemplate = useMemo(() => {
    return serverTemplates.find(t => t.recommended?.(ramMb))?.id || "aikar"
  }, [ramMb])

  const handleSelectTemplate = (template: ServerJvmTemplate) => {
    const args = template.getArgs(ramMb)
    onChange(args)
    setSelectedTemplate(template.id)
  }

  const ramTipKey = getServerRamTipKey(ramMb)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>{t("serverJvmTemplates.serverJvmArgs")}</Label>
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
        {serverTemplates.map((template) => {
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
                        {template.name}
                        {isRecommended && (
                          <span className="ml-1 text-xs text-green-500">*</span>
                        )}
                      </span>
                    </div>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-sm">{t(template.descriptionKey)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        })}
      </div>

      {/* Current RAM info */}
      <p className="text-xs text-muted-foreground">
        * {t("jvmTemplates.recommendedFor", { ram: ramMb >= 1024 ? `${(ramMb / 1024).toFixed(1)}GB` : `${ramMb}MB` })}
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
    </div>
  )
}
