import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { toast } from "sonner"
import {
  Package,
  Loader2,
  Search,
  Trash2,
  ArrowUp,
  RefreshCw,
  FolderOpen,
  Grid3X3,
  List,
  SortAsc,
  SortDesc,
  Filter,
  ChevronDown,
  ExternalLink,
  Check,
  X,
  MoreVertical,
  CloudDownload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/i18n"
import { cn } from "@/lib/utils"

// Types
interface ModInfo {
  name: string
  version: string
  filename: string
  enabled: boolean
  icon_url: string | null
  project_id: string | null
}

interface ModUpdateInfo {
  project_id: string
  filename: string
  current_version: string
  current_version_id: string | null
  latest_version: string
  latest_version_id: string
  name: string
  icon_url: string | null
}

interface SyncProgress {
  stage: string
  current: number
  total: number
  message: string
}

interface SyncResult {
  total_mods: number
  synced_by_hash: number
  synced_by_search: number
  already_synced: number
  not_found: number
  errors: string[]
  synced_mods: {
    filename: string
    name: string
    project_id: string
    method: string
    confidence: number
  }[]
}

type ViewMode = "list" | "grid"
type SortOption = "name-asc" | "name-desc" | "enabled-first" | "disabled-first" | "updates-first"
type FilterOption = "all" | "enabled" | "disabled" | "with-updates"

interface ModsListProps {
  instanceId: string
  contentType: "mods" | "plugins"
  onOpenFolder: () => void
  onModsChange?: () => void
}

// Constants
const ITEMS_PER_BATCH = 20
const MODRINTH_PROJECT_URL = "https://modrinth.com/mod"

export function ModsList({ instanceId, contentType, onOpenFolder, onModsChange }: ModsListProps) {
  const { t } = useTranslation()

  // Data state
  const [mods, setMods] = useState<ModInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [modUpdates, setModUpdates] = useState<ModUpdateInfo[]>([])
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [updatingMods, setUpdatingMods] = useState<Set<string>>(new Set())

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)

  // UI state
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [sortOption, setSortOption] = useState<SortOption>("name-asc")
  const [filterOption, setFilterOption] = useState<FilterOption>("all")
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set())
  const [isDeletingSelected, setIsDeletingSelected] = useState(false)
  const [modToDelete, setModToDelete] = useState<string | null>(null)

  // Infinite scroll state
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_BATCH)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Load mods from backend
  const loadMods = useCallback(async () => {
    setIsLoading(true)
    try {
      const modsData = await invoke<ModInfo[]>("get_instance_mods", { instanceId })
      setMods(modsData)
    } catch (err) {
      console.error("[ModsList] Failed to load mods:", err)
      toast.error(t("errors.loadError"))
    } finally {
      setIsLoading(false)
    }
  }, [instanceId, t])

  // Initial load
  useEffect(() => {
    loadMods()
  }, [loadMods])

  // Filter mods
  const filteredMods = useMemo(() => {
    let result = [...mods]

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (mod) =>
          mod.name.toLowerCase().includes(query) ||
          mod.filename.toLowerCase().includes(query)
      )
    }

    // Apply status filter
    switch (filterOption) {
      case "enabled":
        result = result.filter((mod) => mod.enabled)
        break
      case "disabled":
        result = result.filter((mod) => !mod.enabled)
        break
      case "with-updates":
        result = result.filter((mod) =>
          modUpdates.some((u) => u.project_id === mod.project_id)
        )
        break
    }

    // Apply sorting
    switch (sortOption) {
      case "name-asc":
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case "name-desc":
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case "enabled-first":
        result.sort((a, b) => {
          if (a.enabled === b.enabled) return a.name.localeCompare(b.name)
          return a.enabled ? -1 : 1
        })
        break
      case "disabled-first":
        result.sort((a, b) => {
          if (a.enabled === b.enabled) return a.name.localeCompare(b.name)
          return a.enabled ? 1 : -1
        })
        break
      case "updates-first":
        result.sort((a, b) => {
          const aHasUpdate = modUpdates.some((u) => u.project_id === a.project_id)
          const bHasUpdate = modUpdates.some((u) => u.project_id === b.project_id)
          if (aHasUpdate === bHasUpdate) return a.name.localeCompare(b.name)
          return aHasUpdate ? -1 : 1
        })
        break
    }

    return result
  }, [mods, searchQuery, filterOption, sortOption, modUpdates])

  // Visible mods (for infinite scroll)
  const visibleMods = useMemo(() => {
    return filteredMods.slice(0, visibleCount)
  }, [filteredMods, visibleCount])

  const hasMore = visibleCount < filteredMods.length

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(ITEMS_PER_BATCH)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [searchQuery, filterOption, sortOption])

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          setVisibleCount((prev) => prev + ITEMS_PER_BATCH)
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, isLoading])

  // Get update info for a mod
  const getModUpdate = useCallback(
    (mod: ModInfo) => {
      return modUpdates.find((u) => u.project_id === mod.project_id)
    },
    [modUpdates]
  )

  // Check for updates
  const checkModUpdates = useCallback(async () => {
    if (mods.length === 0) return
    setIsCheckingUpdates(true)
    try {
      const projectType = contentType === "plugins" ? "plugin" : "mod"
      const updates = await invoke<ModUpdateInfo[]>("check_mod_updates", {
        instanceId,
        projectType,
      })
      setModUpdates(updates)
      if (updates.length > 0) {
        toast.success(t("instanceDetails.updatesFound", { count: String(updates.length) }))
      } else {
        toast.info(t("instanceDetails.noUpdatesFound"))
      }
    } catch (err) {
      console.error("[ModsList] Failed to check updates:", err)
      toast.error(t("instanceDetails.checkUpdatesError"))
    } finally {
      setIsCheckingUpdates(false)
    }
  }, [instanceId, mods.length, contentType, t])

  // Sync mod metadata from Modrinth
  const syncModsMetadata = useCallback(async (force: boolean = false) => {
    if (mods.length === 0) return
    setIsSyncing(true)
    setSyncProgress(null)

    let unlisten: UnlistenFn | null = null

    try {
      // Listen to progress events
      unlisten = await listen<SyncProgress>("mod-sync-progress", (event) => {
        setSyncProgress(event.payload)
      })

      const result = await invoke<SyncResult>("sync_mods_metadata", {
        instanceId,
        force,
      })

      const synced = result.synced_by_hash + result.synced_by_search
      if (synced > 0) {
        toast.success(t("modsList.syncSuccess", {
          count: String(synced),
          hash: String(result.synced_by_hash),
          search: String(result.synced_by_search),
        }))
        // Reload mods to get updated icons and info
        loadMods()
        onModsChange?.()
      } else if (result.already_synced === result.total_mods) {
        toast.info(t("modsList.allModsSynced"))
      } else if (result.not_found > 0) {
        toast.info(t("modsList.someModsNotFound", { count: String(result.not_found) }))
      }
    } catch (err) {
      console.error("[ModsList] Failed to sync mods:", err)
      toast.error(t("modsList.syncError"))
    } finally {
      if (unlisten) unlisten()
      setIsSyncing(false)
      setSyncProgress(null)
    }
  }, [instanceId, mods.length, t, loadMods, onModsChange])

  // Toggle mod enabled/disabled
  const handleToggleMod = useCallback(
    async (filename: string, enabled: boolean) => {
      try {
        await invoke("toggle_mod", { instanceId, filename, enabled })
        setMods((prev) =>
          prev.map((mod) =>
            mod.filename === filename ? { ...mod, enabled } : mod
          )
        )
        onModsChange?.()
      } catch (err) {
        console.error("[ModsList] Failed to toggle mod:", err)
        toast.error(t("instanceDetails.modToggleError"))
      }
    },
    [instanceId, onModsChange, t]
  )

  // Delete mod
  const confirmDeleteMod = useCallback(async () => {
    if (!modToDelete) return
    try {
      await invoke("delete_mod", { instanceId, filename: modToDelete })
      setMods((prev) => prev.filter((mod) => mod.filename !== modToDelete))
      setSelectedMods((prev) => {
        const next = new Set(prev)
        next.delete(modToDelete)
        return next
      })
      toast.success(t("notifications.modDeleted"))
      onModsChange?.()
    } catch (err) {
      console.error("[ModsList] Failed to delete mod:", err)
      toast.error(t("instanceDetails.modDeleteError"))
    } finally {
      setModToDelete(null)
    }
  }, [instanceId, modToDelete, onModsChange, t])

  // Update single mod
  const handleUpdateMod = useCallback(
    async (update: ModUpdateInfo) => {
      if (!update.project_id) return
      setUpdatingMods((prev) => new Set([...prev, update.project_id]))
      try {
        const projectType = contentType === "plugins" ? "plugin" : "mod"
        await invoke("update_mod", {
          instanceId,
          projectId: update.project_id,
          currentFilename: update.filename,
          newVersionId: update.latest_version_id,
          projectType,
        })
        toast.success(t("instanceDetails.modUpdated", { name: update.name }))
        setModUpdates((prev) => prev.filter((u) => u.project_id !== update.project_id))
        loadMods()
        onModsChange?.()
      } catch (err) {
        console.error("[ModsList] Failed to update mod:", err)
        toast.error(t("instanceDetails.modUpdateError", { name: update.name }))
      } finally {
        setUpdatingMods((prev) => {
          const next = new Set(prev)
          next.delete(update.project_id)
          return next
        })
      }
    },
    [instanceId, contentType, loadMods, onModsChange, t]
  )

  // Update all mods
  const handleUpdateAllMods = useCallback(async () => {
    for (const update of modUpdates) {
      await handleUpdateMod(update)
    }
  }, [modUpdates, handleUpdateMod])

  // Selection handlers
  const toggleModSelection = useCallback((filename: string) => {
    setSelectedMods((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) {
        next.delete(filename)
      } else {
        next.add(filename)
      }
      return next
    })
  }, [])

  const selectAllMods = useCallback(() => {
    setSelectedMods(new Set(filteredMods.map((m) => m.filename)))
  }, [filteredMods])

  const deselectAllMods = useCallback(() => {
    setSelectedMods(new Set())
  }, [])

  // Delete selected mods
  const handleDeleteSelectedMods = useCallback(async () => {
    if (selectedMods.size === 0) return
    setIsDeletingSelected(true)
    try {
      let deleted = 0
      for (const filename of selectedMods) {
        await invoke("delete_mod", { instanceId, filename })
        deleted++
      }
      toast.success(t("instanceDetails.modsDeleted", { count: String(deleted) }))
      setSelectedMods(new Set())
      loadMods()
      onModsChange?.()
    } catch (err) {
      toast.error(t("instanceDetails.modDeleteError"))
      console.error("[ModsList] Failed to delete mods:", err)
    } finally {
      setIsDeletingSelected(false)
    }
  }, [instanceId, selectedMods, loadMods, onModsChange, t])

  // Update selected mods
  const handleUpdateSelectedMods = useCallback(async () => {
    const selectedUpdates = modUpdates.filter((u) => {
      const mod = mods.find((m) => m.project_id === u.project_id)
      return mod && selectedMods.has(mod.filename)
    })
    if (selectedUpdates.length === 0) {
      toast.info(t("instanceDetails.noUpdatesForSelected"))
      return
    }
    for (const update of selectedUpdates) {
      await handleUpdateMod(update)
    }
    setSelectedMods(new Set())
  }, [modUpdates, mods, selectedMods, handleUpdateMod, t])

  // Open Modrinth project page
  const openModrinthPage = useCallback((projectId: string) => {
    window.open(`${MODRINTH_PROJECT_URL}/${projectId}`, "_blank")
  }, [])

  // Sort label helper
  const getSortLabel = (option: SortOption) => {
    switch (option) {
      case "name-asc":
        return t("modsList.sortNameAsc")
      case "name-desc":
        return t("modsList.sortNameDesc")
      case "enabled-first":
        return t("modsList.sortEnabledFirst")
      case "disabled-first":
        return t("modsList.sortDisabledFirst")
      case "updates-first":
        return t("modsList.sortUpdatesFirst")
    }
  }

  // Filter label helper
  const getFilterLabel = (option: FilterOption) => {
    switch (option) {
      case "all":
        return t("modsList.filterAll")
      case "enabled":
        return t("modsList.filterEnabled")
      case "disabled":
        return t("modsList.filterDisabled")
      case "with-updates":
        return t("modsList.filterWithUpdates")
    }
  }

  // Count helpers
  const enabledCount = useMemo(() => mods.filter((m) => m.enabled).length, [mods])
  const disabledCount = useMemo(() => mods.filter((m) => !m.enabled).length, [mods])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {t("instanceDetails.installedMods")}
              {mods.length > 0 && (
                <Badge variant="secondary">{mods.length}</Badge>
              )}
            </h3>
            {modUpdates.length > 0 && (
              <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                {modUpdates.length} {t("instanceDetails.updatesAvailable")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {modUpdates.length > 0 && (
              <Button
                variant="default"
                size="sm"
                onClick={handleUpdateAllMods}
                disabled={updatingMods.size > 0}
                className="gap-2 bg-green-500 hover:bg-green-600"
              >
                <ArrowUp className="h-4 w-4" />
                {t("instanceDetails.updateAll")}
              </Button>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncModsMetadata(false)}
                    disabled={isSyncing || mods.length === 0}
                    className="gap-2"
                  >
                    {isSyncing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CloudDownload className="h-4 w-4" />
                    )}
                    {isSyncing && syncProgress
                      ? `${syncProgress.current}/${syncProgress.total}`
                      : t("modsList.syncMods")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p>{t("modsList.syncModsTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="outline"
              size="sm"
              onClick={checkModUpdates}
              disabled={isCheckingUpdates || mods.length === 0}
              className="gap-2"
            >
              {isCheckingUpdates ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("instanceDetails.checkUpdates")}
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenFolder} className="gap-2">
              <FolderOpen className="h-4 w-4" />
              {t("common.openFolder")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Toolbar */}
        {mods.length > 0 && (
          <div className="space-y-3 mb-3">
            {/* Search and view options */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("instanceDetails.searchMods")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* View mode toggle */}
              <TooltipProvider>
                <div className="flex items-center border rounded-md">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={viewMode === "list" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setViewMode("list")}
                        className="h-9 px-2.5 rounded-r-none"
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("modsList.viewList")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={viewMode === "grid" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setViewMode("grid")}
                        className="h-9 px-2.5 rounded-l-none border-l"
                      >
                        <Grid3X3 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("modsList.viewGrid")}</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>

              {/* Sort dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-9">
                    {sortOption.includes("asc") ? (
                      <SortAsc className="h-4 w-4" />
                    ) : (
                      <SortDesc className="h-4 w-4" />
                    )}
                    {t("modsList.sort")}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("modsList.sortBy")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={sortOption}
                    onValueChange={(value) => setSortOption(value as SortOption)}
                  >
                    <DropdownMenuRadioItem value="name-asc">
                      {getSortLabel("name-asc")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="name-desc">
                      {getSortLabel("name-desc")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="enabled-first">
                      {getSortLabel("enabled-first")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="disabled-first">
                      {getSortLabel("disabled-first")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="updates-first">
                      {getSortLabel("updates-first")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Filter dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={filterOption !== "all" ? "secondary" : "outline"}
                    size="sm"
                    className="gap-2 h-9"
                  >
                    <Filter className="h-4 w-4" />
                    {t("modsList.filter")}
                    {filterOption !== "all" && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                        1
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("modsList.filterBy")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={filterOption}
                    onValueChange={(value) => setFilterOption(value as FilterOption)}
                  >
                    <DropdownMenuRadioItem value="all">
                      {getFilterLabel("all")} ({mods.length})
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="enabled">
                      {getFilterLabel("enabled")} ({enabledCount})
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="disabled">
                      {getFilterLabel("disabled")} ({disabledCount})
                    </DropdownMenuRadioItem>
                    {modUpdates.length > 0 && (
                      <DropdownMenuRadioItem value="with-updates">
                        {getFilterLabel("with-updates")} ({modUpdates.length})
                      </DropdownMenuRadioItem>
                    )}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Batch actions bar */}
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all-mods"
                  checked={selectedMods.size > 0 && selectedMods.size === filteredMods.length}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      selectAllMods()
                    } else {
                      deselectAllMods()
                    }
                  }}
                />
                <label htmlFor="select-all-mods" className="text-muted-foreground cursor-pointer">
                  {selectedMods.size > 0
                    ? t("instanceDetails.selectedCount", { count: String(selectedMods.size) })
                    : t("instanceDetails.selectAll")}
                </label>
              </div>
              {selectedMods.size > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  {modUpdates.some((u) => {
                    const mod = mods.find((m) => m.project_id === u.project_id)
                    return mod && selectedMods.has(mod.filename)
                  }) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUpdateSelectedMods}
                      disabled={updatingMods.size > 0}
                      className="gap-1 h-7 text-xs"
                    >
                      <ArrowUp className="h-3 w-3" />
                      {t("instanceDetails.updateSelected")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteSelectedMods}
                    disabled={isDeletingSelected}
                    className="gap-1 h-7 text-xs text-destructive hover:text-destructive"
                  >
                    {isDeletingSelected ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    {t("instanceDetails.deleteSelected")}
                  </Button>
                </div>
              )}
              {/* Stats summary */}
              <div className="hidden md:flex items-center gap-3 ml-auto text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-green-500" />
                  {enabledCount} {t("modsList.enabled")}
                </span>
                <span className="flex items-center gap-1">
                  <X className="h-3 w-3 text-red-500" />
                  {disabledCount} {t("modsList.disabled")}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8 flex-1">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : mods.length === 0 ? (
          <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">{t("instanceDetails.noModInstalled")}</p>
            <p className="text-sm text-muted-foreground">{t("instanceDetails.useModrinth")}</p>
          </div>
        ) : filteredMods.length === 0 ? (
          <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t("instances.noResults")}</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto" ref={scrollContainerRef}>
            {viewMode === "list" ? (
              // List view
              <div className="space-y-2 pr-2">
                {visibleMods.map((mod) => {
                  const update = getModUpdate(mod)
                  const isUpdating = mod.project_id ? updatingMods.has(mod.project_id) : false

                  return (
                    <div
                      key={mod.filename}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border transition-all",
                        !mod.enabled && "opacity-60 bg-muted/30",
                        update && "border-green-500/50 bg-green-500/5",
                        selectedMods.has(mod.filename) && "bg-accent/50 border-primary/50"
                      )}
                    >
                      <Checkbox
                        checked={selectedMods.has(mod.filename)}
                        onCheckedChange={() => toggleModSelection(mod.filename)}
                        className="flex-shrink-0"
                      />
                      {mod.icon_url ? (
                        <img
                          src={mod.icon_url}
                          alt={mod.name}
                          className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{mod.name}</p>
                          {!mod.enabled && (
                            <Badge variant="secondary" className="text-xs">
                              {t("modsList.disabled")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground truncate">{mod.version}</p>
                          {update && (
                            <Badge variant="outline" className="text-xs text-green-500 border-green-500/50">
                              → {update.latest_version}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {update && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleUpdateMod(update)}
                            disabled={isUpdating}
                            className="gap-1 bg-green-500 hover:bg-green-600"
                          >
                            {isUpdating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )}
                            {t("common.update")}
                          </Button>
                        )}
                        <Switch
                          checked={mod.enabled}
                          onCheckedChange={(checked) => handleToggleMod(mod.filename, checked)}
                        />
                        {/* More actions dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {mod.project_id && (
                              <DropdownMenuItem onClick={() => openModrinthPage(mod.project_id!)}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t("modsList.viewOnModrinth")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setModToDelete(mod.filename)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              // Grid view
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pr-2">
                {visibleMods.map((mod) => {
                  const update = getModUpdate(mod)
                  const isUpdating = mod.project_id ? updatingMods.has(mod.project_id) : false

                  return (
                    <div
                      key={mod.filename}
                      className={cn(
                        "relative flex flex-col p-3 rounded-lg border transition-all group",
                        !mod.enabled && "opacity-60 bg-muted/30",
                        update && "border-green-500/50 bg-green-500/5",
                        selectedMods.has(mod.filename) && "bg-accent/50 border-primary/50"
                      )}
                    >
                      {/* Selection checkbox (top left) */}
                      <div className="absolute top-2 left-2 z-10">
                        <Checkbox
                          checked={selectedMods.has(mod.filename)}
                          onCheckedChange={() => toggleModSelection(mod.filename)}
                          className="bg-background/80"
                        />
                      </div>

                      {/* Actions (top right) */}
                      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-7 w-7"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {mod.project_id && (
                              <DropdownMenuItem onClick={() => openModrinthPage(mod.project_id!)}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t("modsList.viewOnModrinth")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setModToDelete(mod.filename)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Icon */}
                      <div className="flex justify-center mb-3 pt-4">
                        {mod.icon_url ? (
                          <img
                            src={mod.icon_url}
                            alt={mod.name}
                            className="w-16 h-16 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                            <Package className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 text-center min-w-0">
                        <p className="font-medium text-sm truncate" title={mod.name}>
                          {mod.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{mod.version}</p>
                        {update && (
                          <Badge variant="outline" className="text-xs text-green-500 border-green-500/50 mt-1">
                            → {update.latest_version}
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-3 pt-2 border-t">
                        <Switch
                          checked={mod.enabled}
                          onCheckedChange={(checked) => handleToggleMod(mod.filename, checked)}
                        />
                        {update && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleUpdateMod(update)}
                            disabled={isUpdating}
                            className="gap-1 h-7 text-xs bg-green-500 hover:bg-green-600"
                          >
                            {isUpdating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Load more trigger */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* End of list indicator */}
            {!hasMore && filteredMods.length > ITEMS_PER_BATCH && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {t("modsList.showingAll", { count: String(filteredMods.length) })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!modToDelete} onOpenChange={(open) => !open && setModToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("instanceDetails.confirmDeleteMod")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("instanceDetails.confirmDeleteModDesc", {
                name: mods.find((m) => m.filename === modToDelete)?.name || modToDelete || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteMod}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
