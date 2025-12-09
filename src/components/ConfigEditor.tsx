import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Search, Save, FolderOpen, File, Loader2, RefreshCw, ChevronRight, ChevronDown, Code, Settings2, Plus, Trash2, GripVertical, Braces, FileCode, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/i18n"

interface ConfigFileInfo {
  name: string
  path: string
  size_bytes: number
  file_type: string
  modified: string | null
}

interface ConfigEditorProps {
  instanceId: string
}

function formatSize(bytes: number): string {
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

function getFileTypeColor(type: string): string {
  switch (type) {
    case "json":
      return "text-yellow-400"
    case "toml":
      return "text-orange-400"
    case "yaml":
      return "text-green-400"
    case "properties":
      return "text-blue-400"
    default:
      return "text-gray-400"
  }
}

function FileTypeIcon({ type, className }: { type: string; className?: string }) {
  const colorClass = getFileTypeColor(type)
  const iconClass = `h-4 w-4 flex-shrink-0 ${colorClass} ${className || ""}`

  switch (type) {
    case "json":
      return <Braces className={iconClass} />
    case "toml":
      return <FileCode className={iconClass} />
    case "yaml":
      return <FileCode className={iconClass} />
    case "properties":
      return <FileText className={iconClass} />
    default:
      return <File className={iconClass} />
  }
}

// Parse config content based on file type
type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue }

// Stores comments associated with config keys (key path -> comment)
type CommentMap = Record<string, string>

interface ParsedConfigResult {
  values: ConfigValue
  comments: CommentMap
}

function parseConfig(content: string, fileType: string): ParsedConfigResult | null {
  try {
    if (fileType === "json") {
      // JSON doesn't support comments, but some tools use // comments
      const { values, comments } = parseJSONWithComments(content)
      return { values, comments }
    }
    if (fileType === "toml") {
      return parseTOML(content)
    }
    if (fileType === "yaml") {
      return parseYAML(content)
    }
    if (fileType === "properties") {
      return parseProperties(content)
    }
    return null
  } catch {
    return null
  }
}

// Parse JSON with optional // comments (non-standard but common in config files)
function parseJSONWithComments(content: string): { values: ConfigValue; comments: CommentMap } {
  const comments: CommentMap = {}
  const lines = content.split("\n")
  let pendingComment = ""

  // Try to extract inline comments and comments before keys
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const commentMatch = line.match(/^\s*\/\/\s*(.*)$/)
    if (commentMatch) {
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentMatch[1].trim()
    } else {
      // Look for key in this line
      const keyMatch = line.match(/"([^"]+)"\s*:/)
      if (keyMatch && pendingComment) {
        comments[keyMatch[1]] = pendingComment
        pendingComment = ""
      } else if (!line.trim().startsWith("{") && !line.trim().startsWith("}") && !line.trim().startsWith("[") && !line.trim().startsWith("]")) {
        pendingComment = ""
      }
    }
  }

  // Remove // comments for parsing
  const cleanedContent = content.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")

  try {
    return { values: JSON.parse(cleanedContent), comments }
  } catch {
    // If that fails, try original content
    return { values: JSON.parse(content), comments: {} }
  }
}

function stringifyConfig(value: ConfigValue, fileType: string): string {
  if (fileType === "json") {
    return JSON.stringify(value, null, 2)
  }
  if (fileType === "toml") {
    return stringifyTOML(value as Record<string, ConfigValue>)
  }
  if (fileType === "yaml") {
    return stringifyYAML(value as Record<string, ConfigValue>)
  }
  if (fileType === "properties") {
    return stringifyProperties(value as Record<string, ConfigValue>)
  }
  return JSON.stringify(value, null, 2)
}

