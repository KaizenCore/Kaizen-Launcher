import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Activity, Cpu, HardDrive, Clock, X, Minimize2, Maximize2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface AppMetrics {
  cpu_usage: number
  memory_bytes: number
  memory_mb: number
  thread_count: number
  uptime_secs: number
  total_memory: number
  available_memory: number
  system_cpu_usage: number
}

interface DevMonitorProps {
  visible: boolean
  onClose: () => void
}

// Global render counter (outside component to avoid re-renders)
let globalRenderCount = 0

export function DevMonitor({ visible, onClose }: DevMonitorProps) {
  const [metrics, setMetrics] = useState<AppMetrics | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [displayedRenderCount, setDisplayedRenderCount] = useState(0)
  const [fps, setFps] = useState(0)
  const [rendersPerSec, setRendersPerSec] = useState(0)

  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const lastRenderCountRef = useRef(0)

  // Increment global render count (no state update = no re-render)
  globalRenderCount++

  // Calculate FPS using requestAnimationFrame
  useEffect(() => {
    if (!visible) return

    let animationId: number

    const measureFps = () => {
      frameCountRef.current++
      const now = performance.now()
      const delta = now - lastTimeRef.current

      if (delta >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / delta))
        frameCountRef.current = 0
        lastTimeRef.current = now
      }

      animationId = requestAnimationFrame(measureFps)
    }

    animationId = requestAnimationFrame(measureFps)
    return () => cancelAnimationFrame(animationId)
  }, [visible])

  // Update displayed render count and renders/sec periodically
  useEffect(() => {
    if (!visible) return

    // PERFORMANCE: Reduced from 1s to 2s to minimize state updates in dev monitor
    const interval = setInterval(() => {
      const currentCount = globalRenderCount
      const delta = currentCount - lastRenderCountRef.current

      setDisplayedRenderCount(currentCount)
      // Adjust calculation since we're now updating every 2 seconds
      setRendersPerSec(Math.round(delta / 2))

      lastRenderCountRef.current = currentCount
    }, 2000)

    return () => clearInterval(interval)
  }, [visible])

  // Fetch metrics from backend
  const fetchMetrics = useCallback(async () => {
    try {
      const data = await invoke<AppMetrics>("get_app_metrics")
      setMetrics(data)
    } catch (err) {
      console.error("Failed to fetch metrics:", err)
    }
  }, [])

  useEffect(() => {
    if (!visible) return

    fetchMetrics()
    // PERFORMANCE: Reduced from 1s to 3s to minimize backend CPU usage for metrics collection
    const interval = setInterval(fetchMetrics, 3000)
    return () => clearInterval(interval)
  }, [visible, fetchMetrics])

  if (!visible) return null

  const formatUptime = (secs: number) => {
    const hours = Math.floor(secs / 3600)
    const minutes = Math.floor((secs % 3600) / 60)
    const seconds = secs % 60
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const getCpuColor = (usage: number) => {
    if (usage > 80) return "text-red-500"
    if (usage > 50) return "text-yellow-500"
    return "text-green-500"
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 bg-background/95 backdrop-blur border rounded-lg shadow-lg transition-all duration-200",
        isMinimized ? "w-auto" : "w-72"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">Dev Monitor</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            {isMinimized ? (
              <Maximize2 className="h-3 w-3" />
            ) : (
              <Minimize2 className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <div className="p-3 space-y-3">
          {metrics ? (
            <>
              {/* Process Metrics */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">
                  Process
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard
                    icon={<Cpu className="h-3 w-3" />}
                    label="CPU"
                    value={`${metrics.cpu_usage.toFixed(1)}%`}
                    valueClass={getCpuColor(metrics.cpu_usage)}
                  />
                  <MetricCard
                    icon={<HardDrive className="h-3 w-3" />}
                    label="RAM"
                    value={formatBytes(metrics.memory_bytes)}
                  />
                  <MetricCard
                    icon={<Activity className="h-3 w-3" />}
                    label="Threads"
                    value={metrics.thread_count.toString()}
                  />
                  <MetricCard
                    icon={<Clock className="h-3 w-3" />}
                    label="Uptime"
                    value={formatUptime(metrics.uptime_secs)}
                  />
                </div>
              </div>

              {/* System Metrics */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">
                  System
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard
                    icon={<Cpu className="h-3 w-3" />}
                    label="Sys CPU"
                    value={`${metrics.system_cpu_usage.toFixed(1)}%`}
                    valueClass={getCpuColor(metrics.system_cpu_usage)}
                  />
                  <MetricCard
                    icon={<HardDrive className="h-3 w-3" />}
                    label="Sys RAM"
                    value={`${formatBytes(metrics.total_memory - metrics.available_memory)} / ${formatBytes(metrics.total_memory)}`}
                    small
                  />
                </div>
              </div>

              {/* React Metrics */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">
                  React
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MetricCard
                    label="FPS"
                    value={fps.toString()}
                    valueClass={fps < 30 ? "text-red-500" : fps < 55 ? "text-yellow-500" : "text-green-500"}
                  />
                  <MetricCard
                    label="Renders"
                    value={displayedRenderCount.toString()}
                  />
                  <MetricCard
                    label="R/sec"
                    value={rendersPerSec.toString()}
                    valueClass={rendersPerSec > 60 ? "text-red-500" : rendersPerSec > 30 ? "text-yellow-500" : "text-green-500"}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-4">
              <div className="text-xs text-muted-foreground">Loading metrics...</div>
            </div>
          )}
        </div>
      )}

      {/* Minimized view */}
      {isMinimized && metrics && (
        <div className="px-3 py-2 flex items-center gap-3 text-xs">
          <span className={getCpuColor(metrics.cpu_usage)}>
            {metrics.cpu_usage.toFixed(0)}% CPU
          </span>
          <span>{formatBytes(metrics.memory_bytes)}</span>
          <span className={fps < 30 ? "text-red-500" : "text-green-500"}>
            {fps} FPS
          </span>
        </div>
      )}
    </div>
  )
}

interface MetricCardProps {
  icon?: React.ReactNode
  label: string
  value: string
  valueClass?: string
  small?: boolean
}

function MetricCard({ icon, label, value, valueClass, small }: MetricCardProps) {
  return (
    <div className="bg-muted/30 rounded px-2 py-1.5">
      <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className={cn("font-mono font-semibold", small ? "text-[10px]" : "text-xs", valueClass)}>
        {value}
      </div>
    </div>
  )
}
