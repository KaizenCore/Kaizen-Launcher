import { useState, useEffect, useCallback, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  ArrowUp,
  XCircle,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  EyeOff,
  Eye,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/i18n"

// Types matching Rust backend
interface DetectedIssue {
  issue_type: IssueType
  description: string
  mod_id: string | null
  mod_name: string | null
  required_mod_id: string | null
  required_mod_name: string | null
  required_version: string | null
  current_version: string | null
  suggested_action: SuggestedAction
  raw_log: string
}

type IssueType =
  | "missing_dependency"
  | "missing_recommendation"
  | "version_mismatch"
  | "recommended_version_mismatch"
  | "mod_conflict"
  | "minecraft_version_mismatch"
  | "loader_version_mismatch"
  | "duplicate_mod"
  | "unknown"

type SuggestedAction =
  | "install_dependency"
  | "update_mod"
  | "remove_mod"
  | "resolve_conflict"
  | "remove_duplicate"
  | "manual_fix"

interface DetectedIssuesProps {
  instanceId: string
  mcVersion: string
  loader: string | null
  onModInstalled?: () => void
  onModDeleted?: () => void
  compact?: boolean
}

const ISSUE_TYPE_ICONS: Record<IssueType, React.ReactNode> = {
  missing_dependency: <Download className="h-4 w-4" />,
  missing_recommendation: <Download className="h-4 w-4" />,
  version_mismatch: <ArrowUp className="h-4 w-4" />,
  recommended_version_mismatch: <ArrowUp className="h-4 w-4" />,
  mod_conflict: <XCircle className="h-4 w-4" />,
  minecraft_version_mismatch: <AlertCircle className="h-4 w-4" />,
  loader_version_mismatch: <AlertCircle className="h-4 w-4" />,
  duplicate_mod: <AlertTriangle className="h-4 w-4" />,
  unknown: <HelpCircle className="h-4 w-4" />,
}

const ISSUE_TYPE_COLORS: Record<IssueType, string> = {
  missing_dependency: "text-orange-500",
  missing_recommendation: "text-blue-500",
  version_mismatch: "text-yellow-500",
  recommended_version_mismatch: "text-blue-500",
  mod_conflict: "text-red-500",
  minecraft_version_mismatch: "text-red-500",
  loader_version_mismatch: "text-red-500",
  duplicate_mod: "text-orange-500",
  unknown: "text-gray-500",
}

// Get ignored mods from localStorage
const getIgnoredMods = (instanceId: string): Set<string> => {
  try {
    const stored = localStorage.getItem(`ignored_mods_${instanceId}`)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

// Save ignored mods to localStorage
const saveIgnoredMods = (instanceId: string, ignored: Set<string>) => {
  localStorage.setItem(`ignored_mods_${instanceId}`, JSON.stringify([...ignored]))
}

export function DetectedIssues({ instanceId, mcVersion, loader, onModInstalled, onModDeleted, compact = false }: DetectedIssuesProps) {
  const { t } = useTranslation()
  const [issues, setIssues] = useState<DetectedIssue[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFixing, setIsFixing] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [hasAnalyzed, setHasAnalyzed] = useState(false)
  const [ignoredMods, setIgnoredMods] = useState<Set<string>>(() => getIgnoredMods(instanceId))
  const [showIgnored, setShowIgnored] = useState(false)

  const analyzeIssues = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await invoke<DetectedIssue[]>("analyze_instance_logs", { instanceId })
      setIssues(result)
      setHasAnalyzed(true)
    } catch (err) {
      console.error("Failed to analyze logs:", err)
      toast.error(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [instanceId])

  // Handle ignoring a mod
  const handleIgnoreMod = useCallback((modId: string) => {
    const newIgnored = new Set(ignoredMods)
    newIgnored.add(modId)
    setIgnoredMods(newIgnored)
    saveIgnoredMods(instanceId, newIgnored)
    toast.success(t("detectedIssues.modIgnored", { mod: modId }))
  }, [ignoredMods, instanceId, t])

  // Handle un-ignoring a mod
  const handleUnignoreMod = useCallback((modId: string) => {
    const newIgnored = new Set(ignoredMods)
    newIgnored.delete(modId)
    setIgnoredMods(newIgnored)
    saveIgnoredMods(instanceId, newIgnored)
  }, [ignoredMods, instanceId])

  // Filter issues to exclude ignored mods
  const filteredIssues = useMemo(() => {
    return issues.filter(issue => !issue.required_mod_id || !ignoredMods.has(issue.required_mod_id))
  }, [issues, ignoredMods])

  // Get ignored issues for display
  const ignoredIssues = useMemo(() => {
    return issues.filter(issue => issue.required_mod_id && ignoredMods.has(issue.required_mod_id))
  }, [issues, ignoredMods])

  // Auto-analyze on mount
  useEffect(() => {
    analyzeIssues()
  }, [analyzeIssues])

  const handleInstallDependency = async (issue: DetectedIssue) => {
    if (!issue.required_mod_id) return

    const fixKey = `install_${issue.required_mod_id}`
    setIsFixing(fixKey)

    try {
      type SearchHit = { project_id: string; slug: string; title: string }
      type SearchResponse = { hits: SearchHit[] } | null

      let modToInstall: SearchHit | null = null

      // Strategy 1: Try to get the project directly by slug (most accurate)
      try {
        const project = await invoke<{ id: string; slug: string; title: string } | null>(
          "get_modrinth_mod_details",
          { projectId: issue.required_mod_id }
        )
        if (project) {
          modToInstall = { project_id: project.id, slug: project.slug, title: project.title }
        }
      } catch {
        // Project not found by slug, continue to search
      }

      // Strategy 2: Search with version and loader filters
      if (!modToInstall) {
        const searchResults = await invoke<SearchResponse>(
          "search_modrinth_mods",
          {
            query: issue.required_mod_id,
            gameVersion: mcVersion,
            loader: loader?.toLowerCase() || null,
            projectType: "mod",
            limit: 20,
          }
        )

        if (searchResults?.hits?.length) {
          // Find exact match by slug
          const exactMatch = searchResults.hits.find(
            h => h.slug.toLowerCase() === issue.required_mod_id?.toLowerCase()
          )
          if (exactMatch) {
            modToInstall = exactMatch
          }
        }
      }

      // Strategy 3: Search without version filter (broader search)
      if (!modToInstall) {
        const searchResults = await invoke<SearchResponse>(
          "search_modrinth_mods",
          {
            query: issue.required_mod_id,
            loader: loader?.toLowerCase() || null,
            projectType: "mod",
            limit: 20,
          }
        )

        if (searchResults?.hits?.length) {
          const exactMatch = searchResults.hits.find(
            h => h.slug.toLowerCase() === issue.required_mod_id?.toLowerCase()
          )
          if (exactMatch) {
            modToInstall = exactMatch
          }
        }
      }

      // Strategy 4: Search without any filters
      if (!modToInstall) {
        const searchResults = await invoke<SearchResponse>(
          "search_modrinth_mods",
          {
            query: issue.required_mod_id,
            projectType: "mod",
            limit: 20,
          }
        )

        if (searchResults?.hits?.length) {
          // Find exact match or take first result
          const exactMatch = searchResults.hits.find(
            h => h.slug.toLowerCase() === issue.required_mod_id?.toLowerCase()
          )
          modToInstall = exactMatch || searchResults.hits[0]
        }
      }

      if (!modToInstall) {
        toast.error(t("detectedIssues.modNotFound", { mod: issue.required_mod_id }))
        return
      }

      // Get compatible version
      const versions = await invoke<Array<{ id: string; version_number: string; loaders: string[] }> | null>(
        "get_modrinth_mod_versions",
        {
          projectId: modToInstall.project_id,
          gameVersion: mcVersion,
          loader: loader?.toLowerCase() || null,
        }
      )

      if (!versions || versions.length === 0) {
        toast.error(t("detectedIssues.noCompatibleVersion", { mod: modToInstall.title }))
        return
      }

      // Install the mod
      await invoke("install_modrinth_mod", {
        instanceId,
        projectId: modToInstall.project_id,
        versionId: versions[0].id,
      })

      toast.success(t("detectedIssues.modInstalled", { mod: modToInstall.title }))

      // Remove the fixed issue from the list
      setIssues(prev => prev.filter(i => i.required_mod_id !== issue.required_mod_id))

      // Notify parent to refresh mod list
      onModInstalled?.()
    } catch (err) {
      console.error("Failed to install dependency:", err)
      toast.error(String(err))
    } finally {
      setIsFixing(null)
    }
  }

  const handleOpenModrinth = (modId: string) => {
    window.open(`https://modrinth.com/mod/${modId}`, "_blank")
  }

  const handleDeleteRequesterMod = async (issue: DetectedIssue) => {
    if (!issue.mod_id && !issue.mod_name) return

    const deleteKey = `delete_${issue.mod_id || issue.mod_name}`
    setIsDeleting(deleteKey)

    try {
      // Get the list of mods for this instance to find the mod to delete
      const mods = await invoke<Array<{ name: string; filename: string; project_id: string | null }>>(
        "get_instance_mods",
        { instanceId }
      )

      // Find the mod by project_id (Modrinth project ID) or by name
      let modToDelete = mods.find(
        m => m.project_id === issue.mod_id ||
             m.name.toLowerCase() === issue.mod_name?.toLowerCase()
      )

      // If not found, try to find by filename pattern containing the mod_id or mod_name
      if (!modToDelete) {
        modToDelete = mods.find(
          m => m.filename.toLowerCase().includes(issue.mod_id?.toLowerCase() || "") ||
               m.filename.toLowerCase().includes(issue.mod_name?.toLowerCase().replace(/\s+/g, "") || "")
        )
      }

      if (!modToDelete) {
        toast.error(t("detectedIssues.modNotFoundToDelete", { mod: issue.mod_name || issue.mod_id || "unknown" }))
        return
      }

      // Delete the mod using filename
      await invoke("delete_mod", { instanceId, filename: modToDelete.filename })
      toast.success(t("detectedIssues.modDeleted", { mod: modToDelete.name }))

      // Remove all issues related to this mod from the list
      setIssues(prev => prev.filter(i => i.mod_id !== issue.mod_id))

      // Notify parent to refresh mod list
      onModDeleted?.()
    } catch (err) {
      console.error("Failed to delete mod:", err)
      toast.error(String(err))
    } finally {
      setIsDeleting(null)
    }
  }

  const getIssueTypeLabel = (type: IssueType): string => {
    switch (type) {
      case "missing_dependency":
        return t("detectedIssues.types.missingDependency")
      case "missing_recommendation":
        return t("detectedIssues.types.missingRecommendation")
      case "version_mismatch":
        return t("detectedIssues.types.versionMismatch")
      case "recommended_version_mismatch":
        return t("detectedIssues.types.recommendedVersionMismatch")
      case "mod_conflict":
        return t("detectedIssues.types.modConflict")
      case "minecraft_version_mismatch":
        return t("detectedIssues.types.minecraftVersionMismatch")
      case "loader_version_mismatch":
        return t("detectedIssues.types.loaderVersionMismatch")
      case "duplicate_mod":
        return t("detectedIssues.types.duplicateMod")
      default:
        return t("detectedIssues.types.unknown")
    }
  }

  const getActionButton = (issue: DetectedIssue) => {
    const fixKey = `install_${issue.required_mod_id}`
    const deleteKey = `delete_${issue.mod_id}`
    const isCurrentlyFixing = isFixing === fixKey
    const isCurrentlyDeleting = isDeleting === deleteKey

    switch (issue.suggested_action) {
      case "install_dependency":
        return (
          <div className="flex items-center gap-1">
            {/* Install dependency button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleInstallDependency(issue)}
                    disabled={isCurrentlyFixing || isCurrentlyDeleting || !issue.required_mod_id}
                    className="gap-1.5"
                  >
                    {isCurrentlyFixing ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("detectedIssues.installing")}
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        {t("detectedIssues.install")}
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("detectedIssues.installDependency", { mod: issue.required_mod_name || issue.required_mod_id || "unknown" })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <span className="text-xs text-muted-foreground px-1">{t("common.or")}</span>

            {/* Delete requester mod button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteRequesterMod(issue)}
                    disabled={isCurrentlyFixing || isCurrentlyDeleting || (!issue.mod_id && !issue.mod_name)}
                    className="gap-1.5"
                  >
                    {isCurrentlyDeleting ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("detectedIssues.deleting")}
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3 w-3" />
                        {t("detectedIssues.remove")}
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("detectedIssues.removeRequester", { mod: issue.mod_name || issue.mod_id || "unknown" })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* View on Modrinth button */}
            {issue.required_mod_id && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenModrinth(issue.required_mod_id!)}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("detectedIssues.viewOnModrinth")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )
      case "update_mod":
        return (
          <Badge variant="secondary">
            <ArrowUp className="h-3 w-3 mr-1" />
            {t("detectedIssues.updateRequired")}
          </Badge>
        )
      case "remove_mod":
      case "remove_duplicate":
        return (
          <Badge variant="destructive">
            <Trash2 className="h-3 w-3 mr-1" />
            {t("detectedIssues.removeRecommended")}
          </Badge>
        )
      case "resolve_conflict":
        return (
          <Badge variant="secondary">
            <XCircle className="h-3 w-3 mr-1" />
            {t("detectedIssues.resolveConflict")}
          </Badge>
        )
      default:
        return (
          <Badge variant="outline">
            {t("detectedIssues.manualFix")}
          </Badge>
        )
    }
  }

  // Show success state if analyzed with no issues
  const hasIssues = filteredIssues.length > 0
  const cardStyle = hasIssues
    ? "border-orange-500/30 bg-orange-500/5"
    : hasAnalyzed
      ? "border-green-500/30 bg-green-500/5"
      : ""

  // Compact mode for embedding in popover
  if (compact) {
    return (
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <span className="font-medium text-sm">{t("detectedIssues.title")}</span>
            {hasIssues && (
              <Badge variant="destructive" className="text-xs">{filteredIssues.length}</Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={analyzeIssues}
            disabled={isLoading}
            className="h-7 px-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {isLoading && !hasAnalyzed ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="text-center py-3 text-sm text-muted-foreground">
            {t("detectedIssues.noIssues")}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredIssues.slice(0, 10).map((issue, index) => (
              <div
                key={`${issue.issue_type}-${issue.required_mod_id || index}`}
                className="p-2 rounded-md border bg-background/50 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <div className={`mt-0.5 ${ISSUE_TYPE_COLORS[issue.issue_type]}`}>
                      {ISSUE_TYPE_ICONS[issue.issue_type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs line-clamp-2">{issue.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {getActionButton(issue)}
                  </div>
                </div>
              </div>
            ))}
            {filteredIssues.length > 10 && (
              <p className="text-xs text-center text-muted-foreground">
                +{filteredIssues.length - 10} {t("detectedIssues.moreIssues")}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card className={cardStyle}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasIssues ? (
              <AlertTriangle className="h-5 w-5 text-orange-500" />
            ) : hasAnalyzed ? (
              <Check className="h-5 w-5 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            )}
            <CardTitle className="text-lg">{t("detectedIssues.title")}</CardTitle>
            {hasIssues && (
              <Badge variant="destructive">{filteredIssues.length}</Badge>
            )}
            {ignoredIssues.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <EyeOff className="h-3 w-3" />
                {ignoredIssues.length} {t("detectedIssues.ignored")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ignoredIssues.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowIgnored(!showIgnored)}
                className="gap-2"
              >
                {showIgnored ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {showIgnored ? t("detectedIssues.hideIgnored") : t("detectedIssues.showIgnored")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={analyzeIssues}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              {t("detectedIssues.reanalyze")}
            </Button>
          </div>
        </div>
        <CardDescription>
          {t("detectedIssues.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && !hasAnalyzed ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredIssues.length === 0 && ignoredIssues.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            {t("detectedIssues.noIssues")}
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-3">
              {/* Active issues */}
              {filteredIssues.map((issue, index) => (
                <div
                  key={`${issue.issue_type}-${issue.required_mod_id || index}`}
                  className="p-3 rounded-lg border bg-background/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`mt-0.5 ${ISSUE_TYPE_COLORS[issue.issue_type]}`}>
                        {ISSUE_TYPE_ICONS[issue.issue_type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {getIssueTypeLabel(issue.issue_type)}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium">{issue.description}</p>
                        {issue.required_mod_id && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("detectedIssues.modId")}: {issue.required_mod_id}
                          </p>
                        )}
                        {issue.required_version && issue.current_version && (
                          <p className="text-xs text-muted-foreground">
                            {t("detectedIssues.versionInfo", {
                              required: issue.required_version,
                              current: issue.current_version,
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {getActionButton(issue)}
                      {issue.required_mod_id && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleIgnoreMod(issue.required_mod_id!)}
                              >
                                <EyeOff className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("detectedIssues.ignoreMod")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Ignored issues (shown when showIgnored is true) */}
              {showIgnored && ignoredIssues.length > 0 && (
                <>
                  <div className="text-sm font-medium text-muted-foreground mt-4 mb-2">
                    {t("detectedIssues.ignoredSection")}
                  </div>
                  {ignoredIssues.map((issue, index) => (
                    <div
                      key={`ignored-${issue.issue_type}-${issue.required_mod_id || index}`}
                      className="p-3 rounded-lg border bg-muted/30 opacity-60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="mt-0.5 text-muted-foreground">
                            <EyeOff className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">{issue.description}</p>
                            {issue.required_mod_id && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {t("detectedIssues.modId")}: {issue.required_mod_id}
                              </p>
                            )}
                          </div>
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleUnignoreMod(issue.required_mod_id!)}
                              >
                                <Undo2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("detectedIssues.unignoreMod")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
