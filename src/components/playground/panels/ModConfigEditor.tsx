import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Save,
  RotateCcw,
  FileText,
  Loader2,
  FolderOpen,
  AlertCircle,
  Code,
  Settings2,
  Search,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { ModInfoWithDependencies } from "@/types/playground";

interface ConfigFile {
  path: string;
  name: string;
}

interface ModConfigEditorProps {
  mod: ModInfoWithDependencies;
}

// Config value types
type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };
type CommentMap = Record<string, string>;

interface ParsedConfigResult {
  values: ConfigValue;
  comments: CommentMap;
}

// Detect file type from extension
function getFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "json" || ext === "json5") return "json";
  if (ext === "toml") return "toml";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "properties" || ext === "cfg") return "properties";
  return "text";
}

// Parse config content
function parseConfig(content: string, fileType: string): ParsedConfigResult | null {
  try {
    if (fileType === "json") return parseJSON(content);
    if (fileType === "toml") return parseTOML(content);
    if (fileType === "yaml") return parseYAML(content);
    if (fileType === "properties") return parseProperties(content);
    return null;
  } catch {
    return null;
  }
}

function parseJSON(content: string): ParsedConfigResult {
  const comments: CommentMap = {};
  // Remove // comments for parsing (non-standard but common)
  const cleanedContent = content.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
  try {
    return { values: JSON.parse(cleanedContent), comments };
  } catch {
    return { values: JSON.parse(content), comments: {} };
  }
}

function parseTOML(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {};
  const comments: CommentMap = {};
  let currentSection: Record<string, ConfigValue> = result;
  let currentSectionPath = "";
  const lines = content.split("\n");
  let pendingComment = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) {
      pendingComment = (pendingComment ? pendingComment + " " : "") + trimmed.slice(1).trim();
      continue;
    }

    if (!trimmed) {
      pendingComment = "";
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const path = sectionMatch[1].split(".");
      currentSectionPath = sectionMatch[1];
      currentSection = result;
      for (const part of path) {
        if (!currentSection[part]) currentSection[part] = {};
        currentSection = currentSection[part] as Record<string, ConfigValue>;
      }
      if (pendingComment) {
        comments[currentSectionPath] = pendingComment;
        pendingComment = "";
      }
      continue;
    }

    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let rawValue = kvMatch[2].trim();

      const inlineCommentMatch = rawValue.match(/^("[^"]*"|'[^']*'|[^#]*?)(?:\s*#\s*(.*))?$/);
      if (inlineCommentMatch) {
        rawValue = inlineCommentMatch[1].trim();
        if (inlineCommentMatch[2]) pendingComment = inlineCommentMatch[2].trim();
      }

      currentSection[key] = parseTOMLValue(rawValue);

      if (pendingComment) {
        const fullKeyPath = currentSectionPath ? `${currentSectionPath}.${key}` : key;
        comments[fullKeyPath] = pendingComment;
        pendingComment = "";
      }
    }
  }

  return { values: result, comments };
}

function parseTOMLValue(value: string): ConfigValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((v) => parseTOMLValue(v.trim()));
  }
  const num = parseFloat(value);
  if (!isNaN(num)) return num;
  return value;
}

