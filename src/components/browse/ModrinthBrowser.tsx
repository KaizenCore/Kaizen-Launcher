import { useState, useCallback, useEffect, useRef, memo, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Search, Download, Loader2, ChevronDown, AlertTriangle, Check, SlidersHorizontal, X, ChevronLeft, ChevronRight, Package, Palette, Sparkles, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { useTranslation, type TranslationKey } from "@/i18n"

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
  files: ModFileInfo[]
}

interface ModFileInfo {
  url: string
  filename: string
  primary: boolean
  size: number
  sha1: string
}

interface ModSearchResponse {
  results: ModSearchResult[]
  total_hits: number
  offset: number
  limit: number
}

interface DependencyInfo {
  project_id: string
  version_id: string | null
  dependency_type: string
  title: string
  description: string
  icon_url: string | null
  slug: string
}

// Content types supported by Modrinth
export type ContentType = "mod" | "resourcepack" | "shader" | "datapack"

// Constants - defined outside component to avoid recreation on each render
const ITEMS_PER_PAGE = 20

interface ModrinthBrowserProps {
  instanceId: string
  mcVersion: string
  loader: string | null
  isServer: boolean
  onModInstalled: () => void
  contentType?: ContentType
  /** If true, show tabs to switch between content types (for client instances) */
  showContentTabs?: boolean
}

