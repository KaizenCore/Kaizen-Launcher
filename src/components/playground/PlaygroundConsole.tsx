import { useState, useEffect, useRef, useMemo, memo, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Send, Trash2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";

interface InstanceLogEvent {
  instance_id: string;
  line: string;
  is_error: boolean;
}

interface LogLine {
  text: string;
  isError: boolean;
  timestamp: Date;
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-500",
  FATAL: "text-red-600 font-bold",
  WARN: "text-yellow-500",
  WARNING: "text-yellow-500",
  INFO: "text-blue-400",
  DEBUG: "text-gray-400",
  TRACE: "text-gray-500",
};

// ANSI color code mapping
const ANSI_COLORS: Record<string, string> = {
  "30": "#4d4d4d", "31": "#ff5555", "32": "#55ff55", "33": "#ffff55",
  "34": "#5555ff", "35": "#ff55ff", "36": "#55ffff", "37": "#ffffff",
  "90": "#808080", "91": "#ff6b6b", "92": "#69ff69", "93": "#ffff69",
  "94": "#6b6bff", "95": "#ff69ff", "96": "#69ffff", "97": "#ffffff",
};

// Minecraft color codes (§)
const MC_COLORS: Record<string, string> = {
  "0": "#000000", "1": "#0000aa", "2": "#00aa00", "3": "#00aaaa",
  "4": "#aa0000", "5": "#aa00aa", "6": "#ffaa00", "7": "#aaaaaa",
  "8": "#555555", "9": "#5555ff", "a": "#55ff55", "b": "#55ffff",
  "c": "#ff5555", "d": "#ff55ff", "e": "#ffff55", "f": "#ffffff",
};

interface TextSegment {
  text: string;
  color?: string;
  bold?: boolean;
}

function parseColorCodes(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentColor: string | undefined = undefined;
  let bold = false;

  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]+)m|\u001b\[([0-9;]+)m|§([0-9a-fklmnor])/gi;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        segments.push({ text: textBefore, color: currentColor, bold });
      }
    }

    const ansiCode = match[1] || match[2];
    const mcCode = match[3]?.toLowerCase();

    if (ansiCode) {
      const codes = ansiCode.split(";");
      for (const code of codes) {
        if (code === "0") { currentColor = undefined; bold = false; }
        else if (code === "1") { bold = true; }
        else if (ANSI_COLORS[code]) { currentColor = ANSI_COLORS[code]; }
      }
    } else if (mcCode) {
      if (mcCode === "r") { currentColor = undefined; bold = false; }
      else if (mcCode === "l") { bold = true; }
      else if (MC_COLORS[mcCode]) { currentColor = MC_COLORS[mcCode]; }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), color: currentColor, bold });
  }

  return segments;
}

const ColoredText = memo(function ColoredText({ text }: { text: string }) {
  const segments = useMemo(() => parseColorCodes(text), [text]);

  if (segments.length === 0) return <>{text}</>;

  return (
    <>
      {segments.map((segment, i) => {
        const style: React.CSSProperties = {};
        if (segment.color) style.color = segment.color;
        if (segment.bold) style.fontWeight = "bold";
        return Object.keys(style).length > 0 ? (
          <span key={i} style={style}>{segment.text}</span>
        ) : (
          <span key={i}>{segment.text}</span>
        );
      })}
    </>
  );
});

interface LogLineProps {
  log: LogLine;
  level: string | null;
  hasColorCodes: boolean;
}

const LogLineComponent = memo(function LogLineComponent({ log, level, hasColorCodes }: LogLineProps) {
  if (log.text.startsWith("> ")) {
    return <div className="text-green-400 font-semibold">{log.text}</div>;
  }

  if (hasColorCodes) {
    return (
      <div className="text-gray-300">
        <ColoredText text={log.text} />
      </div>
    );
  }

  const colorClass = log.isError
    ? "text-red-400"
    : level
      ? LOG_LEVEL_COLORS[level] || "text-gray-300"
      : "text-gray-300";

  return <div className={colorClass}>{log.text}</div>;
});