function parseYAML(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {};
  const comments: CommentMap = {};
  const lines = content.split("\n");
  let pendingComment = "";
  const stack: { indent: number; obj: Record<string, ConfigValue>; key: string }[] = [
    { indent: -1, obj: result, key: "" }
  ];

  for (const line of lines) {
    if (!line.trim()) {
      pendingComment = "";
      continue;
    }

    const commentOnlyMatch = line.match(/^(\s*)#\s*(.*)$/);
    if (commentOnlyMatch) {
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentOnlyMatch[2].trim();
      continue;
    }

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const currentParent = stack[stack.length - 1].obj;

    const kvMatch = line.match(/^(\s*)([^:#]+?):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[2].trim();
      let rawValue = kvMatch[3].trim();

      const inlineCommentMatch = rawValue.match(/^(.+?)\s+#\s*(.*)$/);
      if (inlineCommentMatch && !rawValue.startsWith('"') && !rawValue.startsWith("'")) {
        rawValue = inlineCommentMatch[1].trim();
        if (inlineCommentMatch[2]) pendingComment = inlineCommentMatch[2].trim();
      }

      if (pendingComment) {
        const fullPath = stack.slice(1).map(s => s.key).concat(key).join(".");
        comments[fullPath] = pendingComment;
        pendingComment = "";
      }

      if (rawValue === "" || rawValue === "|" || rawValue === ">") {
        const newObj: Record<string, ConfigValue> = {};
        currentParent[key] = newObj;
        stack.push({ indent, obj: newObj, key });
      } else {
        currentParent[key] = parseYAMLValue(rawValue);
      }
    }
  }

  return { values: result, comments };
}

function parseYAMLValue(value: string): ConfigValue {
  if (value === "null" || value === "~" || value === "") return null;
  if (value === "true" || value === "yes" || value === "on") return true;
  if (value === "false" || value === "no" || value === "off") return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map(v => parseYAMLValue(v.trim()));
  }
  const num = parseFloat(value);
  if (!isNaN(num) && isFinite(num)) return num;
  return value;
}

function parseProperties(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {};
  const comments: CommentMap = {};
  const lines = content.split("\n");
  let pendingComment = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
      pendingComment = (pendingComment ? pendingComment + " " : "") + trimmed.slice(1).trim();
      continue;
    }

    if (!trimmed) {
      pendingComment = "";
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    const colonIndex = trimmed.indexOf(":");
    let sepIndex = -1;

    if (eqIndex !== -1 && colonIndex !== -1) {
      sepIndex = Math.min(eqIndex, colonIndex);
    } else if (eqIndex !== -1) {
      sepIndex = eqIndex;
    } else if (colonIndex !== -1) {
      sepIndex = colonIndex;
    }

    if (sepIndex !== -1) {
      const key = trimmed.slice(0, sepIndex).trim();
      const value = trimmed.slice(sepIndex + 1).trim();

      if (value === "true") result[key] = true;
      else if (value === "false") result[key] = false;
      else if (!isNaN(parseFloat(value)) && isFinite(Number(value))) result[key] = parseFloat(value);
      else result[key] = value;

      if (pendingComment) {
        comments[key] = pendingComment;
        pendingComment = "";
      }
    }
  }

  return { values: result, comments };
}

// Stringify functions
function stringifyConfig(value: ConfigValue, fileType: string): string {
  if (fileType === "json") return JSON.stringify(value, null, 2);
  if (fileType === "toml") return stringifyTOML(value as Record<string, ConfigValue>);
  if (fileType === "yaml") return stringifyYAML(value as Record<string, ConfigValue>);
  if (fileType === "properties") return stringifyProperties(value as Record<string, ConfigValue>);
  return JSON.stringify(value, null, 2);
}

function stringifyTOML(obj: Record<string, ConfigValue>, prefix = ""): string {
  let result = "";
  const sections: [string, Record<string, ConfigValue>][] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sections.push([prefix ? `${prefix}.${key}` : key, value as Record<string, ConfigValue>]);
    } else {
      result += `${key} = ${stringifyTOMLValue(value)}\n`;
    }
  }

  for (const [sectionKey, sectionValue] of sections) {
    result += `\n[${sectionKey}]\n`;
    result += stringifyTOML(sectionValue, sectionKey);
  }

  return result;
}

function stringifyTOMLValue(value: ConfigValue): string {
  if (typeof value === "boolean") return value.toString();
  if (typeof value === "number") return value.toString();
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) return `[${value.map(stringifyTOMLValue).join(", ")}]`;
  if (value === null) return '""';
  return JSON.stringify(value);
}

function stringifyYAML(obj: Record<string, ConfigValue>, indent = 0): string {
  let result = "";
  const prefix = "  ".repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      result += `${prefix}${key}: null\n`;
    } else if (typeof value === "boolean" || typeof value === "number") {
      result += `${prefix}${key}: ${value}\n`;
    } else if (typeof value === "string") {
      const needsQuotes = value === "" || ["true", "false", "yes", "no", "null", "~"].includes(value) ||
        value.includes(":") || value.includes("#") || !isNaN(parseFloat(value));
      result += `${prefix}${key}: ${needsQuotes ? `"${value}"` : value}\n`;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        result += `${prefix}${key}: []\n`;
      } else {
        result += `${prefix}${key}:\n`;
        for (const item of value) {
          result += `${prefix}  - ${typeof item === "object" && item !== null ? "\n" + stringifyYAML(item as Record<string, ConfigValue>, indent + 2) : item}\n`;
        }
      }
    } else if (typeof value === "object") {
      result += `${prefix}${key}:\n`;
      result += stringifyYAML(value as Record<string, ConfigValue>, indent + 1);
    }
  }

  return result;
}

