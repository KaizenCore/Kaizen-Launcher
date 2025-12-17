import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Boxes,
  Search,
  Upload,
  Trash2,
  Star,
  Copy,
  FolderOpen,
  Loader2,
  AlertTriangle,
  FileBox,
  Tag,
  HardDrive,
  RefreshCw,
  Server,
  Gamepad2,
  ChevronRight,
  X,
  Check,
  Plus,
  Share2,
  Link,
  Download,
  Pencil,
  User,
  Lock,
} from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type {
  Schematic,
  SchematicFormat,
  SchematicStats,
  SchematicConflict,
  SchematicWithInstances,
  DetectedSchematic,
  ConflictResolution,
  SchematicShare,
} from "@/types/schematics"
import { useSharingStore } from "@/stores/sharingStore"

interface Instance {
  id: string
  name: string
  is_server: boolean
  is_proxy: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return isoString
  }
}

function formatExtension(format: SchematicFormat): string {
  switch (format) {
    case "schem": return ".schem"
    case "schematic": return ".schematic"
    case "litematic": return ".litematic"
    case "nbt": return ".nbt"
    default: return format
  }
}

function getFormatColor(format: SchematicFormat): string {
  switch (format) {
    case "schem": return "bg-blue-500/20 text-blue-500"
    case "schematic": return "bg-amber-500/20 text-amber-500"
    case "litematic": return "bg-purple-500/20 text-purple-500"
    case "nbt": return "bg-green-500/20 text-green-500"
    default: return "bg-muted text-muted-foreground"
  }
}