interface PlaygroundConsoleProps {
  instanceId: string;
  isRunning: boolean;
  isServer: boolean;
}

export function PlaygroundConsole({ instanceId, isRunning, isServer }: PlaygroundConsoleProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [command, setCommand] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastLinesRef = useRef<string[]>([]);

  const getLogLevel = useCallback((line: string): string | null => {
    const patterns = [
      /\[(?:Thread[^/]*\/)?(\bERROR\b|\bWARN(?:ING)?\b|\bINFO\b|\bDEBUG\b|\bFATAL\b|\bTRACE\b)\]/i,
      /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|TRACE)\b:?/i,
    ];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const level = match[1].toUpperCase();
        return level === "WARNING" ? "WARN" : level;
      }
    }
    return null;
  }, []);

  // Load existing logs
  useEffect(() => {
    const loadExistingLogs = async () => {
      try {
        const content = await invoke<string>("read_instance_log", {
          instanceId,
          logName: "latest.log",
          tailLines: 200,
        });

        if (content) {
          const lines = content.split("\n").filter((line) => line.trim());
          const existingLogs: LogLine[] = lines.map((line) => ({
            text: line,
            isError: false,
            timestamp: new Date(),
          }));
          setLogs(existingLogs);
          lastLinesRef.current = lines.slice(-20);
        }
      } catch {
        // Log file might not exist yet
      }
    };

    loadExistingLogs();
  }, [instanceId]);

  // Listen for real-time logs
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<InstanceLogEvent>("instance-log", (event) => {
        if (event.payload.instance_id === instanceId && !isPaused) {
          const line = event.payload.line;

          // Deduplicate
          if (lastLinesRef.current.includes(line)) return;
          lastLinesRef.current = [...lastLinesRef.current.slice(-9), line];

          setLogs((prev) => {
            const newLogs = [
              ...prev,
              { text: line, isError: event.payload.is_error, timestamp: new Date() },
            ];
            return newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs;
          });
        }
      });
    };

    setupListener();
    return () => { unlisten?.(); };
  }, [instanceId, isPaused]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSendCommand = async () => {
    if (!command.trim() || !isRunning || !isServer) return;

    try {
      await invoke("send_server_command", { instanceId, command: command.trim() });
      setLogs((prev) => [...prev, { text: `> ${command}`, isError: false, timestamp: new Date() }]);
      setCommand("");
      inputRef.current?.focus();
    } catch (err) {
      console.error("Failed to send command:", err);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    lastLinesRef.current = [];
  };

  return (
    <div className="flex flex-col h-full">
      {/* Compact toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2">
        <span className="text-xs text-muted-foreground">{logs.length} lines</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleClearLogs}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Console output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-zinc-950 p-2 font-mono text-[10px] leading-tight"
        onWheelCapture={(e) => e.stopPropagation()}
      >
        {logs.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            {isRunning ? t("console.waitingLogs") : t("console.startInstanceForLogs")}
          </span>
        ) : (
          logs.map((log, index) => {
            const level = getLogLevel(log.text);
            // eslint-disable-next-line no-control-regex
            const hasColorCodes = /\x1b\[|§/.test(log.text);
            return <LogLineComponent key={index} log={log} level={level} hasColorCodes={hasColorCodes} />;
          })
        )}
      </div>

      {/* Command input for servers */}
      {isServer && (
        <div className="flex items-center gap-1 p-1.5 border-t flex-shrink-0">
          <Input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendCommand()}
            placeholder={isRunning ? "Command..." : "Server stopped"}
            disabled={!isRunning}
            className="h-7 text-xs font-mono"
          />
          <Button
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleSendCommand}
            disabled={!isRunning || !command.trim()}
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default PlaygroundConsole;
