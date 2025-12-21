import { useState, useEffect, useRef, useMemo, memo, useCallback, lazy, Suspense } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTauriListener } from "@/hooks/useTauriListener"
import {
  Send,
  Trash2,
  Download,
  Pause,
  Play,
  FileText,
  Clock,
  Search,
  ChevronDown,
  FolderOpen,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTranslation } from "@/i18n"

// Lazy load DetectedIssues for the popover
const DetectedIssues = lazy(() => import("@/components/instances/DetectedIssues").then(m => ({ default: m.DetectedIssues })))

interface InstanceLogEvent {
  instance_id: string
  line: string
  is_error: boolean
}

interface LogLine {
  text: string
  isError: boolean
  timestamp: Date
}

interface LogFileInfo {
  name: string
  size_bytes: number
  modified: string | null
}

interface InstanceConsoleProps {
  instanceId: string
  isRunning: boolean
  isServer: boolean
  mcVersion?: string
  loader?: string | null
  onModInstalled?: () => void
}

type LogLevel = "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG"

const LOG_LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-500",
  FATAL: "text-red-600 font-bold",
  WARN: "text-yellow-500",
  WARNING: "text-yellow-500",
  INFO: "text-blue-400",
  DEBUG: "text-gray-400",
  TRACE: "text-gray-500",
}

// ANSI color code mapping
const ANSI_COLORS: Record<string, string> = {
  "30": "#4d4d4d",
  "31": "#ff5555",
  "32": "#55ff55",
  "33": "#ffff55",
  "34": "#5555ff",
  "35": "#ff55ff",
  "36": "#55ffff",
  "37": "#ffffff",
  "90": "#808080",
  "91": "#ff6b6b",
  "92": "#69ff69",
  "93": "#ffff69",
  "94": "#6b6bff",
  "95": "#ff69ff",
  "96": "#69ffff",
  "97": "#ffffff",
}

// Minecraft color codes (§)
const MC_COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000aa",
  "2": "#00aa00",
  "3": "#00aaaa",
  "4": "#aa0000",
  "5": "#aa00aa",
  "6": "#ffaa00",
  "7": "#aaaaaa",
  "8": "#555555",
  "9": "#5555ff",
  "a": "#55ff55",
  "b": "#55ffff",
  "c": "#ff5555",
  "d": "#ff55ff",
  "e": "#ffff55",
  "f": "#ffffff",
}

interface TextSegment {
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

// Parse ANSI and Minecraft color codes into segments
function parseColorCodes(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let currentColor: string | undefined = undefined
  let bold = false
  let italic = false
  let underline = false

  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]+)m|\u001b\[([0-9;]+)m|§([0-9a-fklmnor])/gi

  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index)
      if (textBefore) {
        segments.push({ text: textBefore, color: currentColor, bold, italic, underline })
      }
    }

    const ansiCode = match[1] || match[2]
    const mcCode = match[3]?.toLowerCase()

    if (ansiCode) {
      const codes = ansiCode.split(";")
      for (const code of codes) {
        if (code === "0") {
          currentColor = undefined
          bold = false
          italic = false
          underline = false
        } else if (code === "1") {
          bold = true
        } else if (code === "3") {
          italic = true
        } else if (code === "4") {
          underline = true
        } else if (ANSI_COLORS[code]) {
          currentColor = ANSI_COLORS[code]
        }
      }
    } else if (mcCode) {
      if (mcCode === "r") {
        currentColor = undefined
        bold = false
        italic = false
        underline = false
      } else if (mcCode === "l") {
        bold = true
      } else if (mcCode === "o") {
        italic = true
      } else if (mcCode === "n") {
        underline = true
      } else if (MC_COLORS[mcCode]) {
        currentColor = MC_COLORS[mcCode]
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), color: currentColor, bold, italic, underline })
  }

  return segments
}

