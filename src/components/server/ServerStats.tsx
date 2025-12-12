import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Cpu, HardDrive, Clock, Activity } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { useTranslation } from "@/i18n"

interface ServerStatsData {
  cpu_usage: number
  memory_bytes: number
  memory_percent: number
  uptime_seconds: number
  pid: number
}

interface ServerStatsProps {
  instanceId: string
  isRunning: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

export function ServerStats({ instanceId, isRunning }: ServerStatsProps) {
  const { t } = useTranslation()
  const [stats, setStats] = useState<ServerStatsData | null>(null)

  useEffect(() => {
    if (!isRunning) {
      setStats(null)
      return
    }

    let interval: NodeJS.Timeout | null = null
    let isPaused = false

    const fetchStats = async () => {
      // Skip fetching if page is hidden (visibility optimization)
      if (document.hidden || isPaused) return

      try {
        const data = await invoke<ServerStatsData | null>("get_server_stats", { instanceId })
        setStats(data)
      } catch (err) {
        console.error("Failed to fetch server stats:", err)
      }
    }

    const startPolling = () => {
      if (interval) clearInterval(interval)
      // PERFORMANCE: Reduced from 3s to 10s to minimize backend CPU load
      // Backend needs 500ms per call, polling every 10s is sufficient for stats
      interval = setInterval(fetchStats, 10000)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, pause polling
        isPaused = true
        if (interval) {
          clearInterval(interval)
          interval = null
        }
      } else {
        // Page is visible again, resume polling
        isPaused = false
        fetchStats() // Fetch immediately when becoming visible
        startPolling()
      }
    }

    // Fetch immediately
    fetchStats()
    startPolling()

    // Listen for visibility changes
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [instanceId, isRunning])

  if (!isRunning) {
    return (
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="CPU"
          value="--"
          subValue={t("serverStats.serverStopped")}
        />
        <StatCard
          icon={<HardDrive className="h-4 w-4" />}
          label="RAM"
          value="--"
          subValue={t("serverStats.serverStopped")}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Uptime"
          value="--"
          subValue={t("serverStats.serverStopped")}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="PID"
          value="--"
          subValue={t("serverStats.serverStopped")}
        />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="CPU"
          value="..."
          subValue={t("serverStats.loading")}
        />
        <StatCard
          icon={<HardDrive className="h-4 w-4" />}
          label="RAM"
          value="..."
          subValue={t("serverStats.loading")}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Uptime"
          value="..."
          subValue={t("serverStats.loading")}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="PID"
          value="..."
          subValue={t("serverStats.loading")}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard
        icon={<Cpu className="h-4 w-4" />}
        label="CPU"
        value={`${stats.cpu_usage.toFixed(1)}%`}
        progress={Math.min(stats.cpu_usage, 100)}
        progressColor={stats.cpu_usage > 80 ? "bg-red-500" : stats.cpu_usage > 50 ? "bg-yellow-500" : "bg-green-500"}
      />
      <StatCard
        icon={<HardDrive className="h-4 w-4" />}
        label="RAM"
        value={formatBytes(stats.memory_bytes)}
        subValue={`${stats.memory_percent.toFixed(1)}${t("serverStats.systemUsage")}`}
        progress={stats.memory_percent}
        progressColor={stats.memory_percent > 80 ? "bg-red-500" : stats.memory_percent > 50 ? "bg-yellow-500" : "bg-blue-500"}
      />
      <StatCard
        icon={<Clock className="h-4 w-4" />}
        label="Uptime"
        value={formatUptime(stats.uptime_seconds)}
        subValue={t("serverStats.executionTime")}
      />
      <StatCard
        icon={<Activity className="h-4 w-4" />}
        label="PID"
        value={`${stats.pid}`}
        subValue={t("serverStats.processId")}
      />
    </div>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  subValue?: string
  progress?: number
  progressColor?: string
}

function StatCard({ icon, label, value, subValue, progress, progressColor }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {subValue && (
        <div className="text-xs text-muted-foreground mt-1">{subValue}</div>
      )}
      {progress !== undefined && (
        <div className="mt-2">
          <Progress
            value={progress}
            className="h-1.5"
            style={{
              "--progress-background": progressColor
            } as React.CSSProperties & { "--progress-background": string }}
          />
        </div>
      )}
    </div>
  )
}
