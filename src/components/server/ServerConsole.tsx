import { useState, useEffect, useRef, useMemo, memo } from "react"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { Send, Trash2, Download, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "@/i18n"

interface ServerLogEvent {
  instance_id: string
  line: string
  is_error: boolean
}

interface LogLine {
  text: string
  isError: boolean
  timestamp: Date
}

interface ServerConsoleProps {
  instanceId: string
  isRunning: boolean
}

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
  "30": "#4d4d4d", // Black (dark gray for visibility)
  "31": "#ff5555", // Red
  "32": "#55ff55", // Green
  "33": "#ffff55", // Yellow
  "34": "#5555ff", // Blue
  "35": "#ff55ff", // Magenta
  "36": "#55ffff", // Cyan
  "37": "#ffffff", // White
  "90": "#808080", // Bright Black (Gray)
  "91": "#ff6b6b", // Bright Red
  "92": "#69ff69", // Bright Green
  "93": "#ffff69", // Bright Yellow
  "94": "#6b6bff", // Bright Blue
  "95": "#ff69ff", // Bright Magenta
  "96": "#69ffff", // Bright Cyan
  "97": "#ffffff", // Bright White
}

// Minecraft color codes (§)
const MC_COLORS: Record<string, string> = {
  "0": "#000000", // Black
  "1": "#0000aa", // Dark Blue
  "2": "#00aa00", // Dark Green
  "3": "#00aaaa", // Dark Aqua
  "4": "#aa0000", // Dark Red
  "5": "#aa00aa", // Dark Purple
  "6": "#ffaa00", // Gold
  "7": "#aaaaaa", // Gray
  "8": "#555555", // Dark Gray
  "9": "#5555ff", // Blue
  "a": "#55ff55", // Green
  "b": "#55ffff", // Aqua
  "c": "#ff5555", // Red
  "d": "#ff55ff", // Light Purple
  "e": "#ffff55", // Yellow
  "f": "#ffffff", // White
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

  // Combined regex for ANSI codes and Minecraft § codes
  // ANSI: \x1b[...m (ESC character followed by [ and color codes ending with m)
  // Minecraft: §X where X is 0-9 or a-f or formatting codes (l, n, o, r)
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]+)m|\u001b\[([0-9;]+)m|§([0-9a-fklmnor])/gi

  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index)
      if (textBefore) {
        segments.push({ text: textBefore, color: currentColor, bold, italic, underline })
      }
    }

    // Parse the code
    const ansiCode = match[1] || match[2]
    const mcCode = match[3]?.toLowerCase()

    if (ansiCode) {
      // Parse ANSI codes (can have multiple separated by ;)
      const codes = ansiCode.split(";")
      for (const code of codes) {
        if (code === "0") {
          // Reset
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
      // Parse Minecraft codes
      if (mcCode === "r") {
        // Reset
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

  // Add remaining text
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
}

const LogLineComponent = memo(function LogLineComponent({ log, level, hasColorCodes }: LogLineProps) {
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

  return (
    <div className={`whitespace-pre-wrap break-all py-0.5 ${colorClass}`}>
      {log.text}
    </div>
  )
})


export function ServerConsole({ instanceId, isRunning }: ServerConsoleProps) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogLine[]>([])
  const [command, setCommand] = useState("")
  const [isPaused, setIsPaused] = useState(false)
  const [autoScroll] = useState(true)
  const [isLoadingLogs, setIsLoadingLogs] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load existing logs from latest.log on mount
  useEffect(() => {
    const loadExistingLogs = async () => {
      setIsLoadingLogs(true)
      try {
        const content = await invoke<string>("read_instance_log", {
          instanceId,
          logName: "latest.log",
          tailLines: 500 // Load last 500 lines
        })

        if (content) {
          const lines = content.split("\n").filter(line => line.trim())
          const existingLogs: LogLine[] = lines.map(line => ({
            text: line,
            isError: false,
            timestamp: new Date()
          }))
          setLogs(existingLogs)

          // Add last lines to deduplication buffer to avoid duplicates when streaming starts
          const lastLines = lines.slice(-20)
          lastLinesRef.current = lastLines
        }
      } catch {
        // Log file might not exist yet, that's okay
      } finally {
        setIsLoadingLogs(false)
      }
    }

    loadExistingLogs()
  }, [instanceId])

  // Get log level from line
  const getLogLevel = (line: string): string | null => {
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
  }

  // Count errors and warnings in a single pass (optimized)
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
  }, [logs])

  // Track last lines to deduplicate
  const lastLinesRef = useRef<string[]>([])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    const setupListener = async () => {
      unlisten = await listen<ServerLogEvent>("server-log", (event) => {
        if (event.payload.instance_id === instanceId && !isPaused) {
          const line = event.payload.line

          // Deduplicate: check if this line was recently added
          const recentLines = lastLinesRef.current
          if (recentLines.includes(line)) {
            return // Skip duplicate
          }

          // Add to recent lines buffer (keep last 10)
          lastLinesRef.current = [...recentLines.slice(-9), line]

          setLogs((prev) => {
            const newLogs = [...prev, {
              text: line,
              isError: event.payload.is_error,
              timestamp: new Date()
            }]
            // Keep last 5000 lines
            if (newLogs.length > 5000) {
              return newLogs.slice(-5000)
            }
            return newLogs
          })
        }
      })
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [instanceId, isPaused])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleSendCommand = async () => {
    if (!command.trim() || !isRunning) return

    try {
      await invoke("send_server_command", { instanceId, command: command.trim() })
      // Add command to logs locally
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
    a.download = `server-${instanceId}-${new Date().toISOString()}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <Badge variant="destructive">{errorCount} {t("serverConsole.errors")}</Badge>
          )}
          {warnCount > 0 && (
            <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600">
              {warnCount} {t("serverConsole.warnings")}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {logs.length} {t("serverConsole.lines")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            className="gap-2"
          >
            {isPaused ? (
              <>
                <Play className="h-4 w-4" />
                {t("serverConsole.resume")}
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" />
                {t("serverConsole.pause")}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadLogs}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {t("serverConsole.export")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearLogs}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {t("serverConsole.clear")}
          </Button>
        </div>
      </div>

      {/* Console output - Optimized with CSS content-visibility */}
      <div
        className="rounded-md border bg-zinc-950 h-[500px] overflow-y-auto"
        ref={scrollRef}
      >
        <div className="p-4 text-xs font-mono">
          {isLoadingLogs ? (
            <span className="text-muted-foreground">
              {t("serverConsole.loadingLogs")}
            </span>
          ) : logs.length === 0 ? (
            <span className="text-muted-foreground">
              {isRunning
                ? t("serverConsole.waitingLogs")
                : t("serverConsole.startServerForLogs")
              }
            </span>
          ) : (
            logs.map((log, index) => {
              const level = getLogLevel(log.text)
              // eslint-disable-next-line no-control-regex
              const hasColorCodes = /\x1b\[|§/.test(log.text)

              return (
                <LogLineComponent
                  key={index}
                  log={log}
                  level={level}
                  hasColorCodes={hasColorCodes}
                />
              )
            })
          )}
        </div>
      </div>

      {/* Command input */}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? t("serverConsole.enterCommand") : t("serverConsole.serverStopped")}
          disabled={!isRunning}
          className="font-mono"
        />
        <Button
          onClick={handleSendCommand}
          disabled={!isRunning || !command.trim()}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          {t("serverConsole.send")}
        </Button>
      </div>
    </div>
  )
}
