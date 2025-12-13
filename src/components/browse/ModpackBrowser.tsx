import { useState, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Search, Download, Loader2, Package, ChevronLeft, ChevronRight, X, SlidersHorizontal, Check, RefreshCw, ExternalLink, LayoutGrid, List, LayoutList } from "lucide-react"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslation, type TranslationKey } from "@/i18n"
import { useInstallationStore } from "@/stores/installationStore"

interface ModpackSearchResult {
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

interface ModpackSearchResponse {
  results: ModpackSearchResult[]
  total_hits: number
}

interface ModpackVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  downloads: number
  date_published: string
}

interface ModpackInstallResult {
  instance_id: string
  name: string
  mc_version: string
  loader: string | null
  loader_version: string | null
  files_count: number
}

interface ModpackBrowserProps {
  onInstalled?: () => void
}

// Categories for modpacks
const MODPACK_CATEGORIES: { value: string; labelKey: TranslationKey }[] = [
  { value: "adventure", labelKey: "modrinth.categoryAdventure" },
  { value: "challenging", labelKey: "modpack.categoryChallenging" },
  { value: "combat", labelKey: "modpack.categoryCombat" },
  { value: "kitchen-sink", labelKey: "modpack.categoryKitchenSink" },
  { value: "lightweight", labelKey: "modpack.categoryLightweight" },
  { value: "magic", labelKey: "modrinth.categoryMagic" },
  { value: "multiplayer", labelKey: "modpack.categoryMultiplayer" },
  { value: "optimization", labelKey: "modrinth.categoryOptimization" },
  { value: "quests", labelKey: "modpack.categoryQuests" },
  { value: "technology", labelKey: "modrinth.categoryTechnology" },
]

const SORT_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "relevance", labelKey: "modrinth.sortRelevance" },
  { value: "downloads", labelKey: "modrinth.sortDownloads" },
  { value: "follows", labelKey: "modrinth.sortFollows" },
  { value: "newest", labelKey: "modrinth.sortNewest" },
  { value: "updated", labelKey: "modrinth.sortUpdated" },
]

const LOADER_FILTERS = [
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "quilt", label: "Quilt" },
]

// View modes
type ViewMode = "grid" | "list" | "compact"
const VIEW_MODE_STORAGE_KEY = "kaizen_browse_view_mode"

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

