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
  LayoutList
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { BrowseInstance, isModCompatible } from "@/pages/Browse"
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
import { useBrowseCache } from "@/hooks/useBrowseCache"
import type { ModSearchResult, ModVersionInfo, ViewMode } from "@/types/browse"
import { SORT_OPTIONS, ITEMS_PER_PAGE } from "@/types/browse"
import { formatDownloads, getStoredViewMode, setStoredViewMode, getPageNumbers } from "@/lib/browse-utils"

// Props interface
interface ModBrowserProps {
  selectedInstance: BrowseInstance | null
}

const LOADER_FILTERS = [
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "quilt", label: "Quilt" },
]

const MOD_CATEGORIES = [
  { value: "adventure", label: "Adventure" },
  { value: "cursed", label: "Cursed" },
  { value: "decoration", label: "Decoration" },
  { value: "economy", label: "Economy" },
  { value: "equipment", label: "Equipment" },
  { value: "food", label: "Food" },
  { value: "game-mechanics", label: "Game Mechanics" },
  { value: "library", label: "Library" },
  { value: "magic", label: "Magic" },
  { value: "management", label: "Management" },
  { value: "minigame", label: "Minigames" },
  { value: "mobs", label: "Mobs" },
  { value: "optimization", label: "Optimization" },
  { value: "social", label: "Social" },
  { value: "storage", label: "Storage" },
  { value: "technology", label: "Technology" },
  { value: "transportation", label: "Transportation" },
  { value: "utility", label: "Utility" },
  { value: "worldgen", label: "World Gen" },
]

// View mode storage key (specific to ModBrowser)
const VIEW_MODE_STORAGE_KEY = "kaizen_browse_mods_view_mode"

