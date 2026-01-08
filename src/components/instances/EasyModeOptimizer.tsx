import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Wand2, Check, Loader2, Cpu, Zap, Leaf, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTranslation } from "@/i18n"
import { toast } from "sonner"

interface EasyModeOptimizerProps {
  instanceId: string
  loader: string | null
  isServer: boolean
  onOptimized: (settings: OptimizedSettings) => void
}

interface OptimizedSettings {
  memoryMin: number
  memoryMax: number
  jvmArgs: string
}

interface ModInfo {
  id: string
  name: string
  enabled: boolean
}

interface SystemMemoryInfo {
  total_mb: number
  available_mb: number
  recommended_min_mb: number
  recommended_max_mb: number
}

type OptimizationProfile = "vanilla" | "light" | "heavy" | "performance"

export function EasyModeOptimizer({
  instanceId,
  loader,
  isServer,
  onOptimized,
}: EasyModeOptimizerProps) {
  const { t } = useTranslation()
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isOptimized, setIsOptimized] = useState(false)
  const [detectedProfile, setDetectedProfile] =
    useState<OptimizationProfile | null>(null)
  const [modCount, setModCount] = useState<number | null>(null)

  const detectOptimalProfile = useCallback(async () => {
    try {
      // Get mod count
      const mods = await invoke<ModInfo[]>("get_instance_mods", { instanceId })
      const enabledMods = mods.filter((m) => m.enabled)
      const count = enabledMods.length
      setModCount(count)

      // Determine profile based on mod count and loader
      let profile: OptimizationProfile
      if (!loader || count === 0) {
        profile = "vanilla"
      } else if (count < 30) {
        profile = "light"
      } else if (count < 100) {
        profile = "heavy"
      } else {
        profile = "performance"
      }

      // Adjust for Forge/NeoForge (more resource-intensive)
      if (loader === "forge" || loader === "neoforge") {
        if (profile === "light") profile = "heavy"
      }

      setDetectedProfile(profile)
    } catch (error) {
      console.error("Failed to detect profile:", error)
      setDetectedProfile("light") // Default fallback
      setModCount(0)
    }
  }, [instanceId, loader])

  // Auto-detect profile on mount
  useEffect(() => {
    detectOptimalProfile()
  }, [detectOptimalProfile])

  const handleOptimize = async () => {
    setIsOptimizing(true)
    try {
      // Get system memory
      const sysMemory = await invoke<SystemMemoryInfo>("get_system_memory")

      // Calculate optimal settings based on profile
      const settings = calculateOptimalSettings(
        detectedProfile || "light",
        sysMemory,
        isServer
      )

      onOptimized(settings)
      setIsOptimized(true)
      toast.success(t("easyMode.optimizationApplied"))
    } catch (error) {
      console.error("Optimization failed:", error)
      toast.error(t("easyMode.optimizationFailed"))
    } finally {
      setIsOptimizing(false)
    }
  }

  const getProfileIcon = (profile: OptimizationProfile) => {
    switch (profile) {
      case "vanilla":
        return <Leaf className="h-4 w-4 text-green-500" />
      case "light":
        return <Zap className="h-4 w-4 text-yellow-500" />
      case "heavy":
        return <Cpu className="h-4 w-4 text-orange-500" />
      case "performance":
        return <Rocket className="h-4 w-4 text-red-500" />
    }
  }

  const getProfileName = (profile: OptimizationProfile) => {
    switch (profile) {
      case "vanilla":
        return t("easyMode.profileVanilla")
      case "light":
        return t("easyMode.profileLight")
      case "heavy":
        return t("easyMode.profileHeavy")
      case "performance":
        return t("easyMode.profilePerformance")
    }
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5" />
          {t("easyMode.autoOptimization")}
        </CardTitle>
        <CardDescription>{t("easyMode.autoOptimizationDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Detected profile info */}
        {detectedProfile && (
          <div className="p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2 text-sm">
              {getProfileIcon(detectedProfile)}
              <span className="font-medium">{t("easyMode.detectedProfile")}</span>
              <span className="text-primary font-semibold">
                {getProfileName(detectedProfile)}
              </span>
            </div>
            {modCount !== null && (
              <p className="text-xs text-muted-foreground mt-1">
                {t("easyMode.modsDetected", { count: modCount })}
              </p>
            )}
          </div>
        )}

        {/* Optimize button */}
        <Button
          onClick={handleOptimize}
          disabled={isOptimizing}
          className="w-full gap-2"
          variant={isOptimized ? "outline" : "default"}
        >
          {isOptimizing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("easyMode.optimizing")}
            </>
          ) : isOptimized ? (
            <>
              <Check className="h-4 w-4 text-green-500" />
              {t("easyMode.optimized")}
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" />
              {t("easyMode.optimizeNow")}
            </>
          )}
        </Button>

        {/* Info text */}
        <p className="text-xs text-muted-foreground text-center">
          {t("easyMode.optimizationInfo")}
        </p>
      </CardContent>
    </Card>
  )
}