function formatDownloads(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`
  }
  return num.toString()
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

// Memoized mod search result card
interface ModSearchCardProps {
  mod: ModSearchResult
  isInstalled: boolean
  isInstalling: boolean
  onOpenVersions: (mod: ModSearchResult) => void
  onQuickInstall: (mod: ModSearchResult) => void
}

const ModSearchCard = memo(function ModSearchCard({
  mod,
  isInstalled,
  isInstalling,
  onOpenVersions,
  onQuickInstall,
}: ModSearchCardProps) {
  const { t } = useTranslation()
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex gap-4">
          {/* Icon */}
          <div className="flex-shrink-0">
            {mod.icon_url ? (
              <img
                src={mod.icon_url}
                alt={mod.title}
                loading="lazy"
                className="w-16 h-16 rounded-lg object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                <span className="text-2xl font-bold text-muted-foreground">
                  {mod.title.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-lg leading-tight">{mod.title}</h3>
                <p className="text-sm text-muted-foreground">{t("modrinth.by")} {mod.author}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isInstalled ? (
                  <Badge variant="secondary" className="gap-1">
                    <Check className="h-3 w-3" />
                    {t("browse.installed")}
                  </Badge>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenVersions(mod)}
                      className="gap-1"
                    >
                      <ChevronDown className="h-4 w-4" />
                      {t("modrinth.versions")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => onQuickInstall(mod)}
                      disabled={isInstalling}
                      className="gap-1"
                    >
                      {isInstalling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {t("common.install")}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {mod.description}
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="secondary" className="text-xs">
                {formatDownloads(mod.downloads)} downloads
              </Badge>
              {mod.categories.slice(0, 3).map((cat) => (
                <Badge key={cat} variant="outline" className="text-xs">
                  {cat}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

// Categories for mods and plugins - using translation keys
const MOD_CATEGORIES: { value: string; labelKey: TranslationKey }[] = [
  { value: "adventure", labelKey: "modrinth.categoryAdventure" },
  { value: "cursed", labelKey: "modrinth.categoryCursed" },
  { value: "decoration", labelKey: "modrinth.categoryDecoration" },
  { value: "economy", labelKey: "modrinth.categoryEconomy" },
  { value: "equipment", labelKey: "modrinth.categoryEquipment" },
  { value: "food", labelKey: "modrinth.categoryFood" },
  { value: "game-mechanics", labelKey: "modrinth.categoryMechanics" },
  { value: "library", labelKey: "modrinth.categoryLibrary" },
  { value: "magic", labelKey: "modrinth.categoryMagic" },
  { value: "management", labelKey: "modrinth.categoryManagement" },
  { value: "minigame", labelKey: "modrinth.categoryMinigame" },
  { value: "mobs", labelKey: "modrinth.categoryMobs" },
  { value: "optimization", labelKey: "modrinth.categoryOptimization" },
  { value: "social", labelKey: "modrinth.categorySocial" },
  { value: "storage", labelKey: "modrinth.categoryStorage" },
  { value: "technology", labelKey: "modrinth.categoryTechnology" },
  { value: "transportation", labelKey: "modrinth.categoryTransportation" },
  { value: "utility", labelKey: "modrinth.categoryUtility" },
  { value: "worldgen", labelKey: "modrinth.categoryWorldgen" },
]

const PLUGIN_CATEGORIES: { value: string; labelKey: TranslationKey }[] = [
  { value: "admin-tools", labelKey: "modrinth.categoryAdminTools" },
  { value: "anti-cheat", labelKey: "modrinth.categoryAntiCheat" },
  { value: "chat", labelKey: "modrinth.categoryChat" },
  { value: "economy", labelKey: "modrinth.categoryEconomy" },
  { value: "gameplay", labelKey: "modrinth.categoryGameplay" },
  { value: "management", labelKey: "modrinth.categoryManagement" },
  { value: "minigame", labelKey: "modrinth.categoryMinigame" },
  { value: "misc", labelKey: "modrinth.categoryMisc" },
  { value: "moderation", labelKey: "modrinth.categoryModeration" },
  { value: "social", labelKey: "modrinth.categorySocial" },
  { value: "teleportation", labelKey: "modrinth.categoryTeleportation" },
  { value: "utility", labelKey: "modrinth.categoryUtility" },
  { value: "world-management", labelKey: "modrinth.categoryWorldManagement" },
]

// Resource pack categories
const RESOURCEPACK_CATEGORIES: { value: string; labelKey: TranslationKey }[] = [
  { value: "8x-", labelKey: "modrinth.categoryRes8x" },
  { value: "16x", labelKey: "modrinth.categoryRes16x" },
  { value: "32x", labelKey: "modrinth.categoryRes32x" },
  { value: "48x", labelKey: "modrinth.categoryRes48x" },
  { value: "64x", labelKey: "modrinth.categoryRes64x" },
  { value: "128x", labelKey: "modrinth.categoryRes128x" },
  { value: "256x", labelKey: "modrinth.categoryRes256x" },
  { value: "512x+", labelKey: "modrinth.categoryRes512x" },
  { value: "realistic", labelKey: "modrinth.categoryRealistic" },
  { value: "simplistic", labelKey: "modrinth.categorySimplistic" },
  { value: "themed", labelKey: "modrinth.categoryThemed" },
  { value: "tweaks", labelKey: "modrinth.categoryTweaks" },
  { value: "font", labelKey: "modrinth.categoryFont" },
  { value: "gui", labelKey: "modrinth.categoryGui" },
  { value: "utility", labelKey: "modrinth.categoryUtility" },
]

// Shader categories
const SHADER_CATEGORIES: { value: string; labelKey: TranslationKey }[] = [
  { value: "atmosphere", labelKey: "modrinth.categoryAtmosphere" },
  { value: "bloom", labelKey: "modrinth.categoryBloom" },
  { value: "cartoon", labelKey: "modrinth.categoryCartoon" },
  { value: "cursed", labelKey: "modrinth.categoryCursed" },
  { value: "fantasy", labelKey: "modrinth.categoryFantasy" },
  { value: "lightweight", labelKey: "modrinth.categoryLightweight" },
  { value: "potato", labelKey: "modrinth.categoryPotato" },
  { value: "semi-realistic", labelKey: "modrinth.categorySemiRealistic" },
  { value: "vanilla-like", labelKey: "modrinth.categoryVanillaLike" },
]

// Datapack categories
const DATAPACK_CATEGORIES: { value: string; labelKey: TranslationKey }[] = [
  { value: "adventure", labelKey: "modrinth.categoryAdventure" },
  { value: "cursed", labelKey: "modrinth.categoryCursed" },
  { value: "decoration", labelKey: "modrinth.categoryDecoration" },
  { value: "economy", labelKey: "modrinth.categoryEconomy" },
  { value: "equipment", labelKey: "modrinth.categoryEquipment" },
  { value: "food", labelKey: "modrinth.categoryFood" },
  { value: "game-mechanics", labelKey: "modrinth.categoryMechanics" },
  { value: "library", labelKey: "modrinth.categoryLibrary" },
  { value: "magic", labelKey: "modrinth.categoryMagic" },
  { value: "management", labelKey: "modrinth.categoryManagement" },
  { value: "minigame", labelKey: "modrinth.categoryMinigame" },
  { value: "mobs", labelKey: "modrinth.categoryMobs" },
  { value: "optimization", labelKey: "modrinth.categoryOptimization" },
  { value: "social", labelKey: "modrinth.categorySocial" },
  { value: "storage", labelKey: "modrinth.categoryStorage" },
  { value: "technology", labelKey: "modrinth.categoryTechnology" },
  { value: "transportation", labelKey: "modrinth.categoryTransportation" },
  { value: "utility", labelKey: "modrinth.categoryUtility" },
  { value: "worldgen", labelKey: "modrinth.categoryWorldgen" },
]

const SORT_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "relevance", labelKey: "modrinth.sortRelevance" },
  { value: "downloads", labelKey: "modrinth.sortDownloads" },
  { value: "follows", labelKey: "modrinth.sortFollows" },
  { value: "newest", labelKey: "modrinth.sortNewest" },
  { value: "updated", labelKey: "modrinth.sortUpdated" },
]

// Determine the project type, item labels and categories based on contentType and loader
function getContentConfig(contentType: ContentType | undefined, loader: string | null): {
  projectType: string
  itemLabel: string
  itemLabelSingular: string
  categories: { value: string; labelKey: TranslationKey }[]
} {
  // If contentType is explicitly set, use it
  if (contentType === "resourcepack") {
    return {
      projectType: "resourcepack",
      itemLabel: "resource packs",
      itemLabelSingular: "resource pack",
      categories: RESOURCEPACK_CATEGORIES,
    }
  }
  if (contentType === "shader") {
    return {
      projectType: "shader",
      itemLabel: "shaders",
      itemLabelSingular: "shader",
      categories: SHADER_CATEGORIES,
    }
  }
  if (contentType === "datapack") {
    return {
      projectType: "datapack",
      itemLabel: "datapacks",
      itemLabelSingular: "datapack",
      categories: DATAPACK_CATEGORIES,
    }
  }

  // Default behavior based on loader (for mods/plugins)
  if (!loader) {
    return { projectType: "mod", itemLabel: "mods", itemLabelSingular: "mod", categories: MOD_CATEGORIES }
  }

  const loaderLower = loader.toLowerCase()

  // Mod loaders - search for mods
  if (["fabric", "forge", "neoforge", "quilt"].includes(loaderLower)) {
    return { projectType: "mod", itemLabel: "mods", itemLabelSingular: "mod", categories: MOD_CATEGORIES }
  }

  // Plugin servers - search for plugins
  if (["paper", "spigot", "bukkit", "purpur", "folia"].includes(loaderLower)) {
    return { projectType: "plugin", itemLabel: "plugins", itemLabelSingular: "plugin", categories: PLUGIN_CATEGORIES }
  }

  // Proxy servers - search for plugins
  if (["velocity", "bungeecord", "waterfall"].includes(loaderLower)) {
    return { projectType: "plugin", itemLabel: "plugins", itemLabelSingular: "plugin", categories: PLUGIN_CATEGORIES }
  }

  return { projectType: "mod", itemLabel: "mods", itemLabelSingular: "mod", categories: MOD_CATEGORIES }
}

export function ModrinthBrowser({ instanceId, mcVersion, loader, isServer: _isServer, onModInstalled, contentType: initialContentType, showContentTabs = false }: ModrinthBrowserProps) {
  const { t } = useTranslation()

  // Internal content type state for tabs
  const [activeContentType, setActiveContentType] = useState<ContentType>(initialContentType || "mod")

  // Use activeContentType when tabs are shown, otherwise use prop
  const effectiveContentType = showContentTabs ? activeContentType : initialContentType

  // Memoize content config to prevent unnecessary recalculations and re-renders
  const { projectType, itemLabel, itemLabelSingular, categories } = useMemo(
    () => getContentConfig(effectiveContentType, loader),
    [effectiveContentType, loader]
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ModSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [totalHits, setTotalHits] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)

  // Filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<string>("downloads")

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = useMemo(() => Math.ceil(totalHits / ITEMS_PER_PAGE), [totalHits])
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Version selection dialog
  const [selectedMod, setSelectedMod] = useState<ModSearchResult | null>(null)
  const [modVersions, setModVersions] = useState<ModVersionInfo[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string>("")
  const [isInstalling, setIsInstalling] = useState(false)
  const [installingModId, setInstallingModId] = useState<string | null>(null)

  // Dependencies dialog
  const [showDependencies, setShowDependencies] = useState(false)
  const [dependencies, setDependencies] = useState<DependencyInfo[]>([])
  const [selectedDependencies, setSelectedDependencies] = useState<Set<string>>(new Set())
  const [isLoadingDeps, setIsLoadingDeps] = useState(false)
  const [pendingInstall, setPendingInstall] = useState<{ mod: ModSearchResult; versionId: string } | null>(null)
  const [installedModIds, setInstalledModIds] = useState<Set<string>>(new Set())

  // Load installed mod IDs on mount and after each installation
  const loadInstalledMods = useCallback(async () => {
    try {
      const ids = await invoke<string[]>("get_installed_mod_ids", { instanceId, projectType })
      setInstalledModIds(new Set(ids))
    } catch (err) {
      console.error("Failed to load installed mod IDs:", err)
    }
  }, [instanceId, projectType])

  useEffect(() => {
    loadInstalledMods()
  }, [loadInstalledMods])

  // Handle content type tab change
  const handleContentTypeChange = useCallback((value: string) => {
    const newType = value as ContentType
    setActiveContentType(newType)
    // Reset search state when switching tabs
    setSearchQuery("")
    setSelectedCategories([])
    setSortBy("downloads")
    setCurrentPage(1)
  }, [])

  // Search function that uses current filters
  const performSearch = useCallback(async (query: string, cats: string[], sort: string, page: number = 1) => {
    console.log(`[Modrinth] Searching ${projectType}: "${query || "(popular)"}" (page ${page}, sort: ${sort})`)
    setIsSearching(true)
    setHasSearched(true)
    try {
      const offset = (page - 1) * ITEMS_PER_PAGE
      const response = await invoke<ModSearchResponse>("search_modrinth_mods", {
        query: query,
        gameVersion: mcVersion,
        loader: loader,
        projectType: projectType,
        categories: cats.length > 0 ? cats : null,
        sortBy: sort,
        offset: offset,
        limit: ITEMS_PER_PAGE,
      })
      console.log(`[Modrinth] Found ${response.total_hits} results`)
      setSearchResults(response.results)
      setTotalHits(response.total_hits)
      setCurrentPage(page)
      // Scroll to top when page changes
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = 0
      }
    } catch (err) {
      console.error(`Failed to search ${itemLabel}:`, err)
      setSearchResults([])
      setTotalHits(0)
    } finally {
      setIsSearching(false)
    }
  }, [mcVersion, loader, projectType, itemLabel])

  // Track if initial search has been done for current content type
  const initialSearchDoneRef = useRef<string | null>(null)

  // Load popular mods on mount or when content type changes
  useEffect(() => {
    // Only perform initial search if content type changed or first mount
    const searchKey = `${projectType}-${mcVersion}-${loader}`
    if (initialSearchDoneRef.current !== searchKey) {
      initialSearchDoneRef.current = searchKey
      performSearch("", [], "downloads", 1)
    }
  }, [projectType, mcVersion, loader, performSearch])

  const handleSearch = useCallback(async () => {
    await performSearch(searchQuery, selectedCategories, sortBy, 1)
  }, [searchQuery, selectedCategories, sortBy, performSearch])

  // Handle filter changes - trigger search immediately and reset to page 1
  const handleCategoryToggle = (category: string) => {
    const newCategories = selectedCategories.includes(category)
      ? selectedCategories.filter(c => c !== category)
      : [...selectedCategories, category]
    setSelectedCategories(newCategories)
    performSearch(searchQuery, newCategories, sortBy, 1)
  }

  const handleSortChange = (value: string) => {
    setSortBy(value)
    performSearch(searchQuery, selectedCategories, value, 1)
  }

  const clearFilters = () => {
    setSelectedCategories([])
    setSortBy("downloads")
    performSearch(searchQuery, [], "downloads", 1)
  }

  // Pagination handlers
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      performSearch(searchQuery, selectedCategories, sortBy, page)
    }
  }

  const goToPreviousPage = () => goToPage(currentPage - 1)
  const goToNextPage = () => goToPage(currentPage + 1)

  // Generate page numbers to display
  const getPageNumbers = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible + 2) {
      // Show all pages if there are few enough
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (currentPage > 3) {
        pages.push("ellipsis")
      }

      // Show pages around current page
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (currentPage < totalPages - 2) {
        pages.push("ellipsis")
      }

      // Always show last page
      pages.push(totalPages)
    }

    return pages
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  const openVersionDialog = async (mod: ModSearchResult) => {
    setSelectedMod(mod)
    setSelectedVersion("")
    setIsLoadingVersions(true)

    try {
      const versions = await invoke<ModVersionInfo[]>("get_modrinth_mod_versions", {
        projectId: mod.project_id,
        gameVersion: mcVersion,
        loader: loader,
        projectType: projectType,
      })
      setModVersions(versions)
      if (versions.length > 0) {
        setSelectedVersion(versions[0].id)
      }
    } catch (err) {
      console.error(`Failed to load ${itemLabelSingular} versions:`, err)
      setModVersions([])
    } finally {
      setIsLoadingVersions(false)
    }
  }

  // Check for dependencies before installing
  const checkAndInstall = async (mod: ModSearchResult, versionId: string) => {
    // Check if the mod is already installed
    if (installedModIds.has(mod.project_id)) {
      console.log(`[Modrinth] ${mod.title} is already installed`)
      toast.error(`${mod.title} ${t("modrinth.alreadyInstalled")}`)
      setInstallingModId(null)
      return
    }

    console.log(`[Modrinth] Checking dependencies for: ${mod.title}`)
    setIsLoadingDeps(true)
    try {
      const deps = await invoke<DependencyInfo[]>("get_mod_dependencies", {
        versionId,
        gameVersion: mcVersion,
        loader: loader,
      })

      // Filter out already installed dependencies
      const notInstalledDeps = deps.filter(d => !installedModIds.has(d.project_id))
      console.log(`[Modrinth] ${mod.title} has ${notInstalledDeps.length} dependencies to install`)

      if (notInstalledDeps.length > 0) {
        // Has dependencies that are not installed - show dialog
        setDependencies(notInstalledDeps)
        // Pre-select required dependencies
        const requiredDeps = new Set(notInstalledDeps.filter(d => d.dependency_type === "required").map(d => d.project_id))
        setSelectedDependencies(requiredDeps)
        setPendingInstall({ mod, versionId })
        setShowDependencies(true)
      } else {
        // No new dependencies - install directly
        await doInstall(mod, versionId, [])
      }
    } catch (err) {
      console.error("[Modrinth] Failed to check dependencies:", err)
      // Install anyway if we can't check dependencies
      await doInstall(mod, versionId, [])
    } finally {
      setIsLoadingDeps(false)
    }
  }

  // Actually install the mod and selected dependencies
  const doInstall = async (mod: ModSearchResult, versionId: string, depsToInstall: DependencyInfo[]) => {
    console.log(`[Modrinth] Installing ${mod.title}${depsToInstall.length > 0 ? ` with ${depsToInstall.length} dependencies` : ""}`)
    setIsInstalling(true)
    setInstallingModId(mod.project_id)
    const toastId = `install-${mod.project_id}`

    const totalItems = 1 + depsToInstall.length
    toast.loading(totalItems > 1 ? t("modrinth.installingWithDeps", { title: mod.title, count: String(depsToInstall.length) }) : `${t("common.install")} ${mod.title}...`, { id: toastId })

    try {
      // First install the main mod
      await invoke<string>("install_modrinth_mod", {
        instanceId,
        projectId: mod.project_id,
        versionId: versionId,
        projectType: projectType,
      })
      console.log(`[Modrinth] Main ${projectType} installed: ${mod.title}`)

      // Then install dependencies if any
      if (depsToInstall.length > 0) {
        // Get versions for each dependency and install
        for (const dep of depsToInstall) {
          try {
            let depVersionId = dep.version_id

            // If no specific version, get the latest compatible one
            if (!depVersionId) {
              const depVersions = await invoke<ModVersionInfo[]>("get_modrinth_mod_versions", {
                projectId: dep.project_id,
                gameVersion: mcVersion,
                loader: loader,
                projectType: projectType,
              })
              if (depVersions.length > 0) {
                depVersionId = depVersions[0].id
              }
            }

            if (depVersionId) {
              await invoke<string>("install_modrinth_mod", {
                instanceId,
                projectId: dep.project_id,
                versionId: depVersionId,
                projectType: projectType,
              })
            }
          } catch (depErr) {
            console.warn(`Failed to install dependency ${dep.title}:`, depErr)
          }
        }
      }

      toast.success(t("modrinth.installedWithDeps", { title: mod.title, count: String(depsToInstall.length) }), { id: toastId })
      setSelectedMod(null)
      setShowDependencies(false)
      setPendingInstall(null)
      // Refresh installed mods list
      await loadInstalledMods()
      onModInstalled()
    } catch (err) {
      console.error(`Failed to install ${itemLabelSingular}:`, err)
      toast.error(`${t("errors.installError")}: ${err}`, { id: toastId })
    } finally {
      setIsInstalling(false)
      setInstallingModId(null)
    }
  }

  // Handle confirming installation with selected dependencies
  const handleConfirmInstallWithDeps = async () => {
    if (!pendingInstall) return

    const depsToInstall = dependencies.filter(d => selectedDependencies.has(d.project_id))
    await doInstall(pendingInstall.mod, pendingInstall.versionId, depsToInstall)
  }

  // Toggle dependency selection
  const toggleDependency = (projectId: string, isRequired: boolean) => {
    if (isRequired) return // Can't deselect required dependencies

    setSelectedDependencies(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const handleInstallMod = async () => {
    if (!selectedMod || !selectedVersion) return
    await checkAndInstall(selectedMod, selectedVersion)
  }

  const handleQuickInstall = async (mod: ModSearchResult) => {
    console.log(`[Modrinth] Quick installing: ${mod.title}`)
    setInstallingModId(mod.project_id)
    const toastId = `install-${mod.project_id}`
    toast.loading(t("modrinth.checkingDeps"), { id: toastId })
    try {
      // Get versions and install the first (latest compatible) one
      const versions = await invoke<ModVersionInfo[]>("get_modrinth_mod_versions", {
        projectId: mod.project_id,
        gameVersion: mcVersion,
        loader: loader,
        projectType: projectType,
      })

      if (versions.length === 0) {
        console.warn(`[Modrinth] No compatible version found for: ${mod.title}`)
        toast.error(t("modrinth.noCompatibleVersionFound"), { id: toastId })
        setInstallingModId(null)
        return
      }

      console.log(`[Modrinth] Installing version ${versions[0].version_number} of ${mod.title}`)
      toast.dismiss(toastId)
      await checkAndInstall(mod, versions[0].id)
    } catch (err) {
      console.error(`[Modrinth] Failed to install ${itemLabelSingular}:`, err)
      toast.error(`${t("errors.installError")}: ${err}`, { id: toastId })
      setInstallingModId(null)
    } finally {
      setInstallingModId(null)
    }
  }

  const selectedVersionInfo = modVersions.find(v => v.id === selectedVersion)

  const activeFiltersCount = selectedCategories.length + (sortBy !== "downloads" ? 1 : 0)

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Content type tabs - only shown for client instances when showContentTabs is true */}
      {showContentTabs && (
        <Tabs value={activeContentType} onValueChange={handleContentTypeChange} className="flex-shrink-0">
          <TabsList>
            <TabsTrigger value="mod" className="gap-2">
              <Package className="h-4 w-4" />
              {t("browse.mods")}
            </TabsTrigger>
            <TabsTrigger value="resourcepack" className="gap-2">
              <Palette className="h-4 w-4" />
              {t("browse.resourcePacks")}
            </TabsTrigger>
            <TabsTrigger value="shader" className="gap-2">
              <Sparkles className="h-4 w-4" />
              {t("browse.shaders")}
            </TabsTrigger>
            <TabsTrigger value="datapack" className="gap-2">
              <Database className="h-4 w-4" />
              {t("browse.datapacks")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Search bar */}
      <div className="flex gap-2 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("modrinth.searchPlaceholder", { items: itemLabel })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-10"
          />
        </div>
        <Button onClick={handleSearch} disabled={isSearching}>
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            t("modrinth.search")
          )}
        </Button>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
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

        {/* Category filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("modrinth.categories")}
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
                      performSearch(searchQuery, [], sortBy)
                    }}
                  >
                    {t("modrinth.clearAll")}
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="h-[240px]">
              <div className="p-2 space-y-1">
                {categories.map((cat: { value: string; labelKey: TranslationKey }) => {
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

        {/* Clear filters button */}
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
            <X className="h-3 w-3" />
            {t("modrinth.clearFilters")}
          </Button>
        )}

        {/* Info badges */}
        <div className="flex-1" />
        <Badge variant="outline" className="text-xs">
          {mcVersion}
        </Badge>
        {loader && (
          <Badge variant="outline" className="text-xs">
            {loader}
          </Badge>
        )}
        {hasSearched && (
          <Badge variant="secondary" className="text-xs">
            {totalHits} {t("modrinth.results")}
          </Badge>
        )}
      </div>

      {/* Selected categories chips */}
      {selectedCategories.length > 0 && (
        <div className="flex flex-wrap gap-1 flex-shrink-0">
          {selectedCategories.map((cat) => {
            const catInfo = categories.find((c: { value: string; labelKey: TranslationKey }) => c.value === cat)
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
      <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
        {isSearching ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="text-center py-8">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t("modrinth.noItemFound", { item: itemLabelSingular })}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchQuery || selectedCategories.length > 0
                ? t("modrinth.tryDifferentFilters")
                : t("modrinth.noCompatible", { item: itemLabelSingular, version: mcVersion }) + (loader ? ` ${t("modrinth.andLoader", { loader })}` : "")}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pr-4">
            {searchResults.map((mod) => (
              <ModSearchCard
                key={mod.project_id}
                mod={mod}
                isInstalled={installedModIds.has(mod.project_id)}
                isInstalling={installingModId === mod.project_id}
                onOpenVersions={openVersionDialog}
                onQuickInstall={handleQuickInstall}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && searchResults.length > 0 && (
        <div className="flex items-center justify-center gap-1 pt-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousPage}
            disabled={currentPage === 1 || isSearching}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {getPageNumbers().map((page, index) =>
            page === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                ...
              </span>
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
            onClick={goToNextPage}
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
      <Dialog open={!!selectedMod} onOpenChange={(open) => !open && setSelectedMod(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedMod?.title}</DialogTitle>
            <DialogDescription>
              {t("modrinth.selectVersion")}
            </DialogDescription>
          </DialogHeader>

          {isLoadingVersions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : modVersions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">{t("modrinth.noCompatibleVersion")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("modrinth.noVersionFor", { item: itemLabelSingular, version: mcVersion })}
                {loader && ` ${t("modrinth.andLoader", { loader })}`}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                <SelectTrigger>
                  <SelectValue placeholder={t("modpack.selectVersion")} />
                </SelectTrigger>
                <SelectContent>
                  {modVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      <div className="flex items-center gap-2">
                        <span>{version.name}</span>
                        <Badge
                          variant={version.version_type === "release" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {version.version_type}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedVersionInfo && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>{t("modrinth.version")} {selectedVersionInfo.version_number}</p>
                  <p>{t("modrinth.minecraft")} {selectedVersionInfo.game_versions.join(", ")}</p>
                  <p>{t("modrinth.loaders")} {selectedVersionInfo.loaders.join(", ")}</p>
                  {selectedVersionInfo.files[0] && (
                    <p>{t("modrinth.size")} {formatSize(selectedVersionInfo.files[0].size)}</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedMod(null)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleInstallMod}
                  disabled={isInstalling || !selectedVersion}
                  className="gap-2"
                >
                  {isInstalling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t("common.install")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dependencies dialog */}
      <Dialog open={showDependencies} onOpenChange={(open) => {
        if (!open) {
          setShowDependencies(false)
          setPendingInstall(null)
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {t("modrinth.dependenciesDetected")}
            </DialogTitle>
            <DialogDescription>
              {t("modrinth.requiresFollowing", { title: pendingInstall?.mod.title || "", items: itemLabel })}
            </DialogDescription>
          </DialogHeader>

          {isLoadingDeps ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-3 pr-4">
                {dependencies.map((dep) => {
                  const isRequired = dep.dependency_type === "required"
                  const isSelected = selectedDependencies.has(dep.project_id)

                  return (
                    <div
                      key={dep.project_id}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        isSelected ? "border-primary bg-primary/5" : "border-border"
                      } ${!isRequired ? "cursor-pointer hover:bg-accent/50" : ""}`}
                      onClick={() => toggleDependency(dep.project_id, isRequired)}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {isRequired ? (
                          <div className="h-5 w-5 rounded border-2 border-primary bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        ) : (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleDependency(dep.project_id, false)}
                          />
                        )}
                      </div>

                      <div className="flex-shrink-0">
                        {dep.icon_url ? (
                          <img
                            src={dep.icon_url}
                            alt={dep.title}
                            className="w-10 h-10 rounded object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <span className="text-sm font-bold text-muted-foreground">
                              {dep.title.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{dep.title}</span>
                          <Badge
                            variant={isRequired ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {isRequired ? t("modrinth.required") : t("modrinth.optional")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {dep.description}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowDependencies(false)
                setPendingInstall(null)
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleConfirmInstallWithDeps}
              disabled={isInstalling}
              className="gap-2"
            >
              {isInstalling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t("modrinth.installCount", { count: String(1 + selectedDependencies.size), items: itemLabel })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