function stringifyProperties(obj: Record<string, ConfigValue>): string {
  return Object.entries(obj).map(([key, value]) => `${key}=${value}`).join("\n");
}

// Value Editor Component
interface ValueEditorProps {
  keyName: string;
  value: ConfigValue;
  onChange: (newValue: ConfigValue) => void;
  onDelete?: () => void;
  depth?: number;
  comments?: CommentMap;
  keyPath?: string;
}

function LabelWithTooltip({ className, children, tooltip }: {
  className?: string;
  children: React.ReactNode;
  tooltip?: string;
}) {
  if (!tooltip) {
    return <Label className={className}>{children}</Label>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Label className={`${className} cursor-help border-b border-dashed border-muted-foreground/50`}>
            {children}
          </Label>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ValueEditor({ keyName, value, onChange, onDelete, depth = 0, comments, keyPath }: ValueEditorProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const displayName = keyName.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
  const currentKeyPath = keyPath || keyName;
  const tooltip = comments?.[currentKeyPath];

  // Boolean
  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 group">
        <LabelWithTooltip className="text-xs font-medium cursor-pointer" tooltip={tooltip}>
          {displayName}
        </LabelWithTooltip>
        <div className="flex items-center gap-2">
          <Switch checked={value} onCheckedChange={onChange} className="scale-75" />
          {onDelete && (
            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onDelete}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Number
  if (typeof value === "number") {
    const isInteger = Number.isInteger(value);
    const showSlider = value >= 0 && value <= 1000;

    return (
      <div className="py-1.5 px-2 rounded hover:bg-muted/50 group">
        <div className="flex items-center justify-between mb-1">
          <LabelWithTooltip className="text-xs font-medium" tooltip={tooltip}>{displayName}</LabelWithTooltip>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={value}
              onChange={(e) => {
                const newVal = isInteger ? parseInt(e.target.value) : parseFloat(e.target.value);
                if (!isNaN(newVal)) onChange(newVal);
              }}
              className="w-20 h-6 text-xs"
              step={isInteger ? 1 : 0.1}
            />
            {onDelete && (
              <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onDelete}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>
        {showSlider && (
          <Slider
            value={[value]}
            onValueChange={(vals) => onChange(isInteger ? Math.round(vals[0]) : vals[0])}
            max={Math.max(100, value * 2)}
            step={isInteger ? 1 : 0.1}
            className="w-full"
          />
        )}
      </div>
    );
  }

  // String
  if (typeof value === "string") {
    const isLongText = value.length > 50 || value.includes("\n");

    return (
      <div className="py-1.5 px-2 rounded hover:bg-muted/50 group">
        <div className="flex items-center justify-between mb-1">
          <LabelWithTooltip className="text-xs font-medium" tooltip={tooltip}>{displayName}</LabelWithTooltip>
          {onDelete && (
            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onDelete}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
        {isLongText ? (
          <Textarea value={value} onChange={(e) => onChange(e.target.value)} className="w-full text-xs min-h-[60px]" />
        ) : (
          <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-6 text-xs" />
        )}
      </div>
    );
  }

  // Array
  if (Array.isArray(value)) {
    return (
      <div className="py-1.5 px-2 rounded border bg-muted/30">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-1 text-xs font-medium hover:text-primary">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {displayName}
            <Badge variant="secondary" className="text-[10px] h-4 px-1">{value.length}</Badge>
          </button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => {
                const defaultValue = value.length > 0 ? (typeof value[0] === "boolean" ? false : typeof value[0] === "number" ? 0 : "") : "";
                onChange([...value, defaultValue]);
              }}
            >
              <Plus className="h-3 w-3" />
            </Button>
            {onDelete && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDelete}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="space-y-0.5 ml-3 border-l pl-2">
            {value.map((item, index) => (
              <div key={index} className="flex items-center gap-1">
                <GripVertical className="h-3 w-3 text-muted-foreground" />
                <div className="flex-1">
                  <ValueEditor
                    keyName={`${index}`}
                    value={item}
                    onChange={(newVal) => {
                      const newArray = [...value];
                      newArray[index] = newVal;
                      onChange(newArray);
                    }}
                    onDelete={() => onChange(value.filter((_, i) => i !== index))}
                    depth={depth + 1}
                    comments={comments}
                    keyPath={`${currentKeyPath}[${index}]`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Object
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);

    return (
      <div className="py-1.5 px-2 rounded border bg-muted/30">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-1 text-xs font-medium hover:text-primary">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {displayName}
            <Badge variant="secondary" className="text-[10px] h-4 px-1">{entries.length}</Badge>
          </button>
          {onDelete && (
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDelete}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
        {isExpanded && (
          <div className="space-y-0.5 ml-3 border-l pl-2">
            {entries.map(([key, val]) => (
              <ValueEditor
                key={key}
                keyName={key}
                value={val}
                onChange={(newVal) => onChange({ ...value, [key]: newVal })}
                onDelete={() => {
                  const newObj = { ...value };
                  delete newObj[key];
                  onChange(newObj);
                }}
                depth={depth + 1}
                comments={comments}
                keyPath={`${currentKeyPath}.${key}`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Null
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
      <LabelWithTooltip className="text-xs font-medium" tooltip={tooltip}>{displayName}</LabelWithTooltip>
      <Badge variant="outline" className="text-[10px]">null</Badge>
    </div>
  );
}

// Visual Config Editor
interface VisualConfigEditorProps {
  content: string;
  fileType: string;
  onChange: (newContent: string) => void;
}

function VisualConfigEditor({ content, fileType, onChange }: VisualConfigEditorProps) {
  const [parsedConfig, setParsedConfig] = useState<ConfigValue | null>(null);
  const [configComments, setConfigComments] = useState<CommentMap>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  useEffect(() => {
    const parsed = parseConfig(content, fileType);
    if (parsed !== null) {
      setParsedConfig(parsed.values);
      setConfigComments(parsed.comments);
      setParseError(null);
    } else {
      setParseError("Unable to parse config for visual editing");
    }
  }, [content, fileType]);

  const handleConfigChange = useCallback(
    (newConfig: ConfigValue) => {
      setParsedConfig(newConfig);
      const newContent = stringifyConfig(newConfig, fileType);
      onChange(newContent);
    },
    [fileType, onChange]
  );

  const filteredConfig = useMemo(() => {
    if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) return null;
    if (!searchFilter) return parsedConfig;

    const lowerFilter = searchFilter.toLowerCase();
    const filterEntries = (obj: Record<string, ConfigValue>): Record<string, ConfigValue> => {
      const result: Record<string, ConfigValue> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key.toLowerCase().includes(lowerFilter)) {
          result[key] = value;
        } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          const filtered = filterEntries(value as Record<string, ConfigValue>);
          if (Object.keys(filtered).length > 0) result[key] = filtered;
        }
      }
      return result;
    };

    return filterEntries(parsedConfig);
  }, [parsedConfig, searchFilter]);

  if (parseError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <Settings2 className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">{parseError}</p>
        <p className="text-xs text-muted-foreground mt-1">Use text mode instead</p>
      </div>
    );
  }

  if (!filteredConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <Settings2 className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">Unsupported config structure</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Filter options..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {Object.entries(filteredConfig).map(([key, value]) => (
            <ValueEditor
              key={key}
              keyName={key}
              value={value}
              onChange={(newVal) => {
                if (parsedConfig && typeof parsedConfig === "object" && !Array.isArray(parsedConfig)) {
                  handleConfigChange({ ...parsedConfig, [key]: newVal });
                }
              }}
              onDelete={() => {
                if (parsedConfig && typeof parsedConfig === "object" && !Array.isArray(parsedConfig)) {
                  const newConfig = { ...parsedConfig };
                  delete newConfig[key];
                  handleConfigChange(newConfig);
                }
              }}
              comments={configComments}
              keyPath={key}
            />
          ))}
          {Object.keys(filteredConfig).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">
              {searchFilter ? "No matching options" : "Empty config"}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function ModConfigEditor({ mod }: ModConfigEditorProps) {
  const instanceId = usePlaygroundStore((s) => s.instanceId);

  const [configFiles, setConfigFiles] = useState<ConfigFile[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"visual" | "text">("visual");

  const hasChanges = content !== originalContent;
  const selectedFileName = selectedConfig?.split("/").pop() || "";
  const fileType = getFileType(selectedFileName);
  const supportsVisualMode = ["json", "toml", "yaml", "properties"].includes(fileType);

  // Load config files for this mod
  useEffect(() => {
    const loadConfigFiles = async () => {
      if (!instanceId) return;

      setIsLoading(true);
      setError(null);

      try {
        const files = await invoke<ConfigFile[]>("get_instance_config_files", { instanceId });

        const modNameLower = mod.name.toLowerCase().replace(/\s+/g, "");
        const modFilenameBase = mod.filename.replace(/\.(jar|disabled)$/i, "").toLowerCase();

        const relevantFiles = files.filter((file) => {
          const pathLower = file.path.toLowerCase();
          const nameLower = file.name.toLowerCase();
          return (
            pathLower.includes(modNameLower) ||
            pathLower.includes(modFilenameBase) ||
            nameLower.includes(modNameLower) ||
            nameLower.includes(modFilenameBase)
          );
        });

        setConfigFiles(relevantFiles);

        if (relevantFiles.length > 0 && !selectedConfig) {
          setSelectedConfig(relevantFiles[0].path);
        } else if (relevantFiles.length === 0) {
          setSelectedConfig(null);
          setContent("");
          setOriginalContent("");
        }
      } catch (err) {
        console.error("[ModConfigEditor] Failed to load config files:", err);
        setError("Failed to load config files");
      } finally {
        setIsLoading(false);
      }
    };

    loadConfigFiles();
  }, [instanceId, mod.name, mod.filename]);

  // Load selected config content
  useEffect(() => {
    const loadContent = async () => {
      if (!instanceId || !selectedConfig) return;

      setIsLoading(true);
      setError(null);

      try {
        const fileContent = await invoke<string>("read_config_file", {
          instanceId,
          configPath: selectedConfig,
        });

        setContent(fileContent);
        setOriginalContent(fileContent);
      } catch (err) {
        console.error("[ModConfigEditor] Failed to read config:", err);
        setError("Failed to read config file");
        setContent("");
        setOriginalContent("");
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [instanceId, selectedConfig]);

  const handleSave = useCallback(async () => {
    if (!instanceId || !selectedConfig || !hasChanges) return;

    setIsSaving(true);
    try {
      await invoke("save_config_file", {
        instanceId,
        configPath: selectedConfig,
        content,
      });
      setOriginalContent(content);
      toast.success("Config saved");
    } catch (err) {
      console.error("[ModConfigEditor] Failed to save config:", err);
      toast.error("Failed to save config");
    } finally {
      setIsSaving(false);
    }
  }, [instanceId, selectedConfig, content, hasChanges]);

  const handleReset = useCallback(() => {
    setContent(originalContent);
  }, [originalContent]);

  const handleOpenFolder = useCallback(async () => {
    if (!instanceId) return;
    try {
      await invoke("open_instance_config_folder", { instanceId });
    } catch {
      await invoke("open_mods_folder", { instanceId });
    }
  }, [instanceId]);

  // Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && hasChanges) {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, hasChanges]);

  if (isLoading && configFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (configFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4 space-y-3">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">No config files found</p>
          <p className="text-xs text-muted-foreground mt-1">
            This mod may not have config files yet. Launch the game once to generate them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleOpenFolder} className="gap-1.5">
          <FolderOpen className="h-4 w-4" />
          Open Config Folder
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 p-2 border-b flex items-center gap-2">
        <Select value={selectedConfig || ""} onValueChange={setSelectedConfig}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue placeholder="Select config file" />
          </SelectTrigger>
          <SelectContent>
            {configFiles.map((file) => (
              <SelectItem key={file.path} value={file.path} className="text-xs">
                {file.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {supportsVisualMode && (
          <div className="flex items-center border rounded">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={editorMode === "visual" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 w-6 p-0 rounded-r-none"
                    onClick={() => setEditorMode("visual")}
                  >
                    <Settings2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Visual mode</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={editorMode === "text" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 w-6 p-0 rounded-l-none"
                    onClick={() => setEditorMode("text")}
                  >
                    <Code className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Text mode</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {hasChanges && (
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-amber-500/20 text-amber-600">
            Unsaved
          </Badge>
        )}

        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleReset} disabled={!hasChanges}>
          <RotateCcw className="h-3 w-3" />
        </Button>

        <Button
          variant="default"
          size="sm"
          className="h-6 gap-1 text-xs px-2"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4 space-y-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : editorMode === "visual" && supportsVisualMode ? (
          <VisualConfigEditor content={content} fileType={fileType} onChange={setContent} />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
            placeholder="Config content..."
          />
        )}
      </div>
    </div>
  );
}

export default ModConfigEditor;