// Simple TOML parser (handles basic cases) - now returns comments too
function parseTOML(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {}
  const comments: CommentMap = {}
  let currentSection: Record<string, ConfigValue> = result
  let currentSectionPath = ""
  const lines = content.split("\n")
  let pendingComment = ""

  for (const line of lines) {
    const trimmed = line.trim()

    // Capture comments (lines starting with #)
    if (trimmed.startsWith("#")) {
      const commentText = trimmed.slice(1).trim()
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentText
      continue
    }

    if (!trimmed) {
      // Empty line resets pending comment
      pendingComment = ""
      continue
    }

    // Section header [section.name]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      const path = sectionMatch[1].split(".")
      currentSectionPath = sectionMatch[1]
      currentSection = result
      for (const part of path) {
        if (!currentSection[part]) {
          currentSection[part] = {}
        }
        currentSection = currentSection[part] as Record<string, ConfigValue>
      }
      // Store section comment if any
      if (pendingComment) {
        comments[currentSectionPath] = pendingComment
        pendingComment = ""
      }
      continue
    }

    // Key = value (also check for inline comment after value)
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1].trim()
      let rawValue = kvMatch[2].trim()

      // Check for inline comment (# after value, but not inside strings)
      const inlineCommentMatch = rawValue.match(/^("[^"]*"|'[^']*'|[^#]*?)(?:\s*#\s*(.*))?$/)
      if (inlineCommentMatch) {
        rawValue = inlineCommentMatch[1].trim()
        if (inlineCommentMatch[2]) {
          // Inline comment takes precedence
          pendingComment = inlineCommentMatch[2].trim()
        }
      }

      currentSection[key] = parseTOMLValue(rawValue)

      // Store the comment for this key
      if (pendingComment) {
        const fullKeyPath = currentSectionPath ? `${currentSectionPath}.${key}` : key
        comments[fullKeyPath] = pendingComment
        pendingComment = ""
      }
    }
  }

  return { values: result, comments }
}

function parseTOMLValue(value: string): ConfigValue {
  // Boolean
  if (value === "true") return true
  if (value === "false") return false

  // String (quoted)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  // Array
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map((v) => parseTOMLValue(v.trim()))
  }

  // Number
  const num = parseFloat(value)
  if (!isNaN(num)) return num

  return value
}

function stringifyTOML(obj: Record<string, ConfigValue>, prefix = ""): string {
  let result = ""
  const sections: [string, Record<string, ConfigValue>][] = []

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sections.push([prefix ? `${prefix}.${key}` : key, value as Record<string, ConfigValue>])
    } else {
      result += `${key} = ${stringifyTOMLValue(value)}\n`
    }
  }

  for (const [sectionKey, sectionValue] of sections) {
    result += `\n[${sectionKey}]\n`
    result += stringifyTOML(sectionValue, sectionKey)
  }

  return result
}

function stringifyTOMLValue(value: ConfigValue): string {
  if (typeof value === "boolean") return value.toString()
  if (typeof value === "number") return value.toString()
  if (typeof value === "string") return `"${value}"`
  if (Array.isArray(value)) return `[${value.map(stringifyTOMLValue).join(", ")}]`
  if (value === null) return '""'
  return JSON.stringify(value)
}

// Properties file parser - now returns comments too
function parseProperties(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {}
  const comments: CommentMap = {}
  const lines = content.split("\n")
  let pendingComment = ""

  for (const line of lines) {
    const trimmed = line.trim()

    // Capture comments (lines starting with # or !)
    if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
      const commentText = trimmed.slice(1).trim()
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentText
      continue
    }

    if (!trimmed) {
      // Empty line resets pending comment
      pendingComment = ""
      continue
    }

    const eqIndex = trimmed.indexOf("=")
    const colonIndex = trimmed.indexOf(":")
    let sepIndex = -1

    if (eqIndex !== -1 && colonIndex !== -1) {
      sepIndex = Math.min(eqIndex, colonIndex)
    } else if (eqIndex !== -1) {
      sepIndex = eqIndex
    } else if (colonIndex !== -1) {
      sepIndex = colonIndex
    }

    if (sepIndex !== -1) {
      const key = trimmed.slice(0, sepIndex).trim()
      const value = trimmed.slice(sepIndex + 1).trim()

      // Try to parse value type
      if (value === "true") result[key] = true
      else if (value === "false") result[key] = false
      else if (!isNaN(parseFloat(value)) && isFinite(Number(value))) result[key] = parseFloat(value)
      else result[key] = value

      // Store comment for this key
      if (pendingComment) {
        comments[key] = pendingComment
        pendingComment = ""
      }
    }
  }

  return { values: result, comments }
}