export function ModBrowser({ selectedInstance }: ModBrowserProps) {
  const { t } = useTranslation()
  const { searchWithCache, getVersionsWithCache, getInstalledWithCache, invalidateInstalledCache } = useBrowseCache<ModSearchResult, ModVersionInfo>()
  const isCompatible = isModCompatible(selectedInstance)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ModSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [totalHits, setTotalHits] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // View mode with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => getStoredViewMode(VIEW_MODE_STORAGE_KEY))

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    setStoredViewMode(VIEW_MODE_STORAGE_KEY, mode)
  }, [])

  // Installed mods tracking
  const [installedModIds, setInstalledModIds] = useState<Set<string>>(new Set())

  // Filters
  const [sortBy, setSortBy] = useState("relevance")
  const [selectedLoader, setSelectedLoader] = useState<string | null>(null)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.ceil(totalHits / ITEMS_PER_PAGE)

  // Install dialog
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedMod, setSelectedMod] = useState<ModSearchResult | null>(null)
  const [modVersions, setModVersions] = useState<ModVersionInfo[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  // Load installed mod IDs when instance changes
  useEffect(() => {
    if (!selectedInstance) {
      setInstalledModIds(new Set())
      return
    }

    const loadInstalledMods = async () => {
      try {
        console.log("[ModBrowser] Loading installed mods for instance:", selectedInstance.id)
        const ids = await getInstalledWithCache(selectedInstance.id, "mod")
        setInstalledModIds(new Set(ids))
        console.log("[ModBrowser] Loaded", ids.length, "installed mod IDs")
      } catch (error) {
        console.error("[ModBrowser] Failed to load installed mod IDs:", error)
      }
    }
    loadInstalledMods()
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

    const searchMods = async () => {
      setIsSearching(true)
      setHasSearched(true)

      try {
        console.log("[ModBrowser] Searching mods:", {
          query: debouncedQuery,
          loader: selectedLoader || selectedInstance?.loader,
          gameVersion: selectedInstance?.mc_version,
          categories: selectedCategories,
          sortBy,
          page: currentPage,
        })

        const response = await searchWithCache({
          query: debouncedQuery,
          projectType: "mod",
          loader: selectedLoader || selectedInstance?.loader?.toLowerCase() || null,
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
          console.log("[ModBrowser] Found", response.total_hits, "mods")
        }
      } catch (error) {
        // Only show error if not cancelled
        if (!cancelled) {
          console.error("[ModBrowser] Search failed:", error)
          toast.error(t("modrinth.searchError"))
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false)
        }
      }
    }

    searchMods()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, selectedInstance?.mc_version, selectedInstance?.loader, selectedLoader, categoriesKey, sortBy, currentPage, searchWithCache])

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
    setSelectedLoader(null)
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

  // Open install dialog
  const handleSelectMod = useCallback(async (mod: ModSearchResult) => {
    if (!selectedInstance) {
      toast.error(t("browse.selectInstance"))
      return
    }

    setSelectedMod(mod)
    setInstallDialogOpen(true)
    setIsLoadingVersions(true)
    setSelectedVersion(null)

    try {
      console.log("[ModBrowser] Loading versions for mod:", mod.project_id)
      const versions = await getVersionsWithCache(
        mod.project_id,
        selectedInstance.mc_version,
        selectedInstance.loader?.toLowerCase()
      )
      setModVersions(versions)
      if (versions.length > 0) {
        setSelectedVersion(versions[0].id)
      }
      console.log("[ModBrowser] Loaded", versions.length, "versions")
    } catch (error) {
      console.error("[ModBrowser] Failed to load versions:", error)
      toast.error(t("browse.noCompatibleVersion"))
    } finally {
      setIsLoadingVersions(false)
    }
  }, [selectedInstance, t, getVersionsWithCache])

  // Install mod
  const handleInstall = useCallback(async () => {
    if (!selectedMod || !selectedVersion || !selectedInstance) return

    setIsInstalling(true)
    try {
      console.log("[ModBrowser] Installing mod:", selectedMod.project_id, "version:", selectedVersion)
      const filename = await invoke<string>("install_modrinth_mod", {
        instanceId: selectedInstance.id,
        projectId: selectedMod.project_id,
        versionId: selectedVersion,
        projectType: "mod",
      })

      toast.success(t("modrinth.modInstalled", { name: selectedMod.title }))
      setInstalledModIds((prev) => new Set([...prev, selectedMod.project_id]))
      invalidateInstalledCache(selectedInstance.id, "mod")
      setInstallDialogOpen(false)
      console.log("[ModBrowser] Installed:", filename)
    } catch (error) {
      console.error("[ModBrowser] Install failed:", error)
      toast.error(t("browse.installError"))
    } finally {
      setIsInstalling(false)
    }
  }, [selectedMod, selectedVersion, selectedInstance, t, invalidateInstalledCache])

  const hasActiveFilters = selectedLoader || selectedCategories.length > 0

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Search and filters row */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("browse.searchMods")}
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
                  {(selectedLoader ? 1 : 0) + selectedCategories.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-4">
              {/* Loader filter */}
              <div>
                <h4 className="font-medium mb-2 text-sm">{t("modrinth.loaders")}</h4>
                <div className="flex flex-wrap gap-2">
                  {LOADER_FILTERS.map((loader) => (
                    <Badge
                      key={loader.value}
                      variant={selectedLoader === loader.value ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedLoader(selectedLoader === loader.value ? null : loader.value)
                        setCurrentPage(1)
                      }}
                    >
                      {loader.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Categories */}
              <div>
                <h4 className="font-medium mb-2 text-sm">{t("browse.categories")}</h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {MOD_CATEGORIES.map((cat) => (
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
            const catInfo = MOD_CATEGORIES.find((c) => c.value === cat)
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
            {searchResults.map((mod) => {
              const isInstalled = installedModIds.has(mod.project_id)
              return (
                <Card
                  key={mod.project_id}
                  className="overflow-hidden hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => handleSelectMod(mod)}
                >
                  <CardContent className="p-3">
                    <div className="flex flex-col items-center text-center">
                      <div className="relative mb-2">
                        {mod.icon_url ? (
                          <img
                            src={mod.icon_url}
                            alt={mod.title}
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
                      <h4 className="font-medium text-sm truncate w-full">{mod.title}</h4>
                      <p className="text-xs text-muted-foreground truncate w-full">{mod.author}</p>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap justify-center">
                        <Badge variant="outline" className="text-xs">
                          {formatDownloads(mod.downloads)}
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
            {searchResults.map((mod) => {
              const isInstalled = installedModIds.has(mod.project_id)
              return (
                <div
                  key={mod.project_id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => handleSelectMod(mod)}
                >
                  <div className="flex-shrink-0 relative">
                    {mod.icon_url ? (
                      <img
                        src={mod.icon_url}
                        alt={mod.title}
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
                    <span className="font-medium text-sm truncate min-w-[120px] max-w-[200px]">{mod.title}</span>
                    <span className="text-xs text-muted-foreground truncate">{mod.author}</span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {formatDownloads(mod.downloads)}
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
            {searchResults.map((mod) => {
              const isInstalled = installedModIds.has(mod.project_id)
              return (
                <Card
                  key={mod.project_id}
                  className="overflow-hidden hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => handleSelectMod(mod)}
                >
                  <CardContent className="p-3">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 relative">
                        {mod.icon_url ? (
                          <img
                            src={mod.icon_url}
                            alt={mod.title}
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
                            <h4 className="font-medium text-sm truncate">{mod.title}</h4>
                            <p className="text-xs text-muted-foreground">{t("modrinth.by")} {mod.author}</p>
                          </div>
                          <Button
                            size="sm"
                            variant={isInstalled ? "outline" : "default"}
                            className="gap-1"
                            disabled={!selectedInstance || !isCompatible}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectMod(mod)
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
                          {mod.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {isInstalled && (
                            <Badge variant="default" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                              <Check className="h-2.5 w-2.5 mr-1" />
                              {t("modpack.installed")}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {formatDownloads(mod.downloads)} DL
                          </Badge>
                          {mod.categories.slice(0, 2).map((cat) => (
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

          {getPageNumbers(currentPage, totalPages).map((page, index) =>
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
              {selectedMod?.icon_url && (
                <img
                  src={selectedMod.icon_url}
                  alt={selectedMod.title}
                  className="w-8 h-8 rounded"
                />
              )}
              {selectedMod?.title}
            </DialogTitle>
            <DialogDescription>
              {t("modrinth.selectVersion")}
            </DialogDescription>
          </DialogHeader>

          {isLoadingVersions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : modVersions.length === 0 ? (
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
                  {modVersions.map((version) => (
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