// Memoized component to render colored text
const ColoredText = memo(function ColoredText({ text }: { text: string }) {
  const segments = useMemo(() => parseColorCodes(text), [text])

  if (segments.length === 0) {
    return <>{text}</>
  }

  return (
    <>
      {segments.map((segment, i) => {
        const style: React.CSSProperties = {}
        if (segment.color) style.color = segment.color
        if (segment.bold) style.fontWeight = "bold"
        if (segment.italic) style.fontStyle = "italic"
        if (segment.underline) style.textDecoration = "underline"

        return Object.keys(style).length > 0 ? (
          <span key={i} style={style}>{segment.text}</span>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      })}
    </>
  )
})

// Memoized log line component
interface LogLineProps {
  log: LogLine
  level: string | null
  hasColorCodes: boolean
  searchTerm?: string
}

const LogLineComponent = memo(function LogLineComponent({ log, level, hasColorCodes, searchTerm }: LogLineProps) {
  // Command lines
  if (log.text.startsWith("> ")) {
    return (
      <div className="whitespace-pre-wrap break-all py-0.5 text-green-400 font-semibold">
        {log.text}
      </div>
    )
  }

  // If the line has color codes, use ColoredText
  if (hasColorCodes) {
    return (
      <div className="whitespace-pre-wrap break-all py-0.5 text-gray-300">
        <ColoredText text={log.text} />
      </div>
    )
  }

  // Default coloring based on log level
  const colorClass = log.isError
    ? "text-red-400"
    : level
      ? LOG_LEVEL_COLORS[level] || "text-gray-300"
      : "text-gray-300"

  // Highlight search term if present
  if (searchTerm && log.text.toLowerCase().includes(searchTerm.toLowerCase())) {
    const parts = log.text.split(new RegExp(`(${searchTerm})`, "gi"))
    return (
      <div className={`whitespace-pre-wrap break-all py-0.5 ${colorClass}`}>
        {parts.map((part, i) =>
          part.toLowerCase() === searchTerm.toLowerCase() ? (
            <mark key={i} className="bg-yellow-500/50 text-inherit">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </div>
    )
  }

  return (
    <div className={`whitespace-pre-wrap break-all py-0.5 ${colorClass}`}>
      {log.text}
    </div>
  )
})


export function InstanceConsole({ instanceId, isRunning, isServer, mcVersion, loader, onModInstalled }: InstanceConsoleProps) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogLine[]>([])
  const [command, setCommand] = useState("")
  const [isPaused, setIsPaused] = useState(false)
  const [isLoadingLogs, setIsLoadingLogs] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Log files state
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([])
  const [selectedLogFile, setSelectedLogFile] = useState<string>("live")
  const [searchTerm, setSearchTerm] = useState("")
  const [levelFilter, setLevelFilter] = useState<LogLevel>("ALL")

  // Issues state
  const [issuesCount, setIssuesCount] = useState(0)
  const [isAnalyzingIssues, setIsAnalyzingIssues] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)

  // Track last lines to deduplicate
  const lastLinesRef = useRef<string[]>([])

  // Get log level from line
  const getLogLevel = useCallback((line: string): string | null => {
    const patterns = [
      /\[(?:Thread[^/]*\/)?(\bERROR\b|\bWARN(?:ING)?\b|\bINFO\b|\bDEBUG\b|\bFATAL\b|\bTRACE\b)\]/i,
      /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|TRACE)\b:?/i,
    ]
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match) {
        const level = match[1].toUpperCase()
        return level === "WARNING" ? "WARN" : level
      }
    }
    return null
  }, [])

  // Load log files list
  const loadLogFiles = useCallback(async () => {
    try {
      const files = await invoke<LogFileInfo[]>("get_instance_logs", { instanceId })
      setLogFiles(files)
    } catch {
      // Ignore errors - log folder might not exist yet
    }
  }, [instanceId])

  // Analyze issues count (lightweight check)
  const analyzeIssuesCount = useCallback(async () => {
    if (!mcVersion || !loader) return
    setIsAnalyzingIssues(true)
    try {
      const issues = await invoke<unknown[]>("analyze_instance_logs", { instanceId })
      setIssuesCount(issues.length)
    } catch {
      // Ignore - might not have logs yet
    } finally {
      setIsAnalyzingIssues(false)
    }
  }, [instanceId, mcVersion, loader])

  // Check for issues when logs have errors
  useEffect(() => {
    if (mcVersion && loader && logs.some(l => l.isError || l.text.includes("ERROR") || l.text.includes("Exception"))) {
      analyzeIssuesCount()
    }
  }, [logs.length, mcVersion, loader, analyzeIssuesCount])

  // Load existing logs from latest.log on mount
  useEffect(() => {
    const loadExistingLogs = async () => {
      setIsLoadingLogs(true)
      try {
        const content = await invoke<string>("read_instance_log", {
          instanceId,
          logName: "latest.log",
          tailLines: 500
        })

        if (content) {
          const lines = content.split("\n").filter(line => line.trim())
          const existingLogs: LogLine[] = lines.map(line => ({
            text: line,
            isError: false,
            timestamp: new Date()
          }))
          setLogs(existingLogs)

          // Add last lines to deduplication buffer
          const lastLines = lines.slice(-20)
          lastLinesRef.current = lastLines
        }
      } catch {
        // Log file might not exist yet
      } finally {
        setIsLoadingLogs(false)
      }
    }

    loadExistingLogs()
    loadLogFiles()
  }, [instanceId, loadLogFiles])

  // Load historical log file
  const loadHistoricalLog = useCallback(async (logName: string) => {
    setIsLoadingLogs(true)
    try {
      const content = await invoke<string>("read_instance_log", {
        instanceId,
        logName,
        tailLines: 2000
      })

      if (content) {
        const lines = content.split("\n").filter(line => line.trim())
        const historicalLogs: LogLine[] = lines.map(line => ({
          text: line,
          isError: false,
          timestamp: new Date()
        }))
        setLogs(historicalLogs)
      }
    } catch (err) {
      console.error("Failed to load log file:", err)
    } finally {
      setIsLoadingLogs(false)
    }
  }, [instanceId])

  // Handle log file selection change
  useEffect(() => {
    if (selectedLogFile === "live") {
      // Switch to live mode - reload latest.log
      const loadLive = async () => {
        setIsLoadingLogs(true)
        try {
          const content = await invoke<string>("read_instance_log", {
            instanceId,
            logName: "latest.log",
            tailLines: 500
          })

          if (content) {
            const lines = content.split("\n").filter(line => line.trim())
            const existingLogs: LogLine[] = lines.map(line => ({
              text: line,
              isError: false,
              timestamp: new Date()
            }))
            setLogs(existingLogs)
            lastLinesRef.current = lines.slice(-20)
          }
        } catch {
          setLogs([])
        } finally {
          setIsLoadingLogs(false)
        }
      }
      loadLive()
    } else {
      // Load historical log
      loadHistoricalLog(selectedLogFile)
    }
  }, [selectedLogFile, instanceId, loadHistoricalLog])

  // Handle instance log events with proper cleanup (only in live mode)
  const handleLogEvent = useCallback((event: { payload: InstanceLogEvent }) => {
    if (selectedLogFile !== "live") return
    if (event.payload.instance_id !== instanceId || isPaused) return

    const line = event.payload.line

    // Deduplicate
    const recentLines = lastLinesRef.current
    if (recentLines.includes(line)) {
      return
    }

    lastLinesRef.current = [...recentLines.slice(-9), line]

    setLogs((prev) => {
      const newLogs = [...prev, {
        text: line,
        isError: event.payload.is_error,
        timestamp: new Date()
      }]
      if (newLogs.length > 5000) {
        return newLogs.slice(-5000)
      }
      return newLogs
    })
  }, [instanceId, isPaused, selectedLogFile])

  useTauriListener<InstanceLogEvent>("instance-log", handleLogEvent, [instanceId, isPaused, selectedLogFile])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && selectedLogFile === "live") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, selectedLogFile])

  // Count errors and warnings
  const { errorCount, warnCount } = useMemo(() => {
    let errors = 0
    let warnings = 0
    for (const log of logs) {
      const level = getLogLevel(log.text)
      if (level === "ERROR" || level === "FATAL") {
        errors++
      } else if (level === "WARN") {
        warnings++
      }
    }
    return { errorCount: errors, warnCount: warnings }
  }, [logs, getLogLevel])

  // Filter logs by level and search
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Level filter
      if (levelFilter !== "ALL") {
        const level = getLogLevel(log.text)
        if (levelFilter === "ERROR" && level !== "ERROR" && level !== "FATAL") return false
        if (levelFilter === "WARN" && level !== "WARN") return false
        if (levelFilter === "INFO" && level !== "INFO") return false
        if (levelFilter === "DEBUG" && level !== "DEBUG" && level !== "TRACE") return false
      }

      // Search filter
      if (searchTerm) {
        return log.text.toLowerCase().includes(searchTerm.toLowerCase())
      }

      return true
    })
  }, [logs, levelFilter, searchTerm, getLogLevel])

  const handleSendCommand = async () => {
    if (!command.trim() || !isRunning || !isServer) return

    try {
      await invoke("send_server_command", { instanceId, command: command.trim() })
      setLogs((prev) => [...prev, {
        text: `> ${command}`,
        isError: false,
        timestamp: new Date()
      }])
      setCommand("")
      inputRef.current?.focus()
    } catch (err) {
      console.error("Failed to send command:", err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSendCommand()
    }
  }

  const handleClearLogs = () => {
    setLogs([])
    lastLinesRef.current = []
  }

  const handleDownloadLogs = () => {
    const content = logs.map(l => `[${l.timestamp.toISOString()}] ${l.text}`).join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${isServer ? "server" : "client"}-${instanceId}-${new Date().toISOString()}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenLogsFolder = async () => {
    try {
      await invoke("open_logs_folder", { instanceId })
    } catch (err) {
      console.error("Failed to open logs folder:", err)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ""
    // Backend sends "YYYY-MM-DD HH:MM:SS" format
    const date = new Date(dateStr.replace(" ", "T"))
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Log file selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {selectedLogFile === "live" ? (
                  <>
                    <Clock className="h-4 w-4 text-green-500" />
                    {t("console.liveLog")}
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" />
                    {selectedLogFile}
                  </>
                )}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={() => setSelectedLogFile("live")}>
                <Clock className="h-4 w-4 mr-2 text-green-500" />
                <span className="font-medium">{t("console.liveLog")}</span>
                {isRunning && (
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {t("console.live")}
                  </Badge>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {logFiles.length > 0 ? (
                logFiles.map(file => (
                  <DropdownMenuItem
                    key={file.name}
                    onClick={() => setSelectedLogFile(file.name)}
                  >
                    <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(file.size_bytes)} • {formatDate(file.modified)}
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  {t("console.noLogFiles")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleOpenLogsFolder}>
                <FolderOpen className="h-4 w-4 mr-2" />
                {t("console.openLogsFolder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Error/Warning badges */}
          {errorCount > 0 && (
            <Badge variant="destructive">{errorCount} {t("console.errors")}</Badge>
          )}
          {warnCount > 0 && (
            <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600">
              {warnCount} {t("console.warnings")}
            </Badge>
          )}

          {/* Issues badge - discrete popover */}
          {mcVersion && loader && (issuesCount > 0 || isAnalyzingIssues) && (
            <Popover open={issuesOpen} onOpenChange={setIssuesOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-7 px-2 text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                >
                  {isAnalyzingIssues ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  <span className="text-xs font-medium">
                    {issuesCount} {t("console.issues")}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0 max-h-[400px] overflow-auto" align="start">
                <Suspense fallback={
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                }>
                  <DetectedIssues
                    instanceId={instanceId}
                    mcVersion={mcVersion}
                    loader={loader}
                    onModInstalled={() => {
                      onModInstalled?.()
                      analyzeIssuesCount()
                    }}
                    onModDeleted={() => {
                      onModInstalled?.()
                      analyzeIssuesCount()
                    }}
                    compact
                  />
                </Suspense>
              </PopoverContent>
            </Popover>
          )}

          <span className="text-xs text-muted-foreground">
            {filteredLogs.length}{logs.length !== filteredLogs.length && `/${logs.length}`} {t("console.lines")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Level filter */}
          <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LogLevel)}>
            <SelectTrigger className="w-[100px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("console.allLevels")}</SelectItem>
              <SelectItem value="ERROR">{t("console.errorLevel")}</SelectItem>
              <SelectItem value="WARN">{t("console.warnLevel")}</SelectItem>
              <SelectItem value="INFO">{t("console.infoLevel")}</SelectItem>
              <SelectItem value="DEBUG">{t("console.debugLevel")}</SelectItem>
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("console.searchPlaceholder")}
              className="pl-8 h-8 w-40"
            />
          </div>

          {/* Actions */}
          {selectedLogFile === "live" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPaused(!isPaused)}
              className="gap-2"
            >
              {isPaused ? (
                <>
                  <Play className="h-4 w-4" />
                  {t("console.resume")}
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  {t("console.pause")}
                </>
              )}
            </Button>
          )}

          {selectedLogFile !== "live" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadLogFiles()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadLogs}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearLogs}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Console output */}
      <div
        className="rounded-md border bg-zinc-950 flex-1 min-h-0 overflow-y-auto"
        ref={scrollRef}
      >
        <div className="p-4 text-xs font-mono">
          {isLoadingLogs ? (
            <span className="text-muted-foreground">
              {t("console.loadingLogs")}
            </span>
          ) : filteredLogs.length === 0 ? (
            <span className="text-muted-foreground">
              {searchTerm || levelFilter !== "ALL"
                ? t("console.noMatchingLogs")
                : isRunning
                  ? t("console.waitingLogs")
                  : t("console.startInstanceForLogs")
              }
            </span>
          ) : (
            filteredLogs.map((log, index) => {
              const level = getLogLevel(log.text)
              // eslint-disable-next-line no-control-regex
              const hasColorCodes = /\x1b\[|§/.test(log.text)

              return (
                <LogLineComponent
                  key={index}
                  log={log}
                  level={level}
                  hasColorCodes={hasColorCodes}
                  searchTerm={searchTerm}
                />
              )
            })
          )}
        </div>
      </div>

      {/* Command input - only for servers */}
      {isServer && (
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? t("console.enterCommand") : t("console.serverStopped")}
            disabled={!isRunning || selectedLogFile !== "live"}
            className="font-mono"
          />
          <Button
            onClick={handleSendCommand}
            disabled={!isRunning || !command.trim() || selectedLogFile !== "live"}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {t("console.send")}
          </Button>
        </div>
      )}
    </div>
  )
}

export default InstanceConsole