function stringifyProperties(obj: Record<string, ConfigValue>): string {
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

// YAML parser - handles common YAML structures used in plugin configs
function parseYAML(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {}
  const comments: CommentMap = {}
  const lines = content.split("\n")
  let pendingComment = ""

  // Stack to track nested structure: { indent, obj, key }
  const stack: { indent: number; obj: Record<string, ConfigValue>; key: string }[] = [
    { indent: -1, obj: result, key: "" }
  ]

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) {
      pendingComment = ""
      continue
    }

    // Capture comments (lines starting with #)
    const commentOnlyMatch = line.match(/^(\s*)#\s*(.*)$/)
    if (commentOnlyMatch) {
      const commentText = commentOnlyMatch[2].trim()
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentText
      continue
    }

    // Calculate indentation (number of spaces)
    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0

    // Pop stack until we find correct parent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const currentParent = stack[stack.length - 1].obj

    // Check for key: value pattern
    const kvMatch = line.match(/^(\s*)([^:#]+?):\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[2].trim()
      let rawValue = kvMatch[3].trim()

      // Check for inline comment
      const inlineCommentMatch = rawValue.match(/^(.+?)\s+#\s*(.*)$/)
      if (inlineCommentMatch && !rawValue.startsWith('"') && !rawValue.startsWith("'")) {
        rawValue = inlineCommentMatch[1].trim()
        if (inlineCommentMatch[2]) {
          pendingComment = inlineCommentMatch[2].trim()
        }
      }

      // Store comment for this key
      if (pendingComment) {
        const fullPath = stack.slice(1).map(s => s.key).concat(key).join(".")
        comments[fullPath] = pendingComment
        pendingComment = ""
      }

      if (rawValue === "" || rawValue === "|" || rawValue === ">") {
        // This is a parent key for nested content or multiline string
        const newObj: Record<string, ConfigValue> = {}
        currentParent[key] = newObj
        stack.push({ indent, obj: newObj, key })
      } else {
        // Parse the value
        currentParent[key] = parseYAMLValue(rawValue)
      }
    } else {
      // Check for list item (- value)
      const listMatch = line.match(/^(\s*)-\s*(.*)$/)
      if (listMatch) {
        const listValue = listMatch[2].trim()
        const parentKey = stack[stack.length - 1].key

        // Get or create array in parent's parent
        const parentOfParent = stack.length > 1 ? stack[stack.length - 2].obj : result
        if (parentKey && !Array.isArray(parentOfParent[parentKey])) {
          parentOfParent[parentKey] = []
        }

        if (parentKey && Array.isArray(parentOfParent[parentKey])) {
          (parentOfParent[parentKey] as ConfigValue[]).push(parseYAMLValue(listValue))
        }
      }
    }
  }

  return { values: result, comments }
}

function parseYAMLValue(value: string): ConfigValue {
  // Null values
  if (value === "null" || value === "~" || value === "") return null

  // Boolean
  if (value === "true" || value === "yes" || value === "on") return true
  if (value === "false" || value === "no" || value === "off") return false

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  // Inline array [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map(v => parseYAMLValue(v.trim()))
  }

  // Number
  const num = parseFloat(value)
  if (!isNaN(num) && isFinite(num)) return num

  // Plain string
  return value
}

function stringifyYAML(obj: Record<string, ConfigValue>, indent: number = 0): string {
  let result = ""
  const prefix = "  ".repeat(indent)

  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      result += `${prefix}${key}: null\n`
    } else if (typeof value === "boolean") {
      result += `${prefix}${key}: ${value}\n`
    } else if (typeof value === "number") {
      result += `${prefix}${key}: ${value}\n`
    } else if (typeof value === "string") {
      // Quote strings that might be ambiguous
      const needsQuotes = value === "" ||
        value === "true" || value === "false" ||
        value === "yes" || value === "no" ||
        value === "null" || value === "~" ||
        value.includes(":") || value.includes("#") ||
        !isNaN(parseFloat(value))
      result += `${prefix}${key}: ${needsQuotes ? `"${value}"` : value}\n`
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        result += `${prefix}${key}: []\n`
      } else if (value.every(v => typeof v !== "object" || v === null)) {
        // Simple array - inline format
        result += `${prefix}${key}:\n`
        for (const item of value) {
          result += `${prefix}  - ${stringifyYAMLValue(item)}\n`
        }
      } else {
        // Complex array
        result += `${prefix}${key}:\n`
        for (const item of value) {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            const nested = stringifyYAML(item as Record<string, ConfigValue>, indent + 2)
            const lines = nested.split("\n").filter(l => l.trim())
            if (lines.length > 0) {
              result += `${prefix}  - ${lines[0].trim()}\n`
              for (let i = 1; i < lines.length; i++) {
                result += `${prefix}    ${lines[i].trim()}\n`
              }
            }
          } else {
            result += `${prefix}  - ${stringifyYAMLValue(item)}\n`
          }
        }
      }
    } else if (typeof value === "object") {
      result += `${prefix}${key}:\n`
      result += stringifyYAML(value as Record<string, ConfigValue>, indent + 1)
    }
  }

  return result
}

