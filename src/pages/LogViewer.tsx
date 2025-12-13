import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  X,
  Minus,
  Trash2,
  Download,
  Pause,
  Play,
  RefreshCw,
  Search,
  Filter,
  Monitor,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface LogEntry {
  timestamp: string;
  level: string;
  target: string;
  message: string;
  source: "backend" | "frontend";
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-500",
  WARN: "text-yellow-500",
  INFO: "text-blue-400",
  DEBUG: "text-gray-400",
  TRACE: "text-gray-500",
};

const LEVEL_BG_COLORS: Record<string, string> = {
  ERROR: "bg-red-500/10",
  WARN: "bg-yellow-500/10",
  INFO: "bg-blue-500/10",
  DEBUG: "bg-gray-500/10",
  TRACE: "bg-gray-500/10",
};

type LogLevel = "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";
type LogSource = "ALL" | "backend" | "frontend";

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel>("ALL");
  const [sourceFilter, setSourceFilter] = useState<LogSource>("ALL");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const frontendLogsRef = useRef<LogEntry[]>([]);

  // Setup console interception for frontend logs
  useEffect(() => {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    const createLogEntry = (level: string, args: unknown[]): LogEntry => ({
      timestamp: new Date().toISOString(),
      level,
      target: "frontend",
      message: args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
        )
        .join(" "),
      source: "frontend",
    });

    const addFrontendLog = (entry: LogEntry) => {
      frontendLogsRef.current = [...frontendLogsRef.current.slice(-499), entry];
    };

    console.log = (...args) => {
      originalConsole.log(...args);
      addFrontendLog(createLogEntry("INFO", args));
    };

    console.warn = (...args) => {
      originalConsole.warn(...args);
      addFrontendLog(createLogEntry("WARN", args));
    };

    console.error = (...args) => {
      originalConsole.error(...args);
      addFrontendLog(createLogEntry("ERROR", args));
    };

    console.info = (...args) => {
      originalConsole.info(...args);
      addFrontendLog(createLogEntry("INFO", args));
    };

    console.debug = (...args) => {
      originalConsole.debug(...args);
      addFrontendLog(createLogEntry("DEBUG", args));
    };

    // Cleanup: restore original console
    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      console.debug = originalConsole.debug;
    };
  }, []);

  // Load initial logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const recentLogs = await invoke<Omit<LogEntry, "source">[]>(
        "get_recent_logs",
        {
          count: 500,
        }
      );
      // Add source to backend logs
      const backendLogs: LogEntry[] = recentLogs.map((log) => ({
        ...log,
        source: "backend" as const,
      }));

      // Merge with frontend logs and sort by timestamp
      const allLogs = [...backendLogs, ...frontendLogsRef.current].sort(
        (a, b) => a.timestamp.localeCompare(b.timestamp)
      );

      setLogs(allLogs);
    } catch (error) {
      console.error("Failed to load logs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Poll for new logs when not paused
  useEffect(() => {
    if (paused) return;

    const interval = setInterval(async () => {
      try {
        const recentLogs = await invoke<Omit<LogEntry, "source">[]>(
          "get_recent_logs",
          {
            count: 500,
          }
        );
        // Add source to backend logs
        const backendLogs: LogEntry[] = recentLogs.map((log) => ({
          ...log,
          source: "backend" as const,
        }));

        // Merge with frontend logs and sort by timestamp
        const allLogs = [...backendLogs, ...frontendLogsRef.current].sort(
          (a, b) => a.timestamp.localeCompare(b.timestamp)
        );

        setLogs(allLogs);
      } catch (error) {
        console.error("Failed to refresh logs:", error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [paused]);

  // Auto-scroll handling
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Enable auto-scroll if near bottom
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  useEffect(() => {
    if (scrollRef.current && autoScrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, paused]);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    // Source filter
    if (sourceFilter !== "ALL" && log.source !== sourceFilter) {
      return false;
    }

    // Level filter
    if (levelFilter !== "ALL" && log.level !== levelFilter) {
      return false;
    }

    // Text filter
    if (filter) {
      const searchLower = filter.toLowerCase();
      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.target.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  const handleClear = async () => {
    try {
      await invoke("clear_log_buffer");
      frontendLogsRef.current = [];
      setLogs([]);
    } catch (error) {
      console.error("Failed to clear logs:", error);
    }
  };

  const handleDownload = () => {
    const content = logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.source.toUpperCase()}] ${l.level} ${l.target}: ${l.message}`
      )
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kaizen-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = async () => {
    const window = getCurrentWindow();
    await window.close();
  };

  const handleMinimize = async () => {
    const window = getCurrentWindow();
    await window.minimize();
  };

  // Handle window drag
  const handleDragStart = async (e: React.MouseEvent) => {
    // Only start drag if clicking directly on the drag region (not buttons)
    if ((e.target as HTMLElement).closest("button")) return;
    const window = getCurrentWindow();
    await window.startDragging();
  };

  // Format timestamp for display
  const formatTime = (timestamp: string) => {
    try {
      const time = timestamp.split("T")[1]?.slice(0, 12) || timestamp;
      return time;
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Custom title bar */}
      <div
        className="flex items-center justify-between h-10 px-3 bg-muted/50 border-b select-none shrink-0 cursor-move"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium pointer-events-none">
          Log Viewer
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleMinimize}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b shrink-0 bg-background">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter logs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-8"
          />
        </div>

        {/* Source filter */}
        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as LogSource)}
        >
          <SelectTrigger className="w-32 h-8">
            {sourceFilter === "backend" ? (
              <Server className="h-3 w-3 mr-1" />
            ) : sourceFilter === "frontend" ? (
              <Monitor className="h-3 w-3 mr-1" />
            ) : null}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Sources</SelectItem>
            <SelectItem value="backend">
              <div className="flex items-center gap-2">
                <Server className="h-3 w-3" />
                Backend
              </div>
            </SelectItem>
            <SelectItem value="frontend">
              <div className="flex items-center gap-2">
                <Monitor className="h-3 w-3" />
                Frontend
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Level filter */}
        <Select
          value={levelFilter}
          onValueChange={(v) => setLevelFilter(v as LogLevel)}
        >
          <SelectTrigger className="w-28 h-8">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="ERROR">Error</SelectItem>
            <SelectItem value="WARN">Warn</SelectItem>
            <SelectItem value="INFO">Info</SelectItem>
            <SelectItem value="DEBUG">Debug</SelectItem>
            <SelectItem value="TRACE">Trace</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaused(!paused)}
          className="h-8 w-8 p-0"
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={loadLogs}
          className="h-8 w-8 p-0"
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          className="h-8 w-8 p-0"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          className="h-8 w-8 p-0"
          title="Clear"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <Badge variant="secondary" className="text-xs tabular-nums">
          {filteredLogs.length}
          {filteredLogs.length !== logs.length && ` / ${logs.length}`}
        </Badge>

        {paused && (
          <Badge
            variant="outline"
            className="text-xs text-yellow-500 border-yellow-500/50"
          >
            Paused
          </Badge>
        )}
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-2 font-mono text-xs bg-zinc-950"
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {filter || levelFilter !== "ALL" || sourceFilter !== "ALL"
              ? "No matching logs"
              : "No logs yet"}
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div
              key={`${log.timestamp}-${i}`}
              className={cn(
                "py-0.5 px-1 rounded hover:bg-white/5 transition-colors",
                LEVEL_BG_COLORS[log.level]
              )}
            >
              <span className="text-muted-foreground">
                [{formatTime(log.timestamp)}]
              </span>{" "}
              <span
                className={cn(
                  "text-xs px-1 rounded",
                  log.source === "frontend"
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "bg-purple-500/20 text-purple-400"
                )}
              >
                {log.source === "frontend" ? "FE" : "BE"}
              </span>{" "}
              <span
                className={cn(
                  "font-semibold",
                  LEVEL_COLORS[log.level] || "text-gray-300"
                )}
              >
                {log.level.padEnd(5)}
              </span>{" "}
              <span className="text-purple-400">{log.target}</span>
              {": "}
              <span className="text-gray-300 break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
