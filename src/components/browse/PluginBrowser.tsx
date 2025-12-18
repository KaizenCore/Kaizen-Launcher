import { useState, useCallback, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  Search,
  Download,
  Loader2,
  Package,
  ChevronLeft,
  ChevronRight,
  X,
  SlidersHorizontal,
  Check,
  RefreshCw,
  LayoutGrid,
  List,
  LayoutList,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslation } from "@/i18n"
import { type BrowseInstance, isPluginCompatible } from "@/pages/Browse"
import { useBrowseCache } from "@/hooks/useBrowseCache"

// Types
interface ModSearchResult {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
  game_versions: string[]
  loaders: string[]
}

interface ModVersionInfo {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  downloads: number
  date_published: string
}

// Component props
interface PluginBrowserProps {
  selectedInstance: BrowseInstance | null
}

// Constants
const ITEMS_PER_PAGE = 20

const SORT_OPTIONS = [
  { value: "relevance", labelKey: "modrinth.sortRelevance" as const },
  { value: "downloads", labelKey: "modrinth.sortDownloads" as const },
  { value: "newest", labelKey: "modrinth.sortNewest" as const },
  { value: "updated", labelKey: "modrinth.sortUpdated" as const },
]

const PLUGIN_CATEGORIES = [
  { value: "admin-tools", label: "Admin Tools" },
  { value: "anti-cheat", label: "Anti-Cheat" },
  { value: "chat", label: "Chat" },
  { value: "economy", label: "Economy" },
  { value: "gameplay", label: "Gameplay" },
  { value: "management", label: "Management" },
  { value: "minigame", label: "Minigames" },
  { value: "misc", label: "Misc" },
  { value: "moderation", label: "Moderation" },
  { value: "social", label: "Social" },
  { value: "teleportation", label: "Teleportation" },
  { value: "utility", label: "Utility" },
  { value: "world-management", label: "World Management" },
]

// View modes
type ViewMode = "grid" | "list" | "compact"
const VIEW_MODE_STORAGE_KEY = "kaizen_browse_plugins_view_mode"

function getStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (stored === "grid" || stored === "list" || stored === "compact") {
      return stored
    }
  } catch {
    // Ignore localStorage errors
  }
  return "list" // Default
}

// Helper to format download count
function formatDownloads(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}