export function ModpackBrowser({ onInstalled }: ModpackBrowserProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ModpackSearchResult[]>([])
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

  // Installed modpacks tracking
  const [installedModpackIds, setInstalledModpackIds] = useState<Set<string>>(new Set())

  // Filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<string>("downloads")
  const [selectedLoader, setSelectedLoader] = useState<string>("")

  // Pagination
  const ITEMS_PER_PAGE = 20
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.ceil(totalHits / ITEMS_PER_PAGE)

  // Global installation store
  const { startInstallation } = useInstallationStore()

  // Version selection dialog
  const [selectedModpack, setSelectedModpack] = useState<ModpackSearchResult | null>(null)
  const [modpackVersions, setModpackVersions] = useState<ModpackVersion[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string>("")

  // Search function
  const performSearch = useCallback(async (query: string, cats: string[], sort: string, loader: string, page: number = 1) => {
    setIsSearching(true)
    setHasSearched(true)
    try {
      const offset = (page - 1) * ITEMS_PER_PAGE
      const response = await invoke<ModpackSearchResponse>("search_modrinth_mods", {
        query: query,
        gameVersion: null,
        loader: loader || null,
        projectType: "modpack",
        categories: cats.length > 0 ? cats : null,
        sortBy: sort,
        offset: offset,
        limit: ITEMS_PER_PAGE,
      })
      setSearchResults(response.results)
      setTotalHits(response.total_hits)
      setCurrentPage(page)
    } catch (err) {
      console.error("Failed to search modpacks:", err)
      setSearchResults([])
      setTotalHits(0)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Load installed modpack IDs
  const loadInstalledModpacks = useCallback(async () => {
    try {
      const ids = await invoke<string[]>("get_installed_modpack_ids")
      setInstalledModpackIds(new Set(ids))
    } catch (err) {
      console.error("Failed to load installed modpacks:", err)
    }
  }, [])

  // Debounce search query
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 300)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchQuery])

  // Trigger search when debounced query changes
  useEffect(() => {
    if (hasSearched) {
      performSearch(debouncedQuery, selectedCategories, sortBy, selectedLoader, 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  // Load popular modpacks and installed IDs on mount
  useEffect(() => {
    loadInstalledModpacks()
    performSearch("", [], "downloads", "", 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = useCallback(async () => {
    await performSearch(searchQuery, selectedCategories, sortBy, selectedLoader, 1)
  }, [searchQuery, selectedCategories, sortBy, selectedLoader, performSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  // Filter handlers
  const handleCategoryToggle = (category: string) => {
    const newCategories = selectedCategories.includes(category)
      ? selectedCategories.filter(c => c !== category)
      : [...selectedCategories, category]
    setSelectedCategories(newCategories)
    performSearch(searchQuery, newCategories, sortBy, selectedLoader, 1)
  }

  const handleSortChange = (value: string) => {
    setSortBy(value)
    performSearch(searchQuery, selectedCategories, value, selectedLoader, 1)
  }

  const handleLoaderChange = (value: string) => {
    const newLoader = value === "all" ? "" : value
    setSelectedLoader(newLoader)
    performSearch(searchQuery, selectedCategories, sortBy, newLoader, 1)
  }

  const clearFilters = () => {
    setSelectedCategories([])
    setSortBy("downloads")
    setSelectedLoader("")
    performSearch(searchQuery, [], "downloads", "", 1)
  }

  // Pagination handlers
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      performSearch(searchQuery, selectedCategories, sortBy, selectedLoader, page)
    }
  }

  const getPageNumbers = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push("ellipsis")
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (currentPage < totalPages - 2) pages.push("ellipsis")
      pages.push(totalPages)
    }
    return pages
  }

  // Modpack selection
  const handleSelectModpack = async (modpack: ModpackSearchResult) => {
    console.log(`[ModpackBrowser] Selected modpack: ${modpack.title} (${modpack.project_id})`)
    setSelectedModpack(modpack)
    setIsLoadingVersions(true)
    setModpackVersions([])
    setSelectedVersion("")

    try {
      const versions = await invoke<ModpackVersion[]>("get_modrinth_mod_versions", {
        projectId: modpack.project_id,
        gameVersion: null,
        loader: null,
      })
      console.log(`[ModpackBrowser] Loaded ${versions.length} versions for ${modpack.title}`)
      setModpackVersions(versions)
      if (versions.length > 0) {
        setSelectedVersion(versions[0].id)
      }
    } catch (err) {
      console.error("[ModpackBrowser] Failed to load versions:", err)
      toast.error(t("errors.loadError"))
    } finally {
      setIsLoadingVersions(false)
    }
  }

  // Install modpack
  const handleInstall = async () => {
    if (!selectedModpack || !selectedVersion) return

    console.log(`[ModpackBrowser] Installing modpack: ${selectedModpack.title} (version: ${selectedVersion})`)

    // Start tracking in global store with modpack prefix
    const trackingId = `modpack_${selectedModpack.project_id}`
    startInstallation(trackingId, selectedModpack.title, "modpack")

    // Close the version selection dialog
    setSelectedModpack(null)

    try {
      // Step 1: Install modpack files
      const result = await invoke<ModpackInstallResult>("install_modrinth_modpack", {
        projectId: selectedModpack.project_id,
        versionId: selectedVersion,
        instanceName: null,
      })

      console.log(`[ModpackBrowser] Modpack files installed, instance ID: ${result.instance_id}`)

      // Migrate tracking from temporary ID to real instance ID
      const store = useInstallationStore.getState()
      store.migrateInstallation(trackingId, result.instance_id)
      store.setStep(result.instance_id, "minecraft")

      // Step 2: Install Minecraft with the loader
      console.log(`[ModpackBrowser] Installing Minecraft for modpack instance: ${result.instance_id}`)
      await invoke("install_instance", {
        instanceId: result.instance_id,
      })

      console.log(`[ModpackBrowser] Modpack installation completed: ${selectedModpack.title}`)
      // Refresh the installed modpacks list
      loadInstalledModpacks()
      onInstalled?.()
    } catch (err) {
      console.error("[ModpackBrowser] Failed to install modpack:", err)
      toast.error(`${t("common.error")}: ${err}`)
      // Cancel the installation tracking on error
      useInstallationStore.getState().cancelInstallation(trackingId)
    }
  }

  const formatDownloads = (downloads: number): string => {
    if (downloads >= 1000000) return `${(downloads / 1000000).toFixed(1)}M`
    if (downloads >= 1000) return `${(downloads / 1000).toFixed(1)}K`
    return downloads.toString()
  }

  const activeFiltersCount = selectedCategories.length + (sortBy !== "downloads" ? 1 : 0) + (selectedLoader ? 1 : 0)

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("modpack.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-10"
          />
        </div>
        <Button onClick={handleSearch} disabled={isSearching}>
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : t("modrinth.search")}
        </Button>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {/* Sort dropdown */}
        <Select value={sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("modrinth.sortBy")} />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Loader filter */}
        <Select value={selectedLoader || "all"} onValueChange={handleLoaderChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Loader" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("modpack.allLoaders")}</SelectItem>
            {LOADER_FILTERS.map((loader) => (
              <SelectItem key={loader.value} value={loader.value}>
                {loader.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("browse.categories")}
              {selectedCategories.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                  {selectedCategories.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <div className="p-3 border-b">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{t("modrinth.filterByCategory")}</span>
                {selectedCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-1 text-xs"
                    onClick={() => {
                      setSelectedCategories([])
                      performSearch(searchQuery, [], sortBy, selectedLoader, 1)
                    }}
                  >
                    {t("modrinth.clearAll")}
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="h-[240px]">
              <div className="p-2 space-y-1">
                {MODPACK_CATEGORIES.map((cat) => {
                  const isSelected = selectedCategories.includes(cat.value)
                  return (
                    <div
                      key={cat.value}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent ${
                        isSelected ? "bg-accent" : ""
                      }`}
                      onClick={() => handleCategoryToggle(cat.value)}
                    >
                      <Checkbox checked={isSelected} />
                      <span className="text-sm">{t(cat.labelKey)}</span>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {/* Clear filters */}
        {activeFiltersCount > 0 && (
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
            const catInfo = MODPACK_CATEGORIES.find(c => c.value === cat)
            return (
              <Badge
                key={cat}
                variant="secondary"
                className="gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => handleCategoryToggle(cat)}
              >
                {catInfo ? t(catInfo.labelKey) : cat}
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
            <p className="text-muted-foreground">{t("modpack.noModpackFound")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchQuery || selectedCategories.length > 0
                ? t("modpack.tryDifferentSearch")
                : t("modpack.searchModpacks")}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          /* Grid View */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pr-4">
            {searchResults.map((modpack) => {
              const isInstalled = installedModpackIds.has(modpack.project_id)
              return (
                <Card
                  key={modpack.project_id}
                  className="overflow-hidden hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/browse/modpack/${modpack.project_id}`)}
                >
                  <CardContent className="p-3">
                    <div className="flex flex-col items-center text-center">
                      {/* Icon */}
                      <div className="relative mb-2">
                        {modpack.icon_url ? (
                          <img
                            src={modpack.icon_url}
                            alt={modpack.title}
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

                      {/* Info */}
                      <h4 className="font-medium text-sm truncate w-full">{modpack.title}</h4>
                      <p className="text-xs text-muted-foreground truncate w-full">{modpack.author}</p>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap justify-center">
                        <Badge variant="outline" className="text-xs">
                          {formatDownloads(modpack.downloads)}
                        </Badge>
                        {modpack.game_versions.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {modpack.game_versions[0]}
                          </Badge>
                        )}
                      </div>

                      {/* Install button on hover */}
                      <Button
                        size="sm"
                        variant={isInstalled ? "outline" : "default"}
                        className="mt-2 w-full opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectModpack(modpack)
                        }}
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
            {searchResults.map((modpack) => {
              const isInstalled = installedModpackIds.has(modpack.project_id)
              return (
                <div
                  key={modpack.project_id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/browse/modpack/${modpack.project_id}`)}
                >
                  {/* Icon */}
                  <div className="flex-shrink-0 relative">
                    {modpack.icon_url ? (
                      <img
                        src={modpack.icon_url}
                        alt={modpack.title}
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

                  {/* Info */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className="font-medium text-sm truncate min-w-[120px] max-w-[200px]">{modpack.title}</span>
                    <span className="text-xs text-muted-foreground truncate">{modpack.author}</span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {formatDownloads(modpack.downloads)}
                    </Badge>
                    {modpack.loaders[0] && (
                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                        {modpack.loaders[0]}
                      </Badge>
                    )}
                    {modpack.game_versions[0] && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {modpack.game_versions[0]}
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <Button
                    size="sm"
                    variant={isInstalled ? "outline" : "default"}
                    className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectModpack(modpack)
                    }}
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
            {searchResults.map((modpack) => {
              const isInstalled = installedModpackIds.has(modpack.project_id)
              return (
                <Card
                  key={modpack.project_id}
                  className="overflow-hidden hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/browse/modpack/${modpack.project_id}`)}
                >
                  <CardContent className="p-3">
                    <div className="flex gap-3">
                      {/* Icon */}
                      <div className="flex-shrink-0 relative">
                        {modpack.icon_url ? (
                          <img
                            src={modpack.icon_url}
                            alt={modpack.title}
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

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-medium text-sm truncate">{modpack.title}</h4>
                            <p className="text-xs text-muted-foreground">{t("modrinth.by")} {modpack.author}</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 h-8 px-2"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/browse/modpack/${modpack.project_id}`)
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant={isInstalled ? "outline" : "default"}
                              className="gap-1"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSelectModpack(modpack)
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
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {modpack.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {isInstalled && (
                            <Badge variant="default" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                              <Check className="h-2.5 w-2.5 mr-1" />
                              {t("modpack.installed")}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {formatDownloads(modpack.downloads)} DL
                          </Badge>
                          {modpack.loaders.slice(0, 2).map((loader) => (
                            <Badge key={loader} variant="secondary" className="text-xs">
                              {loader}
                            </Badge>
                          ))}
                          {modpack.game_versions.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {modpack.game_versions[0]}
                            </Badge>
                          )}
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

          <span className="ml-2 text-sm text-muted-foreground">
            {t("modpack.page", { current: String(currentPage), total: String(totalPages) })}
          </span>
        </div>
      )}

      {/* Version selection dialog */}
      <Dialog open={!!selectedModpack} onOpenChange={(open) => !open && setSelectedModpack(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedModpack?.icon_url && (
                <img
                  src={selectedModpack.icon_url}
                  alt={selectedModpack.title}
                  className="w-8 h-8 rounded"
                />
              )}
              {selectedModpack?.title}
              {selectedModpack && installedModpackIds.has(selectedModpack.project_id) && (
                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                  <Check className="h-2.5 w-2.5 mr-1" />
                  {t("modpack.installed")}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedModpack && installedModpackIds.has(selectedModpack.project_id)
                ? t("modpack.alreadyInstalled")
                : t("modpack.selectVersionInstall")}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {isLoadingVersions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : modpackVersions.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                {t("modpack.noVersionAvailable")}
              </p>
            ) : (
              <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                <SelectTrigger>
                  <SelectValue placeholder={t("modpack.selectVersion")} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {modpackVersions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      <div className="flex flex-col">
                        <span>{v.name || v.version_number}</span>
                        <span className="text-xs text-muted-foreground">
                          MC {v.game_versions.join(", ")} - {v.loaders.join(", ")}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedModpack(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleInstall}
              disabled={!selectedVersion || isLoadingVersions}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              {t("common.install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