// Helper function to calculate optimal settings
function calculateOptimalSettings(
  profile: OptimizationProfile,
  sysMemory: SystemMemoryInfo,
  isServer: boolean
): OptimizedSettings {
  const { total_mb, recommended_min_mb, recommended_max_mb } = sysMemory

  let memoryMin: number
  let memoryMax: number
  let jvmArgs: string

  switch (profile) {
    case "vanilla":
      memoryMin = Math.min(recommended_min_mb, 2048)
      memoryMax = Math.min(recommended_max_mb, 4096)
      jvmArgs = `-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+ParallelRefProcEnabled`
      break

    case "light": {
      memoryMin = Math.min(recommended_min_mb, 2048)
      memoryMax = Math.min(recommended_max_mb, 6144)
      const g1HeapLight = memoryMax >= 4096 ? 16 : 8
      jvmArgs = `-XX:+UseG1GC -XX:MaxGCPauseMillis=37 -XX:+ParallelRefProcEnabled -XX:G1HeapRegionSize=${g1HeapLight}M -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1ReservePercent=20`
      break
    }

    case "heavy": {
      memoryMin = Math.min(Math.max(recommended_min_mb, 4096), total_mb - 4096)
      memoryMax = Math.min(recommended_max_mb, 8192)
      const g1HeapHeavy =
        memoryMax >= 8192 ? 32 : memoryMax >= 4096 ? 16 : 8
      const concGCThreads = Math.max(2, Math.floor(memoryMax / 4096))
      jvmArgs = `-XX:+UseG1GC -XX:MaxGCPauseMillis=30 -XX:+ParallelRefProcEnabled -XX:G1HeapRegionSize=${g1HeapHeavy}M -XX:G1NewSizePercent=40 -XX:G1MaxNewSizePercent=50 -XX:G1ReservePercent=15 -XX:ConcGCThreads=${concGCThreads} -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:+UnlockExperimentalVMOptions -XX:G1MixedGCLiveThresholdPercent=35`
      break
    }

    case "performance":
    default: {
      memoryMin = Math.min(Math.max(recommended_min_mb, 4096), total_mb - 4096)
      memoryMax = Math.min(recommended_max_mb, 10240)
      const g1HeapPerf =
        memoryMax >= 8192 ? 32 : memoryMax >= 4096 ? 16 : 8
      const parallelGCThreads = Math.max(2, Math.floor(memoryMax / 2048))
      jvmArgs = `-XX:+UseG1GC -XX:MaxGCPauseMillis=25 -XX:+ParallelRefProcEnabled -XX:G1HeapRegionSize=${g1HeapPerf}M -XX:G1NewSizePercent=40 -XX:G1MaxNewSizePercent=50 -XX:G1ReservePercent=15 -XX:ParallelGCThreads=${parallelGCThreads} -XX:ConcGCThreads=${Math.max(1, Math.floor(parallelGCThreads / 2))} -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:+UnlockExperimentalVMOptions -XX:G1MixedGCLiveThresholdPercent=35 -XX:+UseStringDeduplication -XX:+OptimizeStringConcat`
      break
    }
  }

  // Server-specific adjustments (use Aikar's flags)
  if (isServer && profile !== "vanilla") {
    const g1NewSize = memoryMax >= 12288 ? 40 : 30
    const g1MaxNewSize = memoryMax >= 12288 ? 50 : 40
    const g1HeapRegion = memoryMax >= 12288 ? "16M" : "8M"
    jvmArgs = `-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=${g1NewSize} -XX:G1MaxNewSizePercent=${g1MaxNewSize} -XX:G1HeapRegionSize=${g1HeapRegion} -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1`
  }

  return { memoryMin, memoryMax, jvmArgs }
}