export function PluginBrowser({ selectedInstance }: PluginBrowserProps) {
  const { t } = useTranslation()
  const isCompatible = isPluginCompatible(selectedInstance)
  const { searchWithCache, getVersionsWithCache, getInstalledWithCache, invalidateInstalledCache } =
    useBrowseCache<ModSearchResult, ModVersionInfo>()
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ModSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [totalHits, setTotalHits] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // View mode with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      // Ignore localStorage errors
    }
  }, [])

  // Installed plugins tracking
  const [installedPluginIds, setInstalledPluginIds] = useState<Set<string>>(new Set())

  // Filters
  const [sortBy, setSortBy] = useState("relevance")
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.ceil(totalHits / ITEMS_PER_PAGE)

  // Install dialog
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedPlugin, setSelectedPlugin] = useState<ModSearchResult | null>(null)
  const [pluginVersions, setPluginVersions] = useState<ModVersionInfo[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  // Load installed plugin IDs when instance changes
  useEffect(() => {
    if (!selectedInstance) {
      setInstalledPluginIds(new Set())
      return
    }

    const loadInstalledPlugins = async () => {
      try {
        console.log("[PluginBrowser] Loading installed plugins for instance:", selectedInstance.id)
        const ids = await getInstalledWithCache(selectedInstance.id, "plugin")
        setInstalledPluginIds(new Set(ids))
        console.log("[PluginBrowser] Loaded", ids.length, "installed plugin IDs")
      } catch (error) {
        console.error("[PluginBrowser] Failed to load installed plugin IDs:", error)
      }
    }
    loadInstalledPlugins()
  }, [selectedInstance, getInstalledWithCache])

  // Debounce search query
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setCurrentPage(1)
    }, 300)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchQuery])

  // Stabilize categories for dependency comparison
  const categoriesKey = JSON.stringify(selectedCategories)

  // Auto-search when filters change
  useEffect(() => {
    let cancelled = false

    const searchPlugins = async () => {
      setIsSearching(true)
      setHasSearched(true)

      try {
        console.log("[PluginBrowser] Searching plugins:", {
          query: debouncedQuery,
          loader: selectedInstance?.loader,
          gameVersion: selectedInstance?.mc_version,
          categories: selectedCategories,
          sortBy,
          page: currentPage,
        })

        const response = await searchWithCache({
          query: debouncedQuery,
          projectType: "plugin",
          loader: selectedInstance?.loader?.toLowerCase() || null,
          mcVersion: selectedInstance?.mc_version || null,
          categories: selectedCategories,
          sort: sortBy,
          offset: (currentPage - 1) * ITEMS_PER_PAGE,
          limit: ITEMS_PER_PAGE,
        })

        // Only update if not cancelled
        if (!cancelled) {
          setSearchResults(response.results)
          setTotalHits(response.total_hits)
          console.log("[PluginBrowser] Found", response.total_hits, "plugins")
        }
      } catch (error) {
        // Only show error if not cancelled
        if (!cancelled) {
          console.error("[PluginBrowser] Search failed:", error)
          toast.error(t("modrinth.searchError"))
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false)
        }
      }
    }

    searchPlugins()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, selectedInstance?.mc_version, selectedInstance?.loader, categoriesKey, sortBy, currentPage, searchWithCache])

  // Handle category toggle
  const handleCategoryToggle = useCallback((category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    )
    setCurrentPage(1)
  }, [])

  // Clear filters
  const clearFilters = useCallback(() => {
    setSelectedCategories([])
    setSortBy("relevance")
    setCurrentPage(1)
  }, [])

  // Pagination
  const goToPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }, [totalPages])

  const getPageNumbers = useCallback(() => {
    const pages: (number | "ellipsis")[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)
      if (currentPage > 3) {
        pages.push("ellipsis")
      }
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) {
        pages.push(i)
      }
      if (currentPage < totalPages - 2) {
        pages.push("ellipsis")
      }
      pages.push(totalPages)
    }

    return pages
  }, [currentPage, totalPages])

  // Open install dialog
  const handleSelectPlugin = useCallback(async (plugin: ModSearchResult) => {
    if (!selectedInstance) {
      toast.error(t("browse.selectInstance"))
      return
    }

    setSelectedPlugin(plugin)
    setInstallDialogOpen(true)
    setIsLoadingVersions(true)
    setSelectedVersion(null)

    try {
      console.log("[PluginBrowser] Loading versions for plugin:", plugin.project_id)
      const versions = await getVersionsWithCache(
        plugin.project_id,
        selectedInstance.mc_version,
        selectedInstance.loader?.toLowerCase()
      )
      setPluginVersions(versions)
      if (versions.length > 0) {
        setSelectedVersion(versions[0].id)
      }
      console.log("[PluginBrowser] Loaded", versions.length, "versions")
    } catch (error) {
      console.error("[PluginBrowser] Failed to load versions:", error)
      toast.error(t("browse.noCompatibleVersion"))
    } finally {
      setIsLoadingVersions(false)
    }
  }, [selectedInstance, t, getVersionsWithCache])

  // Install plugin
  const handleInstall = useCallback(async () => {
    if (!selectedPlugin || !selectedVersion || !selectedInstance) return

    setIsInstalling(true)
    try {
      console.log("[PluginBrowser] Installing plugin:", selectedPlugin.project_id, "version:", selectedVersion)
      const filename = await invoke<string>("install_modrinth_mod", {
        instanceId: selectedInstance.id,
        projectId: selectedPlugin.project_id,
        versionId: selectedVersion,
        projectType: "plugin",
      })

      toast.success(t("modrinth.modInstalled", { name: selectedPlugin.title }))
      setInstalledPluginIds((prev) => new Set([...prev, selectedPlugin.project_id]))
      invalidateInstalledCache(selectedInstance.id, "plugin")
      setInstallDialogOpen(false)
      console.log("[PluginBrowser] Installed:", filename)
    } catch (error) {
      console.error("[PluginBrowser] Install failed:", error)
      toast.error(t("browse.installError"))
    } finally {
      setIsInstalling(false)
    }
  }, [selectedPlugin, selectedVersion, selectedInstance, t, invalidateInstalledCache])

  const hasActiveFilters = selectedCategories.length > 0

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Search and filters row */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("browse.searchPlugins")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setCurrentPage(1) }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("browse.filters")}
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center">
                  {selectedCategories.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-4">
              {/* Categories */}
              <div>
                <h4 className="font-medium mb-2 text-sm">{t("browse.categories")}</h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {PLUGIN_CATEGORIES.map((cat) => (
                      <div key={cat.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={cat.value}
                          checked={selectedCategories.includes(cat.value)}
                          onCheckedChange={() => handleCategoryToggle(cat.value)}
                        />
                        <label
                          htmlFor={cat.value}
                          className="text-sm cursor-pointer"
                        >
                          {cat.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
            <X className="h-3 w-3" />
            {t("modrinth.clearFilters")}
          </Button>
        )}

        <div className="flex-1" />
        {hasSearched && (
          <Badge variant="secondary" className="text-xs">
            {totalHits} {t("modrinth.results")}
          </Badge>
        )}

        {/* View mode toggle */}
        <div className="flex border rounded-md">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2 rounded-r-none border-r"
            onClick={() => handleViewModeChange("grid")}
            title={t("browse.viewGrid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2 rounded-none border-r"
            onClick={() => handleViewModeChange("list")}
            title={t("browse.viewList")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "compact" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2 rounded-l-none"
            onClick={() => handleViewModeChange("compact")}
            title={t("browse.viewCompact")}
          >
            <LayoutList className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Selected categories chips */}
      {selectedCategories.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedCategories.map((cat) => {
            const catInfo = PLUGIN_CATEGORIES.find((c) => c.value === cat)
            return (
              <Badge
                key={cat}
                variant="secondary"
                className="cursor-pointer gap-1"
                onClick={() => handleCategoryToggle(cat)}
              >
                {catInfo?.label || cat}
                <X className="h-3 w-3" />
              </Badge>
            )
          })}
        </div>
      )}

      {/* Results */}
      <ScrollArea className="flex-1 min-h-0">
        {isSearching ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t("browse.noResults")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchQuery || selectedCategories.length > 0
                ? t("modpack.tryDifferentSearch")
                : t("browse.search")}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          /* Grid View */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pr-4">
            {searchResults.map((plugin) => {
              const isInstalled = installedPluginIds.has(plugin.project_id)
              return (
                <Card
                  key={plugin.project_id}
                  className="overflow-hidden hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => handleSelectPlugin(plugin)}
                >
                  <CardContent className="p-3">
                    <div className="flex flex-col items-center text-center">
                      <div className="relative mb-2">
                        {plugin.icon_url ? (
                          <img
                            src={plugin.icon_url}
                            alt={plugin.title}
                            className="w-16 h-16 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                            <Package className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {isInstalled && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                        )}
                      </div>
                      <h4 className="font-medium text-sm truncate w-full">{plugin.title}</h4>
                      <p className="text-xs text-muted-foreground truncate w-full">{plugin.author}</p>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap justify-center">
                        <Badge variant="outline" className="text-xs">
                          {formatDownloads(plugin.downloads)}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant={isInstalled ? "outline" : "default"}
                        className="mt-2 w-full opacity-0 group-hover:opacity-100 transition-opacity"
                        disabled={!selectedInstance || !isCompatible}
                      >
                        {isInstalled ? (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        ) : (
                          <Download className="h-3 w-3 mr-1" />
                        )}
                        {isInstalled ? t("modpack.otherVersion") : t("common.install")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : viewMode === "compact" ? (
          /* Compact View */
          <div className="space-y-1 pr-4">
            {searchResults.map((plugin) => {
              const isInstalled = installedPluginIds.has(plugin.project_id)
              return (
                <div
                  key={plugin.project_id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => handleSelectPlugin(plugin)}
                >
                  <div className="flex-shrink-0 relative">
                    {plugin.icon_url ? (
                      <img
                        src={plugin.icon_url}
                        alt={plugin.title}
                        className="w-8 h-8 rounded object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    {isInstalled && (
                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                        <Check className="h-2 w-2 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className="font-medium text-sm truncate min-w-[120px] max-w-[200px]">{plugin.title}</span>
                    <span className="text-xs text-muted-foreground truncate">{plugin.author}</span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {formatDownloads(plugin.downloads)}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant={isInstalled ? "outline" : "default"}
                    className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    disabled={!selectedInstance || !isCompatible}
                  >
                    {isInstalled ? <RefreshCw className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          /* List View (default) */
          <div className="space-y-2 pr-4">
            {searchResults.map((plugin) => {
              const isInstalled = installedPluginIds.has(plugin.project_id)
              return (
                <Card
                  key={plugin.project_id}
                  className="overflow-hidden hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => handleSelectPlugin(plugin)}
                >
                  <CardContent className="p-3">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 relative">
                        {plugin.icon_url ? (
                          <img
                            src={plugin.icon_url}
                            alt={plugin.title}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                            <Package className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        {isInstalled && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                            <Check className="h-2.5 w-2.5 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-medium text-sm truncate">{plugin.title}</h4>
                            <p className="text-xs text-muted-foreground">{t("modrinth.by")} {plugin.author}</p>
                          </div>
                          <Button
                            size="sm"
                            variant={isInstalled ? "outline" : "default"}
                            className="gap-1"
                            disabled={!selectedInstance || !isCompatible}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectPlugin(plugin)
                            }}
                          >
                            {isInstalled ? (
                              <>
                                <RefreshCw className="h-3 w-3" />
                                {t("modpack.otherVersion")}
                              </>
                            ) : (
                              <>
                                <Download className="h-3 w-3" />
                                {t("common.install")}
                              </>
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {plugin.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {isInstalled && (
                            <Badge variant="default" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                              <Check className="h-2.5 w-2.5 mr-1" />
                              {t("modpack.installed")}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {formatDownloads(plugin.downloads)} DL
                          </Badge>
                          {plugin.categories.slice(0, 2).map((cat) => (
                            <Badge key={cat} variant="secondary" className="text-xs">
                              {cat}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && searchResults.length > 0 && (
        <div className="flex items-center justify-center gap-1 pt-3 pb-1 border-t mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1 || isSearching}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {getPageNumbers().map((page, index) =>
            page === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">...</span>
            ) : (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => goToPage(page)}
                disabled={isSearching}
                className="h-8 w-8 p-0"
              >
                {page}
              </Button>
            )
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages || isSearching}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Install dialog */}
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedPlugin?.icon_url && (
                <img
                  src={selectedPlugin.icon_url}
                  alt={selectedPlugin.title}
                  className="w-8 h-8 rounded"
                />
              )}
              {selectedPlugin?.title}
            </DialogTitle>
            <DialogDescription>
              {t("modrinth.selectVersion")}
            </DialogDescription>
          </DialogHeader>

          {isLoadingVersions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : pluginVersions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("browse.noCompatibleVersion")}
            </div>
          ) : (
            <div className="space-y-2">
              <Select value={selectedVersion || ""} onValueChange={setSelectedVersion}>
                <SelectTrigger>
                  <SelectValue placeholder={t("modrinth.selectVersion")} />
                </SelectTrigger>
                <SelectContent>
                  {pluginVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      <div className="flex items-center gap-2">
                        <span>{version.version_number}</span>
                        <Badge variant="outline" className="text-xs">
                          {version.version_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {version.game_versions[0]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedVersion && (
                <div className="text-xs text-muted-foreground">
                  {t("modrinth.installingTo")}: <span className="font-medium">{selectedInstance?.name}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleInstall}
              disabled={!selectedVersion || isInstalling}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.loading")}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {t("common.install")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
