import { useState, useEffect, useCallback } from "react"
import { Search, ChevronRight, ChevronDown, Settings2, Plus, Trash2, GripVertical } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/i18n"

// Get file type from path
export function getFileTypeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || ""
  if (ext === "json" || ext === "json5") return "json"
  if (ext === "toml") return "toml"
  if (ext === "yml" || ext === "yaml") return "yaml"
  if (ext === "properties") return "properties"
  return "text"
}

// Check if visual mode is supported
export function supportsVisualMode(fileType: string): boolean {
  return ["json", "toml", "yaml", "properties"].includes(fileType)
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

// Parse JSON with optional // comments
function parseJSONWithComments(content: string): { values: ConfigValue; comments: CommentMap } {
  const comments: CommentMap = {}
  const lines = content.split("\n")
  let pendingComment = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const commentMatch = line.match(/^\s*\/\/\s*(.*)$/)
    if (commentMatch) {
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentMatch[1].trim()
    } else {
      const keyMatch = line.match(/"([^"]+)"\s*:/)
      if (keyMatch && pendingComment) {
        comments[keyMatch[1]] = pendingComment
        pendingComment = ""
      } else if (!line.trim().startsWith("{") && !line.trim().startsWith("}") && !line.trim().startsWith("[") && !line.trim().startsWith("]")) {
        pendingComment = ""
      }
    }
  }

  const cleanedContent = content.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")

  try {
    return { values: JSON.parse(cleanedContent), comments }
  } catch {
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

// TOML parser
function parseTOML(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {}
  const comments: CommentMap = {}
  let currentSection: Record<string, ConfigValue> = result
  let currentSectionPath = ""
  const lines = content.split("\n")
  let pendingComment = ""

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("#")) {
      const commentText = trimmed.slice(1).trim()
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentText
      continue
    }

    if (!trimmed) {
      pendingComment = ""
      continue
    }

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
      if (pendingComment) {
        comments[currentSectionPath] = pendingComment
        pendingComment = ""
      }
      continue
    }

    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1].trim()
      let rawValue = kvMatch[2].trim()

      const inlineCommentMatch = rawValue.match(/^("[^"]*"|'[^']*'|[^#]*?)(?:\s*#\s*(.*))?$/)
      if (inlineCommentMatch) {
        rawValue = inlineCommentMatch[1].trim()
        if (inlineCommentMatch[2]) {
          pendingComment = inlineCommentMatch[2].trim()
        }
      }

      currentSection[key] = parseTOMLValue(rawValue)

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
  if (value === "true") return true
  if (value === "false") return false

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map((v) => parseTOMLValue(v.trim()))
  }

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

// Properties file parser
function parseProperties(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {}
  const comments: CommentMap = {}
  const lines = content.split("\n")
  let pendingComment = ""

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
      const commentText = trimmed.slice(1).trim()
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentText
      continue
    }

    if (!trimmed) {
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

      if (value === "true") result[key] = true
      else if (value === "false") result[key] = false
      else if (!isNaN(parseFloat(value)) && isFinite(Number(value))) result[key] = parseFloat(value)
      else result[key] = value

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

// YAML parser
function parseYAML(content: string): ParsedConfigResult {
  const result: Record<string, ConfigValue> = {}
  const comments: CommentMap = {}
  const lines = content.split("\n")
  let pendingComment = ""

  const stack: { indent: number; obj: Record<string, ConfigValue>; key: string }[] = [
    { indent: -1, obj: result, key: "" }
  ]

  for (const line of lines) {
    if (!line.trim()) {
      pendingComment = ""
      continue
    }

    const commentOnlyMatch = line.match(/^(\s*)#\s*(.*)$/)
    if (commentOnlyMatch) {
      const commentText = commentOnlyMatch[2].trim()
      pendingComment = (pendingComment ? pendingComment + " " : "") + commentText
      continue
    }

    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const currentParent = stack[stack.length - 1].obj

    const kvMatch = line.match(/^(\s*)([^:#]+?):\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[2].trim()
      let rawValue = kvMatch[3].trim()

      const inlineCommentMatch = rawValue.match(/^(.+?)\s+#\s*(.*)$/)
      if (inlineCommentMatch && !rawValue.startsWith('"') && !rawValue.startsWith("'")) {
        rawValue = inlineCommentMatch[1].trim()
        if (inlineCommentMatch[2]) {
          pendingComment = inlineCommentMatch[2].trim()
        }
      }

      if (pendingComment) {
        const fullPath = stack.slice(1).map(s => s.key).concat(key).join(".")
        comments[fullPath] = pendingComment
        pendingComment = ""
      }

      if (rawValue === "" || rawValue === "|" || rawValue === ">") {
        const newObj: Record<string, ConfigValue> = {}
        currentParent[key] = newObj
        stack.push({ indent, obj: newObj, key })
      } else {
        currentParent[key] = parseYAMLValue(rawValue)
      }
    } else {
      const listMatch = line.match(/^(\s*)-\s*(.*)$/)
      if (listMatch) {
        const listValue = listMatch[2].trim()
        const parentKey = stack[stack.length - 1].key

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
  if (value === "null" || value === "~" || value === "") return null
  if (value === "true" || value === "yes" || value === "on") return true
  if (value === "false" || value === "no" || value === "off") return false

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map(v => parseYAMLValue(v.trim()))
  }

  const num = parseFloat(value)
  if (!isNaN(num) && isFinite(num)) return num

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
      } else {
        result += `${prefix}${key}:\n`
        for (const item of value) {
          result += `${prefix}  - ${stringifyYAMLValue(item)}\n`
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

// Value editor props
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

function ValueEditor({ keyName, value, onChange, onDelete, depth = 0, tooltip, comments, keyPath }: ValueEditorProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(depth < 2)

  const displayName = keyName.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())
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

  // Number input with slider
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
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {displayName}
            <Badge variant="secondary" className="text-xs">{value.length} items</Badge>
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
                <TooltipContent>{t("configEditor.addElement")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {onDelete && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
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
              <p className="text-sm text-muted-foreground py-2">{t("configEditor.noElement")}</p>
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
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {displayName}
            <Badge variant="secondary" className="text-xs">{entries.length} props</Badge>
          </button>
          {onDelete && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
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

// Visual config editor component
interface VisualConfigEditorProps {
  content: string
  fileType: string
  onChange: (newContent: string) => void
}

export function VisualConfigEditor({ content, fileType, onChange }: VisualConfigEditorProps) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
