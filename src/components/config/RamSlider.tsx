import { useEffect, useState, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/i18n"

interface SystemMemoryInfo {
  total_mb: number
  available_mb: number
  recommended_min_mb: number
  recommended_max_mb: number
}

interface RamSliderProps {
  value: number
  onChange: (value: number) => void
  label: string
  minValue?: number
  recommendedValue?: "min" | "max"
}

type RamZone = "low" | "optimal" | "good" | "warning" | "danger"

export function RamSlider({ value, onChange, label, minValue = 512, recommendedValue = "max" }: RamSliderProps) {
  const { t } = useTranslation()
  const [systemMemory, setSystemMemory] = useState<SystemMemoryInfo | null>(null)

  useEffect(() => {
    invoke<SystemMemoryInfo>("get_system_memory")
      .then(setSystemMemory)
      .catch((err) => {
        console.error("Failed to get system memory:", err)
      })
  }, [])

  const maxRam = useMemo(() => {
    if (!systemMemory) return 16384
    // Max allocatable = total - 4GB for OS (minimum 8GB to allocate)
    return Math.max(Math.floor((systemMemory.total_mb - 4096) / 512) * 512, 8192)
  }, [systemMemory])

  const getRamZone = (ramMb: number): RamZone => {
    if (ramMb < 2048) return "low"
    if (ramMb <= 4096) return "optimal"
    if (ramMb <= 8192) return "good"
    if (ramMb <= 12288) return "warning"
    return "danger"
  }

  const zone = getRamZone(value)

  const getZoneColor = (z: RamZone): string => {
    switch (z) {
      case "low": return "text-blue-500"
      case "optimal": return "text-green-500"
      case "good": return "text-emerald-500"
      case "warning": return "text-amber-500"
      case "danger": return "text-red-500"
    }
  }

  const getZoneBgColor = (z: RamZone): string => {
    switch (z) {
      case "low": return "#3b82f6"
      case "optimal": return "#22c55e"
      case "good": return "#10b981"
      case "warning": return "#f59e0b"
      case "danger": return "#ef4444"
    }
  }

  const getZoneDescription = (z: RamZone): string => {
    switch (z) {
      case "low": return t("ram.zoneLow")
      case "optimal": return t("ram.zoneOptimal")
      case "good": return t("ram.zoneGood")
      case "warning": return t("ram.zoneWarning")
      case "danger": return t("ram.zoneDanger")
    }
  }

  const formatRam = (mb: number): string => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`
    }
    return `${mb} MB`
  }

  // Calculate zone boundaries as percentages
  const zonePercentages = useMemo(() => {
    const range = maxRam - minValue
    return {
      low: Math.min(100, Math.max(0, ((2048 - minValue) / range) * 100)),
      optimal: Math.min(100, Math.max(0, ((4096 - minValue) / range) * 100)),
      good: Math.min(100, Math.max(0, ((8192 - minValue) / range) * 100)),
      warning: Math.min(100, Math.max(0, ((12288 - minValue) / range) * 100)),
    }
  }, [minValue, maxRam])

  // Generate step values (512MB increments)
  const steps = useMemo(() => {
    const result: number[] = []
    for (let i = minValue; i <= maxRam; i += 512) {
      result.push(i)
    }
    return result
  }, [minValue, maxRam])

  const valueIndex = steps.findIndex(s => s >= value) !== -1
    ? steps.findIndex(s => s >= value)
    : steps.length - 1

  // const percentage = (valueIndex / (steps.length - 1)) * 100

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value, 10)
    if (index >= 0 && index < steps.length) {
      onChange(steps[index])
    }
  }

  // Generate gradient for the track background
  const trackGradient = useMemo(() => {
    const { low, optimal, good, warning } = zonePercentages
    return `linear-gradient(to right,
      #3b82f6 0%,
      #3b82f6 ${low}%,
      #22c55e ${low}%,
      #22c55e ${optimal}%,
      #10b981 ${optimal}%,
      #10b981 ${good}%,
      #f59e0b ${good}%,
      #f59e0b ${warning}%,
      #ef4444 ${warning}%,
      #ef4444 100%
    )`
  }, [zonePercentages])

  const handleAutoSetup = () => {
    if (!systemMemory) return
    const recommendedRam = recommendedValue === "min"
      ? systemMemory.recommended_min_mb
      : systemMemory.recommended_max_mb
    // Round to nearest 512MB step
    const roundedRam = Math.floor(recommendedRam / 512) * 512
    onChange(Math.max(minValue, roundedRam))
  }

  const isAtRecommended = systemMemory && (
    recommendedValue === "min"
      ? value === Math.floor(systemMemory.recommended_min_mb / 512) * 512
      : value === Math.floor(systemMemory.recommended_max_mb / 512) * 512
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm">{label}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleAutoSetup}
            disabled={!systemMemory || !!isAtRecommended}
            className={cn(
              "h-5 px-1.5 text-xs gap-1",
              isAtRecommended && "text-green-500"
            )}
          >
            <Wand2 className="h-3 w-3" />
            Auto
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-base font-bold", getZoneColor(zone))}>
            {formatRam(value)}
          </span>
          {systemMemory && (
            <span className="text-xs text-muted-foreground">
              / {formatRam(systemMemory.total_mb)} total
            </span>
          )}
        </div>
      </div>

      {/* Custom slider with colored track */}
      <div className="relative ram-slider-container">
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={valueIndex}
          onChange={handleSliderChange}
          className="w-full h-2 rounded-full appearance-none cursor-pointer ram-slider"
          style={{
            background: trackGradient,
            // @ts-expect-error CSS custom property
            "--thumb-color": getZoneBgColor(zone),
          }}
        />
      </div>

      {/* Labels under slider */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatRam(minValue)}</span>
        <span className={cn("font-medium", getZoneColor(zone))}>
          {getZoneDescription(zone)}
        </span>
        <span>{formatRam(maxRam)}</span>
      </div>

      {/* Recommendation */}
      {systemMemory && (
        <div className="text-xs text-muted-foreground text-right">
          {t("ram.recommended")} {formatRam(systemMemory.recommended_min_mb)} - {formatRam(systemMemory.recommended_max_mb)}
        </div>
      )}

      {/* Legend - compact horizontal */}
      <div className="flex flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-muted-foreground">&lt;2GB</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">2-4GB</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">4-8GB</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-muted-foreground">8-12GB</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-muted-foreground">&gt;12GB</span>
        </div>
      </div>
    </div>
  )
}