export function Schematics() {
  const { t } = useTranslation()
  // Extract only the function we need to prevent unnecessary re-renders
  const syncSharing = useSharingStore.getState().syncWithBackend

  // Main state
  const [schematics, setSchematics] = useState<SchematicWithInstances[]>([])
  const [stats, setStats] = useState<SchematicStats | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSchematic, setSelectedSchematic] = useState<SchematicWithInstances | null>(null)

  // Filter state
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [formatFilter, setFormatFilter] = useState<string>("all")
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)

  // Debounce search query (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Tab state
  const [activeTab, setActiveTab] = useState("library")
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)

  // Dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)

  // Operation state
  const [isImporting, setIsImporting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)

  // Copy dialog state
  const [selectedInstancesForCopy, setSelectedInstancesForCopy] = useState<Set<string>>(new Set())
  const [targetFolder, setTargetFolder] = useState("worldedit")

  // Conflict state
  const [conflicts, setConflicts] = useState<SchematicConflict[]>([])
  const [currentConflict, setCurrentConflict] = useState<SchematicConflict | null>(null)

  // Tag editing state
  const [editingTags, setEditingTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [allTags, setAllTags] = useState<string[]>([])

  // Author editing state
  const [isEditingAuthor, setIsEditingAuthor] = useState(false)
  const [editingAuthor, setEditingAuthor] = useState("")

  // Sharing state
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [activeShare, setActiveShare] = useState<SchematicShare | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [sharePassword, setSharePassword] = useState("")
  const [shareProvider, setShareProvider] = useState<"bore" | "cloudflare">("cloudflare")
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [downloadPassword, setDownloadPassword] = useState("")

  // Detected schematics (from scan, not yet in library)
  const [detectedSchematics, setDetectedSchematics] = useState<Record<string, DetectedSchematic[]>>({})
  const [isImportingFromInstance, setIsImportingFromInstance] = useState(false)

  // Use ref to ensure loadData only runs once on mount
  const hasLoadedRef = useRef(false)

  const loadData = useCallback(async () => {
    console.log("[Schematics] Loading schematic data...")
    try {
      const [schematicsResult, statsResult, instancesResult, tagsResult] = await Promise.all([
        invoke<SchematicWithInstances[]>("get_schematics_with_instances"),
        invoke<SchematicStats>("get_schematic_stats"),
        invoke<Instance[]>("get_instances"),
        invoke<string[]>("get_all_schematic_tags"),
      ])
      console.log(`[Schematics] Loaded ${schematicsResult.length} schematics`)
      setSchematics(schematicsResult)
      setStats(statsResult)
      setInstances(instancesResult)
      setAllTags(tagsResult)
    } catch (err) {
      console.error("[Schematics] Failed to load schematics:", err)
      toast.error(t("schematics.loadError"))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  // Load data only once on mount
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      loadData()
    }
  }, [loadData])

  // Auto-scan when switching to "instances" tab (only if not already scanned)
  const hasScannedRef = useRef(false)
  useEffect(() => {
    if (activeTab === "instances" && !hasScannedRef.current && !isScanning && instances.length > 0) {
      hasScannedRef.current = true
      // Scan in background without blocking UI
      invoke<Record<string, DetectedSchematic[]>>("scan_instance_schematics")
        .then(detected => {
          setDetectedSchematics(detected)
          const total = Object.values(detected).reduce((sum, arr) => sum + arr.length, 0)
          console.log(`[Schematics] Auto-scan: found ${total} schematics`)
        })
        .catch(err => console.error("[Schematics] Auto-scan failed:", err))
    }
  }, [activeTab, isScanning, instances.length])

  // Filtered schematics
  const filteredSchematics = useMemo(() => {
    let result = [...schematics]

    // Filter by search (using debounced value)
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase()
      result = result.filter(
        (s) =>
          s.schematic.name.toLowerCase().includes(query) ||
          s.schematic.filename.toLowerCase().includes(query) ||
          s.schematic.author?.toLowerCase().includes(query) ||
          s.schematic.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }

    // Filter by format
    if (formatFilter !== "all") {
      result = result.filter((s) => s.schematic.format === formatFilter)
    }

    // Filter by favorites
    if (showFavoritesOnly) {
      result = result.filter((s) => s.schematic.is_favorite)
    }

    // Filter by instance if in "By Instance" tab
    if (activeTab === "instances" && selectedInstanceId) {
      result = result.filter((s) =>
        s.instances.some(inst => inst.instance_id === selectedInstanceId)
      )
    }

    // Sort by favorites first, then by name
    result.sort((a, b) => {
      if (a.schematic.is_favorite !== b.schematic.is_favorite) {
        return a.schematic.is_favorite ? -1 : 1
      }
      return a.schematic.name.localeCompare(b.schematic.name)
    })

    return result
  }, [schematics, debouncedSearch, formatFilter, showFavoritesOnly, activeTab, selectedInstanceId])

  // Instances with schematics count (library + detected) - optimized with lookup map
  const instancesWithCounts = useMemo(() => {
    // Pre-compute instance -> count map (O(m * k) instead of O(n * m * k))
    const countByInstance = new Map<string, number>()
    for (const s of schematics) {
      for (const inst of s.instances) {
        countByInstance.set(inst.instance_id, (countByInstance.get(inst.instance_id) || 0) + 1)
      }
    }

    return instances.map(inst => ({
      ...inst,
      schematicCount: countByInstance.get(inst.id) || 0,
      detectedCount: (detectedSchematics[inst.id] || []).filter(d => !d.in_library).length
    })).filter(inst => inst.schematicCount > 0 || inst.detectedCount > 0)
  }, [instances, schematics, detectedSchematics])

  // Get detected schematics for selected instance (not in library)
  const selectedInstanceDetected = useMemo(() => {
    if (!selectedInstanceId) return []
    return (detectedSchematics[selectedInstanceId] || []).filter(d => !d.in_library)
  }, [selectedInstanceId, detectedSchematics])

  // Handlers
  const handleImport = async () => {
    const selected = await open({
      multiple: true,
      filters: [{
        name: "Schematics",
        extensions: ["schem", "schematic", "litematic", "nbt"]
      }]
    })

    if (!selected) return

    const files = Array.isArray(selected) ? selected : [selected]
    if (files.length === 0) return

    setIsImporting(true)
    let imported = 0

    let errors = 0
    try {
      for (const filePath of files) {
        try {
          console.log(`[Schematics] Importing: ${filePath}`)
          await invoke("import_schematic", { filePath })
          imported++
        } catch (err) {
          console.error(`[Schematics] Failed to import ${filePath}:`, err)
          errors++
        }
      }

      if (imported > 0) {
        toast.success(t("schematics.importSuccess", { count: imported }))
        await loadData()
      }
      if (errors > 0 && imported === 0) {
        toast.error(t("schematics.importError"))
      }
    } finally {
      setIsImporting(false)
      setImportDialogOpen(false)
    }
  }

  const handleToggleFavorite = useCallback(async (schematic: Schematic) => {
    try {
      await invoke("toggle_schematic_favorite", { schematicId: schematic.id })
      // Optimistic update for better UX
      setSchematics(prev => prev.map(s =>
        s.schematic.id === schematic.id
          ? { ...s, schematic: { ...s.schematic, is_favorite: !s.schematic.is_favorite } }
          : s
      ))
      setSelectedSchematic(prev => prev?.schematic.id === schematic.id ? {
        ...prev,
        schematic: { ...prev.schematic, is_favorite: !prev.schematic.is_favorite }
      } : prev)
    } catch (err) {
      console.error("[Schematics] Failed to toggle favorite:", err)
      toast.error(t("schematics.favoriteError"))
      // Revert on error
      await loadData()
    }
  }, [loadData, t])

  const handleDelete = useCallback(async () => {
    if (!selectedSchematic) return

    setIsDeleting(true)
    try {
      // Build instance list for deletion
      const instanceList = selectedSchematic.instances.map(i => [i.instance_id, ""])
      await invoke("delete_schematic", {
        schematicId: selectedSchematic.schematic.id,
        deleteFromInstances: true,
        instances: instanceList
      })
      toast.success(t("schematics.deleteSuccess"))
      setSelectedSchematic(null)
      await loadData()
    } catch (err) {
      console.error("[Schematics] Failed to delete schematic:", err)
      toast.error(t("schematics.deleteError"))
    } finally {
      setIsDeleting(false)
      setDeleteDialogOpen(false)
    }
  }, [selectedSchematic, loadData, t])

  const handleCopyToInstances = useCallback(async () => {
    if (!selectedSchematic || selectedInstancesForCopy.size === 0) return

    setIsCopying(true)
    try {
      await invoke("copy_schematic_to_instances", {
        schematicId: selectedSchematic.schematic.id,
        instanceIds: Array.from(selectedInstancesForCopy),
        targetFolder,
      })

      toast.success(t("schematics.copySuccess", { count: selectedInstancesForCopy.size }))
      setSelectedInstancesForCopy(new Set())
      await loadData()
    } catch (err) {
      console.error("[Schematics] Failed to copy schematic:", err)
      toast.error(t("schematics.copyError"))
    } finally {
      setIsCopying(false)
      setCopyDialogOpen(false)
    }
  }, [selectedSchematic, selectedInstancesForCopy, instances, targetFolder, loadData, t])

  const handleScanInstances = useCallback(async () => {
    setIsScanning(true)
    try {
      // Scan all instances for schematics - returns HashMap<instanceId, Vec<DetectedSchematic>>
      const detected = await invoke<Record<string, DetectedSchematic[]>>("scan_instance_schematics")

      // Count total detected
      const totalDetected = Object.values(detected).reduce((sum, arr) => sum + arr.length, 0)
      console.log(`[Schematics] Scan complete: found ${totalDetected} schematics across ${Object.keys(detected).length} instances`)

      // Store detected schematics for display
      setDetectedSchematics(detected)

      // Check for conflicts
      const conflictsResult = await invoke<SchematicConflict[]>("get_schematic_conflicts")
      if (conflictsResult.length > 0) {
        setConflicts(conflictsResult)
        setCurrentConflict(conflictsResult[0])
        setConflictDialogOpen(true)
      }

      await loadData()
      toast.success(t("schematics.scanComplete", { count: totalDetected }))
    } catch (err) {
      console.error("[Schematics] Scan failed:", err)
      toast.error(t("schematics.scanError"))
    } finally {
      setIsScanning(false)
    }
  }, [loadData, t])

  const handleResolveConflict = async (resolution: ConflictResolution) => {
    if (!currentConflict) return

    try {
      const instance = instances.find(i => i.id === currentConflict.instance_id)
      await invoke("resolve_schematic_conflict", {
        schematicId: currentConflict.schematic_id,
        instanceId: currentConflict.instance_id,
        instanceGameDir: instance?.name || "",
        resolution,
      })

      // Move to next conflict or close
      const remaining = conflicts.filter(c =>
        !(c.schematic_id === currentConflict.schematic_id &&
          c.instance_id === currentConflict.instance_id)
      )
      setConflicts(remaining)

      if (remaining.length > 0) {
        setCurrentConflict(remaining[0])
      } else {
        setConflictDialogOpen(false)
        setCurrentConflict(null)
        await loadData()
      }
    } catch (err) {
      console.error("[Schematics] Failed to resolve conflict:", err)
      toast.error(t("schematics.conflictError"))
    }
  }

  const handleSaveTags = async () => {
    if (!selectedSchematic) return

    try {
      await invoke("update_schematic_tags", {
        schematicId: selectedSchematic.schematic.id,
        tags: editingTags,
      })
      toast.success(t("schematics.tagsUpdated"))
      await loadData()
      setTagDialogOpen(false)
    } catch (err) {
      console.error("[Schematics] Failed to update tags:", err)
      toast.error(t("schematics.tagsError"))
    }
  }

  const handleSaveAuthor = async () => {
    if (!selectedSchematic) return

    try {
      await invoke("update_schematic_metadata", {
        schematicId: selectedSchematic.schematic.id,
        author: editingAuthor.trim() || null,
      })
      // Optimistic update
      setSchematics(prev => prev.map(s =>
        s.schematic.id === selectedSchematic.schematic.id
          ? { ...s, schematic: { ...s.schematic, author: editingAuthor.trim() || null } }
          : s
      ))
      setSelectedSchematic(prev => prev ? {
        ...prev,
        schematic: { ...prev.schematic, author: editingAuthor.trim() || null }
      } : prev)
      setIsEditingAuthor(false)
      toast.success(t("schematics.authorUpdated"))
    } catch (err) {
      console.error("[Schematics] Failed to update author:", err)
      toast.error(t("schematics.authorError"))
    }
  }

  const handleOpenFolder = async () => {
    try {
      await invoke("open_schematics_folder")
    } catch (err) {
      console.error("[Schematics] Failed to open folder:", err)
    }
  }

  const handleImportFromInstance = useCallback(async (instanceId: string, instancePath: string) => {
    setIsImportingFromInstance(true)
    try {
      await invoke("import_schematic_from_instance", {
        instanceId,
        instancePath,
      })
      toast.success(t("schematics.importSuccess", { count: 1 }))
      // Re-scan to update detected list
      const detected = await invoke<Record<string, DetectedSchematic[]>>("scan_instance_schematics")
      setDetectedSchematics(detected)
      await loadData()
    } catch (err) {
      console.error("[Schematics] Failed to import from instance:", err)
      toast.error(t("schematics.importError"))
    } finally {
      setIsImportingFromInstance(false)
    }
  }, [loadData, t])

  const openTagDialog = (schematic: SchematicWithInstances) => {
    setSelectedSchematic(schematic)
    setEditingTags([...schematic.schematic.tags])
    setNewTag("")
    setTagDialogOpen(true)
  }

  const addTag = () => {
    const tag = newTag.trim().toLowerCase()
    if (tag && !editingTags.includes(tag)) {
      setEditingTags([...editingTags, tag])
      setNewTag("")
    }
  }

  const removeTag = (tag: string) => {
    setEditingTags(editingTags.filter(t => t !== tag))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full p-6 gap-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Boxes className="h-6 w-6" />
              {t("schematics.title")}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t("schematics.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Stats */}
            {stats && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground mr-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <FileBox className="h-4 w-4" />
                      <span>{stats.total_schematics}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{t("schematics.totalSchematics")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-4 w-4" />
                      <span>{formatBytes(stats.total_size_bytes)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{t("schematics.totalSize")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4" />
                      <span>{stats.favorites_count}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{t("schematics.favorites")}</TooltipContent>
                </Tooltip>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenFolder}>
              <FolderOpen className="h-4 w-4 mr-2" />
              {t("schematics.openFolder")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleScanInstances}
              disabled={isScanning}
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t("schematics.scan")}
            </Button>
            <Button size="sm" onClick={() => setImportDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              {t("schematics.import")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDownloadUrl("")
                setDownloadPassword("")
                setDownloadDialogOpen(true)
              }}
            >
              <Link className="h-4 w-4 mr-2" />
              {t("schematics.downloadFromLink")}
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 gap-6 min-h-0">
          {/* Left panel - List */}
          <div className="flex-1 flex flex-col min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1">
              <div className="flex items-center justify-between gap-4 mb-4">
                <TabsList>
                  <TabsTrigger value="library">{t("schematics.library")}</TabsTrigger>
                  <TabsTrigger value="instances">{t("schematics.byInstance")}</TabsTrigger>
                </TabsList>

                {/* Filters */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t("schematics.searchPlaceholder")}
                      className="pl-9 w-64"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Select value={formatFilter} onValueChange={setFormatFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder={t("schematics.allFormats")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("schematics.allFormats")}</SelectItem>
                      <SelectItem value="schem">.schem</SelectItem>
                      <SelectItem value="schematic">.schematic</SelectItem>
                      <SelectItem value="litematic">.litematic</SelectItem>
                      <SelectItem value="nbt">.nbt</SelectItem>
                    </SelectContent>
                  </Select>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={showFavoritesOnly ? "default" : "outline"}
                        size="icon"
                        onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("schematics.favoritesOnly")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <TabsContent value="library" className="flex-1 mt-0">
                <ScrollArea className="h-full">
                  {filteredSchematics.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <Boxes className="h-12 w-12 mb-4 opacity-50" />
                      <p>{t("schematics.noSchematics")}</p>
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => setImportDialogOpen(true)}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {t("schematics.importFirst")}
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 pr-4">
                      {filteredSchematics.map((item) => (
                        <SchematicCard
                          key={item.schematic.id}
                          item={item}
                          isSelected={selectedSchematic?.schematic.id === item.schematic.id}
                          onSelect={() => setSelectedSchematic(item)}
                          onToggleFavorite={() => handleToggleFavorite(item.schematic)}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="instances" className="flex-1 mt-0">
                <div className="flex gap-4 h-full">
                  {/* Instance list */}
                  <div className="w-64 border-r pr-4">
                    <ScrollArea className="h-full">
                      <div className="space-y-1">
                        {instancesWithCounts.map((inst) => (
                          <button
                            key={inst.id}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors overflow-hidden ${
                              selectedInstanceId === inst.id
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-secondary"
                            }`}
                            onClick={() => setSelectedInstanceId(inst.id)}
                          >
                            {inst.is_server ? (
                              <Server className="h-4 w-4 flex-shrink-0" />
                            ) : (
                              <Gamepad2 className="h-4 w-4 flex-shrink-0" />
                            )}
                            <span className="truncate w-0 flex-1 text-left">{inst.name}</span>
                            <div className="flex gap-1 flex-shrink-0">
                              {inst.schematicCount > 0 && (
                                <Badge variant="secondary">
                                  {inst.schematicCount}
                                </Badge>
                              )}
                              {inst.detectedCount > 0 && (
                                <Badge variant="outline" className="text-amber-500 border-amber-500">
                                  +{inst.detectedCount}
                                </Badge>
                              )}
                            </div>
                          </button>
                        ))}
                        {instancesWithCounts.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            {t("schematics.noInstanceSchematics")}
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Schematics for selected instance */}
                  <div className="flex-1">
                    <ScrollArea className="h-full">
                      {selectedInstanceId ? (
                        (filteredSchematics.length > 0 || selectedInstanceDetected.length > 0) ? (
                          <div className="grid grid-cols-1 gap-2 pr-4">
                            {/* Schematics in library */}
                            {filteredSchematics.map((item) => (
                              <SchematicCard
                                key={item.schematic.id}
                                item={item}
                                isSelected={selectedSchematic?.schematic.id === item.schematic.id}
                                onSelect={() => setSelectedSchematic(item)}
                                onToggleFavorite={() => handleToggleFavorite(item.schematic)}
                              />
                            ))}

                            {/* Detected schematics (not in library) */}
                            {selectedInstanceDetected.length > 0 && (
                              <>
                                {filteredSchematics.length > 0 && (
                                  <div className="flex items-center gap-2 my-2">
                                    <Separator className="flex-1" />
                                    <span className="text-xs text-muted-foreground">
                                      {t("schematics.notInLibrary")}
                                    </span>
                                    <Separator className="flex-1" />
                                  </div>
                                )}
                                {selectedInstanceDetected.map((detected) => (
                                  <Card
                                    key={detected.path}
                                    className="border-dashed border-amber-500/50"
                                  >
                                    <CardContent className="p-3">
                                      <div className="flex items-center gap-3">
                                        {/* Icon */}
                                        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-amber-500/10">
                                          <FileBox className="h-5 w-5 text-amber-500" />
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium truncate">{detected.filename}</p>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Badge
                                              variant="secondary"
                                              className={`text-[10px] px-1.5 py-0 ${getFormatColor(detected.format)}`}
                                            >
                                              {formatExtension(detected.format)}
                                            </Badge>
                                            <span>{formatBytes(detected.file_size_bytes)}</span>
                                            <span className="truncate">{detected.path}</span>
                                          </div>
                                        </div>

                                        {/* Import button */}
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="flex-shrink-0"
                                          disabled={isImportingFromInstance}
                                          onClick={() => handleImportFromInstance(selectedInstanceId, detected.path)}
                                        >
                                          {isImportingFromInstance ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Upload className="h-4 w-4" />
                                          )}
                                          <span className="ml-2">{t("schematics.importToLibrary")}</span>
                                        </Button>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <p>{t("schematics.noSchematicsInInstance")}</p>
                            <Button
                              variant="outline"
                              className="mt-4"
                              onClick={handleScanInstances}
                              disabled={isScanning}
                            >
                              {isScanning ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              {t("schematics.scan")}
                            </Button>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center justify-center h-64 text-muted-foreground">
                          <p>{t("schematics.selectInstance")}</p>
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right panel - Details */}
          {selectedSchematic && (
            <Card className="w-80 flex-shrink-0">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">
                      {selectedSchematic.schematic.name}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedSchematic.schematic.filename}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => handleToggleFavorite(selectedSchematic.schematic)}
                  >
                    <Star
                      className={`h-5 w-5 ${
                        selectedSchematic.schematic.is_favorite
                          ? "fill-yellow-500 text-yellow-500"
                          : ""
                      }`}
                    />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Format badge */}
                <Badge className={getFormatColor(selectedSchematic.schematic.format)}>
                  {formatExtension(selectedSchematic.schematic.format)}
                </Badge>

                {/* Dimensions */}
                {selectedSchematic.schematic.dimensions && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("schematics.dimensions")}
                    </p>
                    <p className="text-sm font-medium">
                      {selectedSchematic.schematic.dimensions.width} x{" "}
                      {selectedSchematic.schematic.dimensions.height} x{" "}
                      {selectedSchematic.schematic.dimensions.length}
                    </p>
                  </div>
                )}

                {/* Size */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("schematics.fileSize")}
                  </p>
                  <p className="text-sm font-medium">
                    {formatBytes(selectedSchematic.schematic.file_size_bytes)}
                  </p>
                </div>

                {/* Author */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {t("schematics.author")}
                      {selectedSchematic.schematic.author_locked && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Lock className="h-3 w-3 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("schematics.authorProtected")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </p>
                    {!selectedSchematic.schematic.author_locked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          setEditingAuthor(selectedSchematic.schematic.author || "")
                          setIsEditingAuthor(true)
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {isEditingAuthor && !selectedSchematic.schematic.author_locked ? (
                    <div className="flex gap-1">
                      <Input
                        value={editingAuthor}
                        onChange={(e) => setEditingAuthor(e.target.value)}
                        placeholder={t("schematics.authorPlaceholder")}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleSaveAuthor()
                          } else if (e.key === "Escape") {
                            setIsEditingAuthor(false)
                          }
                        }}
                      />
                      <Button size="icon" className="h-8 w-8" onClick={handleSaveAuthor}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setIsEditingAuthor(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : selectedSchematic.schematic.author ? (
                    <p className="text-sm font-medium flex items-center gap-1">
                      <User className="h-3 w-3 text-muted-foreground" />
                      {selectedSchematic.schematic.author}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {t("schematics.noAuthor")}
                    </p>
                  )}
                </div>

                {/* MC Version */}
                {selectedSchematic.schematic.mc_version && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("schematics.mcVersion")}
                    </p>
                    <p className="text-sm font-medium">
                      {selectedSchematic.schematic.mc_version}
                    </p>
                  </div>
                )}

                {/* Tags */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground">
                      {t("schematics.tags")}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => openTagDialog(selectedSchematic)}
                    >
                      <Tag className="h-3 w-3" />
                    </Button>
                  </div>
                  {selectedSchematic.schematic.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {selectedSchematic.schematic.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("schematics.noTags")}
                    </p>
                  )}
                </div>

                {/* Instances */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("schematics.linkedInstances")}
                  </p>
                  {selectedSchematic.instances.length > 0 ? (
                    <div className="space-y-1">
                      {selectedSchematic.instances.map((inst) => (
                        <div
                          key={inst.instance_id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <span className="truncate">{inst.instance_name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("schematics.notInAnyInstance")}
                    </p>
                  )}
                </div>

                {/* Created date */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("schematics.addedOn")}
                  </p>
                  <p className="text-sm font-medium">
                    {formatDate(selectedSchematic.schematic.created_at)}
                  </p>
                </div>

                <Separator />

                {/* Actions */}
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setSelectedInstancesForCopy(new Set())
                      setCopyDialogOpen(true)
                    }}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {t("schematics.copyToInstances")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setSharePassword("")
                      setShareProvider("cloudflare")
                      setActiveShare(null)
                      setShareDialogOpen(true)
                    }}
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    {t("schematics.share")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start text-destructive hover:text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t("schematics.delete")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Import Dialog */}
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("schematics.importTitle")}</DialogTitle>
              <DialogDescription>
                {t("schematics.importDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-4">
                {t("schematics.supportedFormats")}:
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge className={getFormatColor("schem")}>.schem (WorldEdit/FAWE)</Badge>
                <Badge className={getFormatColor("schematic")}>.schematic (Legacy)</Badge>
                <Badge className={getFormatColor("litematic")}>.litematic (Litematica)</Badge>
                <Badge className={getFormatColor("nbt")}>.nbt (Vanilla)</Badge>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {t("schematics.selectFiles")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Copy to Instances Dialog */}
        <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("schematics.copyTitle")}</DialogTitle>
              <DialogDescription>
                {t("schematics.copyDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {/* Target folder */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  {t("schematics.targetFolder")}
                </Label>
                <Select value={targetFolder} onValueChange={setTargetFolder}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="worldedit">WorldEdit / FAWE</SelectItem>
                    <SelectItem value="litematica">Litematica</SelectItem>
                    <SelectItem value="create">Create Mod</SelectItem>
                    <SelectItem value="axiom">Axiom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Instance selection */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  {t("schematics.selectInstances")}
                </Label>
                <ScrollArea className="h-48 border rounded-md p-2">
                  <div className="space-y-2">
                    {instances.map((inst) => (
                      <label
                        key={inst.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-secondary cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedInstancesForCopy.has(inst.id)}
                          onCheckedChange={(checked) => {
                            const newSet = new Set(selectedInstancesForCopy)
                            if (checked) {
                              newSet.add(inst.id)
                            } else {
                              newSet.delete(inst.id)
                            }
                            setSelectedInstancesForCopy(newSet)
                          }}
                        />
                        <span className="flex items-center gap-2">
                          {inst.is_server ? (
                            <Server className="h-4 w-4" />
                          ) : (
                            <Gamepad2 className="h-4 w-4" />
                          )}
                          {inst.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleCopyToInstances}
                disabled={isCopying || selectedInstancesForCopy.size === 0}
              >
                {isCopying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {t("schematics.copy")} ({selectedInstancesForCopy.size})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("schematics.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("schematics.deleteConfirm", {
                  name: selectedSchematic?.schematic.name || "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Conflict Resolution Dialog */}
        <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {t("schematics.conflictTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("schematics.conflictDescription")}
              </DialogDescription>
            </DialogHeader>
            {currentConflict && (
              <div className="py-4 space-y-4">
                <div className="text-center">
                  <p className="font-medium">{currentConflict.schematic_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("schematics.conflictIn")} {currentConflict.instance_name}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 border rounded-md">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("schematics.libraryVersion")}
                    </p>
                    <p className="text-sm">{formatBytes(currentConflict.library_size)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(currentConflict.library_modified)}
                    </p>
                  </div>
                  <div className="p-3 border rounded-md">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("schematics.instanceVersion")}
                    </p>
                    <p className="text-sm">{formatBytes(currentConflict.instance_size)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(currentConflict.instance_modified)}
                    </p>
                  </div>
                </div>
                {conflicts.length > 1 && (
                  <p className="text-sm text-muted-foreground text-center">
                    {t("schematics.remainingConflicts", { count: conflicts.length - 1 })}
                  </p>
                )}
              </div>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleResolveConflict("keep_library")}
              >
                <Check className="h-4 w-4 mr-2" />
                {t("schematics.keepLibrary")}
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleResolveConflict("keep_instance")}
              >
                <Check className="h-4 w-4 mr-2" />
                {t("schematics.keepInstance")}
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleResolveConflict("keep_both")}
              >
                <Copy className="h-4 w-4 mr-2" />
                {t("schematics.keepBoth")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Tag Editor Dialog */}
        <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("schematics.editTags")}</DialogTitle>
              <DialogDescription>
                {t("schematics.editTagsDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {/* Existing tags */}
              <div className="flex flex-wrap gap-2 min-h-8">
                {editingTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {editingTags.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("schematics.noTagsYet")}
                  </p>
                )}
              </div>

              {/* Add new tag */}
              <div className="flex gap-2">
                <Input
                  placeholder={t("schematics.newTagPlaceholder")}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                />
                <Button variant="outline" size="icon" onClick={addTag}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Suggested tags */}
              {allTags.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("schematics.existingTags")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {allTags
                      .filter((tag) => !editingTags.includes(tag))
                      .slice(0, 10)
                      .map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="cursor-pointer hover:bg-secondary"
                          onClick={() => setEditingTags([...editingTags, tag])}
                        >
                          + {tag}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTagDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSaveTags}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Share Schematic Dialog */}
        <Dialog open={shareDialogOpen} onOpenChange={(open) => {
          // Just close the dialog without stopping the share
          // User can stop from the Sharing page
          if (!open) {
            setActiveShare(null)
          }
          setShareDialogOpen(open)
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                {t("schematics.shareTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("schematics.shareDescription")}
              </DialogDescription>
            </DialogHeader>

            {!activeShare ? (
              <div className="space-y-4 py-4">
                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    {t("schematics.shareProvider")}
                  </Label>
                  <Select value={shareProvider} onValueChange={(v) => setShareProvider(v as "bore" | "cloudflare")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bore">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/30">HTTP</Badge>
                          Bore
                        </div>
                      </SelectItem>
                      <SelectItem value="cloudflare">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">HTTPS</Badge>
                          Cloudflare
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    {t("schematics.sharePassword")} ({t("common.optional")})
                  </Label>
                  <Input
                    type="password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder={t("schematics.sharePasswordPlaceholder")}
                  />
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShareDialogOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!selectedSchematic) return
                      setIsSharing(true)
                      try {
                        const share = await invoke<SchematicShare>("start_schematic_share", {
                          schematicId: selectedSchematic.schematic.id,
                          provider: shareProvider,
                          password: sharePassword || null,
                        })
                        setActiveShare(share)
                        syncSharing() // Update sidebar badge
                        toast.success(t("schematics.shareStarted"))
                      } catch (err) {
                        console.error("Share failed:", err)
                        toast.error(t("schematics.shareError"))
                      } finally {
                        setIsSharing(false)
                      }
                    }}
                    disabled={isSharing}
                  >
                    {isSharing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    {t("schematics.startShare")}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4 py-4">
                <div className="p-4 bg-muted rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("schematics.shareLink")}</span>
                    {activeShare.public_url ? (
                      <Badge variant="default" className="bg-green-500">
                        {t("common.ready")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        {t("schematics.connecting")}
                      </Badge>
                    )}
                  </div>

                  {activeShare.public_url && (
                    <div className="flex gap-2">
                      <Input
                        value={activeShare.public_url}
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(activeShare.public_url!)
                          toast.success(t("common.copied"))
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t("schematics.downloads")}:</span>
                      <span className="ml-2 font-medium">{activeShare.download_count}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("schematics.uploaded")}:</span>
                      <span className="ml-2 font-medium">{formatBytes(activeShare.uploaded_bytes)}</span>
                    </div>
                  </div>

                  {activeShare.has_password && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-green-500" />
                      {t("schematics.passwordProtected")}
                    </div>
                  )}
                </div>

                <DialogFooter className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setActiveShare(null)
                      setShareDialogOpen(false)
                      toast.success(t("schematics.shareKeptActive"))
                    }}
                  >
                    {t("schematics.keepActive")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      try {
                        await invoke("stop_schematic_share", { shareId: activeShare.share_id })
                        setActiveShare(null)
                        setShareDialogOpen(false)
                        syncSharing() // Update sidebar badge
                        toast.success(t("schematics.shareStopped"))
                      } catch (err) {
                        console.error("Stop share failed:", err)
                      }
                    }}
                  >
                    {t("schematics.stopShare")}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Download from Link Dialog */}
        <Dialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                {t("schematics.downloadFromLink")}
              </DialogTitle>
              <DialogDescription>
                {t("schematics.downloadDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  {t("schematics.shareLink")}
                </Label>
                <Input
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">
                  {t("schematics.sharePassword")} ({t("common.optional")})
                </Label>
                <Input
                  type="password"
                  value={downloadPassword}
                  onChange={(e) => setDownloadPassword(e.target.value)}
                  placeholder={t("schematics.sharePasswordPlaceholder")}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDownloadDialogOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={async () => {
                  if (!downloadUrl.trim()) {
                    toast.error(t("schematics.enterUrl"))
                    return
                  }
                  setIsDownloading(true)
                  try {
                    const schematic = await invoke<Schematic>("download_shared_schematic", {
                      url: downloadUrl.trim(),
                      password: downloadPassword || null,
                    })
                    toast.success(t("schematics.downloadSuccess", { name: schematic.name }))
                    setDownloadDialogOpen(false)
                    await loadData()
                  } catch (err: any) {
                    console.error("Download failed:", err)
                    if (err.toString().includes("password")) {
                      toast.error(t("schematics.invalidPassword"))
                    } else {
                      toast.error(t("schematics.downloadError"))
                    }
                  } finally {
                    setIsDownloading(false)
                  }
                }}
                disabled={isDownloading || !downloadUrl.trim()}
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {t("schematics.downloadButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}

// Schematic Card Component - Memoized for performance
const SchematicCard = memo(function SchematicCard({
  item,
  isSelected,
  onSelect,
  onToggleFavorite,
}: {
  item: SchematicWithInstances
  isSelected: boolean
  onSelect: () => void
  onToggleFavorite: () => void
}) {
  const { schematic } = item

  return (
    <Card
      className={`cursor-pointer transition-all hover:border-primary/50 ${
        isSelected ? "border-primary bg-primary/5" : ""
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-secondary">
            <FileBox className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{schematic.name}</p>
              {schematic.is_favorite && (
                <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 flex-shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="secondary"
                className={`text-[10px] px-1.5 py-0 ${getFormatColor(schematic.format)}`}
              >
                {formatExtension(schematic.format)}
              </Badge>
              {schematic.dimensions && (
                <span>
                  {schematic.dimensions.width}x{schematic.dimensions.height}x
                  {schematic.dimensions.length}
                </span>
              )}
              <span>{formatBytes(schematic.file_size_bytes)}</span>
            </div>
          </div>

          {/* Instances indicator */}
          {item.instances.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="flex-shrink-0">
                  {item.instances.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {item.instances.map((i) => i.instance_name).join(", ")}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Favorite button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
          >
            <Star
              className={`h-4 w-4 ${
                schematic.is_favorite ? "fill-yellow-500 text-yellow-500" : ""
              }`}
            />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
})