function stringifyYAMLValue(value: ConfigValue): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value.toString()
  if (typeof value === "number") return value.toString()
  if (typeof value === "string") {
    const needsQuotes = value === "" ||
      value === "true" || value === "false" ||
      value === "yes" || value === "no" ||
      value === "null" || value === "~" ||
      value.includes(":") || value.includes("#") ||
      !isNaN(parseFloat(value))
    return needsQuotes ? `"${value}"` : value
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringifyYAMLValue).join(", ")}]`
  }
  return String(value)
}

// Visual editor components
interface ValueEditorProps {
  keyName: string
  value: ConfigValue
  onChange: (newValue: ConfigValue) => void
  onDelete?: () => void
  depth?: number
  tooltip?: string
  comments?: CommentMap
  keyPath?: string
}

// Helper component for label with optional tooltip
function LabelWithTooltip({ htmlFor, className, children, tooltip }: {
  htmlFor?: string
  className?: string
  children: React.ReactNode
  tooltip?: string
}) {
  if (!tooltip) {
    return <Label htmlFor={htmlFor} className={className}>{children}</Label>
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Label htmlFor={htmlFor} className={`${className} cursor-help border-b border-dashed border-muted-foreground/50`}>
            {children}
          </Label>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function ValueEditor({ keyName, value, onChange, onDelete, depth = 0, tooltip, comments, keyPath }: ValueEditorProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(depth < 2)

  // Format key name for display
  const displayName = keyName.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())

  // Get tooltip from comments map or direct tooltip prop
  const currentKeyPath = keyPath || keyName
  const effectiveTooltip = tooltip || (comments && comments[currentKeyPath])

  // Boolean toggle
  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 group">
        <div className="flex items-center gap-3">
          <LabelWithTooltip htmlFor={`toggle-${keyName}`} className="text-sm font-medium cursor-pointer" tooltip={effectiveTooltip}>
            {displayName}
          </LabelWithTooltip>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`toggle-${keyName}`}
            checked={value}
            onCheckedChange={(checked) => onChange(checked)}
          />
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Number input with slider for certain ranges
  if (typeof value === "number") {
    const isInteger = Number.isInteger(value)
    const showSlider = value >= 0 && value <= 1000

    return (
      <div className="py-2 px-3 rounded-lg hover:bg-muted/50 group">
        <div className="flex items-center justify-between mb-2">
          <LabelWithTooltip className="text-sm font-medium" tooltip={effectiveTooltip}>{displayName}</LabelWithTooltip>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={value}
              onChange={(e) => {
                const newVal = isInteger ? parseInt(e.target.value) : parseFloat(e.target.value)
                if (!isNaN(newVal)) onChange(newVal)
              }}
              className="w-24 h-8 text-sm"
              step={isInteger ? 1 : 0.1}
            />
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={onDelete}
              >
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
    )
  }

  // String input
  if (typeof value === "string") {
    const isLongText = value.length > 50 || value.includes("\n")

    return (
      <div className="py-2 px-3 rounded-lg hover:bg-muted/50 group">
        <div className="flex items-center justify-between mb-1">
          <LabelWithTooltip className="text-sm font-medium" tooltip={effectiveTooltip}>{displayName}</LabelWithTooltip>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
        {isLongText ? (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-sm min-h-[80px]"
          />
        ) : (
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-8 text-sm"
          />
        )}
      </div>
    )
  }

  // Array editor
  if (Array.isArray(value)) {
    return (
      <div className="py-2 px-3 rounded-lg border bg-muted/30">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm font-medium hover:text-primary"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {displayName}
            <Badge variant="secondary" className="text-xs">
              {value.length} items
            </Badge>
          </button>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      const defaultValue = value.length > 0 ? getDefaultValue(value[0]) : ""
                      onChange([...value, defaultValue])
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ajouter un element</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-1 ml-4 border-l pl-3">
            {value.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                <div className="flex-1">
                  <ValueEditor
                    keyName={`${index}`}
                    value={item}
                    onChange={(newVal) => {
                      const newArray = [...value]
                      newArray[index] = newVal
                      onChange(newArray)
                    }}
                    onDelete={() => {
                      const newArray = value.filter((_, i) => i !== index)
                      onChange(newArray)
                    }}
                    depth={depth + 1}
                    comments={comments}
                    keyPath={currentKeyPath ? `${currentKeyPath}[${index}]` : `[${index}]`}
                  />
                </div>
              </div>
            ))}
            {value.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                {t("configEditor.noElement")}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Object editor
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)

    return (
      <div className="py-2 px-3 rounded-lg border bg-muted/30">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm font-medium hover:text-primary"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {displayName}
            <Badge variant="secondary" className="text-xs">
              {entries.length} props
            </Badge>
          </button>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>

        {isExpanded && (
          <div className="space-y-1 ml-4 border-l pl-3">
            {entries.map(([key, val]) => {
              const childKeyPath = currentKeyPath ? `${currentKeyPath}.${key}` : key
              return (
                <ValueEditor
                  key={key}
                  keyName={key}
                  value={val}
                  onChange={(newVal) => {
                    onChange({ ...value, [key]: newVal })
                  }}
                  onDelete={() => {
                    const newObj = { ...value }
                    delete newObj[key]
                    onChange(newObj)
                  }}
                  depth={depth + 1}
                  comments={comments}
                  keyPath={childKeyPath}
                />
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Null value
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
      <LabelWithTooltip className="text-sm font-medium" tooltip={effectiveTooltip}>{displayName}</LabelWithTooltip>
      <div className="flex items-center gap-2">
        <Badge variant="outline">null</Badge>
        {onDelete && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  )
}

function getDefaultValue(example: ConfigValue): ConfigValue {
  if (typeof example === "boolean") return false
  if (typeof example === "number") return 0
  if (typeof example === "string") return ""
  if (Array.isArray(example)) return []
  if (example !== null && typeof example === "object") return {}
  return ""
}

// Visual config editor main component
interface VisualConfigEditorProps {
  content: string
  fileType: string
  onChange: (newContent: string) => void
}

function VisualConfigEditor({ content, fileType, onChange }: VisualConfigEditorProps) {
  const { t } = useTranslation()
  const [parsedConfig, setParsedConfig] = useState<ConfigValue | null>(null)
  const [configComments, setConfigComments] = useState<CommentMap>({})
  const [parseError, setParseError] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState("")

  useEffect(() => {
    const parsed = parseConfig(content, fileType)
    if (parsed !== null) {
      setParsedConfig(parsed.values)
      setConfigComments(parsed.comments)
      setParseError(null)
    } else {
      setParseError(t("configEditor.unableToParseVisual"))
    }
  }, [content, fileType])

  const handleConfigChange = useCallback(
    (newConfig: ConfigValue) => {
      setParsedConfig(newConfig)
      const newContent = stringifyConfig(newConfig, fileType)
      onChange(newContent)
    },
    [fileType, onChange]
  )

  if (parseError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Settings2 className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{parseError}</p>
        <p className="text-sm text-muted-foreground mt-2">
          {t("configEditor.visualOnlyJson")}
        </p>
      </div>
    )
  }

  if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Settings2 className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{t("configEditor.unsupportedStructure")}</p>
      </div>
    )
  }

  // Filter entries by search
  const filterEntries = (obj: Record<string, ConfigValue>, filter: string): Record<string, ConfigValue> => {
    if (!filter) return obj
    const lowerFilter = filter.toLowerCase()
    const result: Record<string, ConfigValue> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes(lowerFilter)) {
        result[key] = value
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const filtered = filterEntries(value as Record<string, ConfigValue>, filter)
        if (Object.keys(filtered).length > 0) {
          result[key] = filtered
        }
      }
    }

    return result
  }

  const filteredConfig = filterEntries(parsedConfig, searchFilter)

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("configEditor.filterOptions")}
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-2">
          {Object.entries(filteredConfig).map(([key, value]) => (
            <ValueEditor
              key={key}
              keyName={key}
              value={value}
              onChange={(newVal) => {
                handleConfigChange({ ...parsedConfig, [key]: newVal })
              }}
              onDelete={() => {
                const newConfig = { ...parsedConfig }
                delete newConfig[key]
                handleConfigChange(newConfig)
              }}
              comments={configComments}
              keyPath={key}
            />
          ))}
          {Object.keys(filteredConfig).length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              {searchFilter ? t("configEditor.noResultFilter") : t("configEditor.emptyConfig")}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// Group files by folder
interface FolderNode {
  name: string
  files: ConfigFileInfo[]
  subfolders: Map<string, FolderNode>
}

function buildFolderTree(files: ConfigFileInfo[]): FolderNode {
  const root: FolderNode = { name: "", files: [], subfolders: new Map() }

  for (const file of files) {
    const parts = file.path.split("/")
    let current = root

    // Navigate/create folder path
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i]
      if (!current.subfolders.has(folderName)) {
        current.subfolders.set(folderName, {
          name: folderName,
          files: [],
          subfolders: new Map(),
        })
      }
      current = current.subfolders.get(folderName)!
    }

    current.files.push(file)
  }

  return root
}

interface FolderViewProps {
  node: FolderNode
  depth: number
  onFileSelect: (file: ConfigFileInfo) => void
  selectedPath: string | null
  searchQuery: string
}

function FolderView({ node, depth, onFileSelect, selectedPath, searchQuery }: FolderViewProps) {
  const [isExpanded, setIsExpanded] = useState(depth === 0 || searchQuery.length > 0)

  // Filter files by search query
  const filteredFiles = node.files.filter(
    (f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Check if any subfolder has matching files
  const hasMatchingContent = (n: FolderNode): boolean => {
    if (n.files.some((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    )) {
      return true
    }
    for (const subfolder of n.subfolders.values()) {
      if (hasMatchingContent(subfolder)) return true
    }
    return false
  }

  const subfolders = Array.from(node.subfolders.values()).filter(
    (sf) => searchQuery.length === 0 || hasMatchingContent(sf)
  )

  if (filteredFiles.length === 0 && subfolders.length === 0 && depth > 0) {
    return null
  }

  return (
    <div className={depth > 0 ? "ml-3" : ""}>
      {depth > 0 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 w-full py-1 px-2 rounded hover:bg-muted text-left text-sm font-medium"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>{node.name}</span>
        </button>
      )}

      {(isExpanded || depth === 0) && (
        <div className={depth > 0 ? "ml-4 border-l border-border pl-2" : ""}>
          {/* Subfolders first */}
          {subfolders.map((subfolder) => (
            <FolderView
              key={subfolder.name}
              node={subfolder}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              searchQuery={searchQuery}
            />
          ))}

          {/* Then files */}
          {filteredFiles.map((file) => (
            <button
              key={file.path}
              onClick={() => onFileSelect(file)}
              className={`flex items-center gap-2 w-full py-1.5 px-2 rounded text-left text-sm ${
                selectedPath === file.path
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              <FileTypeIcon type={file.file_type} />
              <span className="flex-1 truncate">{file.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ConfigEditor({ instanceId }: ConfigEditorProps) {
  const { t } = useTranslation()
  const [configFiles, setConfigFiles] = useState<ConfigFileInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")

  // Editor state
  const [selectedFile, setSelectedFile] = useState<ConfigFileInfo | null>(null)
  const [fileContent, setFileContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Unsaved changes dialog
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingFile, setPendingFile] = useState<ConfigFileInfo | null>(null)

  // Editor mode (text or visual)
  const [editorMode, setEditorMode] = useState<"visual" | "text">("visual")

  // Check if visual mode is supported for this file type
  const supportsVisualMode = selectedFile && ["json", "toml", "yaml", "properties"].includes(selectedFile.file_type)

  const loadConfigFiles = useCallback(async () => {
    setIsLoading(true)
    try {
      const files = await invoke<ConfigFileInfo[]>("get_instance_config_files", {
        instanceId,
      })
      setConfigFiles(files)
    } catch (err) {
      console.error("Failed to load config files:", err)
    } finally {
      setIsLoading(false)
    }
  }, [instanceId])

  useEffect(() => {
    loadConfigFiles()
  }, [loadConfigFiles])

  useEffect(() => {
    setHasUnsavedChanges(fileContent !== originalContent)
  }, [fileContent, originalContent])

  const loadFileContent = async (file: ConfigFileInfo) => {
    setIsLoadingContent(true)
    try {
      const content = await invoke<string>("read_config_file", {
        instanceId,
        configPath: file.path,
      })
      setFileContent(content)
      setOriginalContent(content)
      setSelectedFile(file)
    } catch (err) {
      console.error("Failed to load config file:", err)
      toast.error(`${t("config.loadError")}: ${err}`)
    } finally {
      setIsLoadingContent(false)
    }
  }

  const handleFileSelect = (file: ConfigFileInfo) => {
    if (hasUnsavedChanges) {
      setPendingFile(file)
      setShowUnsavedDialog(true)
    } else {
      loadFileContent(file)
    }
  }

  const handleSave = async () => {
    if (!selectedFile) return

    setIsSaving(true)
    try {
      await invoke("save_config_file", {
        instanceId,
        configPath: selectedFile.path,
        content: fileContent,
      })
      setOriginalContent(fileContent)
      setHasUnsavedChanges(false)
      toast.success(t("configEditor.configSaved"))
    } catch (err) {
      console.error("Failed to save config file:", err)
      toast.error(`${t("config.saveError")}: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDiscardChanges = () => {
    setShowUnsavedDialog(false)
    if (pendingFile) {
      loadFileContent(pendingFile)
      setPendingFile(null)
    }
  }

  const handleOpenFolder = async () => {
    try {
      await invoke("open_config_folder", { instanceId })
    } catch (err) {
      console.error("Failed to open config folder:", err)
    }
  }

  const folderTree = buildFolderTree(configFiles)

  return (
    <div className="flex h-[500px] gap-4">
      {/* File tree sidebar */}
      <div className="w-72 flex-shrink-0 border rounded-lg overflow-hidden flex flex-col">
        <div className="p-2 border-b bg-muted/50">
          <div className="flex gap-2 mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("configEditor.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadConfigFiles}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleOpenFolder}>
            <FolderOpen className="h-4 w-4" />
            {t("configEditor.openFolder")}
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : configFiles.length === 0 ? (
            <div className="text-center py-8 px-4">
              <File className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">{t("configEditor.noConfigFile")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("configEditor.launchGameForConfig")}
              </p>
            </div>
          ) : (
            <div className="p-2">
              <FolderView
                node={folderTree}
                depth={0}
                onFileSelect={handleFileSelect}
                selectedPath={selectedFile?.path ?? null}
                searchQuery={searchQuery}
              />
            </div>
          )}
        </ScrollArea>

        <div className="p-2 border-t bg-muted/50 text-xs text-muted-foreground text-center">
          {configFiles.length} {t("configEditor.files")}
        </div>
      </div>

      {/* Editor panel */}
      <div className="flex-1 border rounded-lg overflow-hidden flex flex-col">
        {selectedFile ? (
          <>
            <div className="p-3 border-b bg-muted/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileTypeIcon type={selectedFile.file_type} />
                <span className="font-medium text-sm truncate max-w-[200px]">{selectedFile.path}</span>
                {hasUnsavedChanges && (
                  <Badge variant="secondary" className="text-xs">
                    {t("configEditor.notSaved")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {supportsVisualMode && (
                  <div className="flex items-center border rounded-md">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={editorMode === "visual" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2 rounded-r-none"
                            onClick={() => setEditorMode("visual")}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("configEditor.visualMode")}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={editorMode === "text" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2 rounded-l-none"
                            onClick={() => setEditorMode("text")}
                          >
                            <Code className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("configEditor.textMode")}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatSize(selectedFile.size_bytes)}
                </span>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving || !hasUnsavedChanges}
                  className="gap-1"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("configEditor.saveBtn")}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {isLoadingContent ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : editorMode === "visual" && supportsVisualMode ? (
                <VisualConfigEditor
                  content={fileContent}
                  fileType={selectedFile.file_type}
                  onChange={setFileContent}
                />
              ) : (
                <Textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <File className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t("configEditor.selectFileToEdit")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("configEditor.supportedFiles")}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Unsaved changes dialog */}
      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("configEditor.unsavedChangesTitle")}</DialogTitle>
            <DialogDescription>
              {t("configEditor.unsavedChangesDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnsavedDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDiscardChanges}>
              {t("configEditor.discardChanges")}
            </Button>
            <Button
              onClick={async () => {
                await handleSave()
                setShowUnsavedDialog(false)
                if (pendingFile) {
                  loadFileContent(pendingFile)
                  setPendingFile(null)
                }
              }}
            >
              {t("configEditor.saveAndContinue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
