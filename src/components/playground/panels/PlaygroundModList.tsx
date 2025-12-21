import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
  Search,
  Package,
  Filter,
  SortAsc,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Check,
  X,
  Plus,
  Upload,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { ModListItem } from "./ModListItem";
import { QuickAddModDialog } from "./QuickAddModDialog";

type SortOption = "name-asc" | "name-desc" | "enabled-first" | "disabled-first";
type FilterOption = "all" | "enabled" | "disabled" | "missing-deps";

const ITEMS_PER_BATCH = 30;

export function PlaygroundModList() {
  const { t } = useTranslation();

  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const mods = usePlaygroundStore((s) => s.mods);
  const isLoading = usePlaygroundStore((s) => s.isLoading);
  const validation = usePlaygroundStore((s) => s.validation);
  const selectedMods = usePlaygroundStore((s) => s.selectedMods);
  const selectAllMods = usePlaygroundStore((s) => s.selectAllMods);
  const clearModSelection = usePlaygroundStore((s) => s.clearModSelection);
  const setSearchQuery = usePlaygroundStore((s) => s.setSearchQuery);
  const searchQuery = usePlaygroundStore((s) => s.searchQuery);
  const refreshMods = usePlaygroundStore((s) => s.refreshMods);

  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [filterOption, setFilterOption] = useState<FilterOption>("all");
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_BATCH);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Get mods with missing dependencies
  const modsWithMissingDeps = useMemo(() => {
    if (!validation?.missing_required) return new Set<string>();
    return new Set(validation.missing_required.map((m) => m.mod_name));
  }, [validation]);

  // Filter and sort mods
  const filteredMods = useMemo(() => {
    let result = [...mods];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (mod) =>
          mod.name.toLowerCase().includes(query) ||
          mod.filename.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    switch (filterOption) {
      case "enabled":
        result = result.filter((mod) => mod.enabled);
        break;
      case "disabled":
        result = result.filter((mod) => !mod.enabled);
        break;
      case "missing-deps":
        result = result.filter((mod) => modsWithMissingDeps.has(mod.name));
        break;
    }

    // Apply sorting
    switch (sortOption) {
      case "name-asc":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        result.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "enabled-first":
        result.sort((a, b) => {
          if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
          return a.enabled ? -1 : 1;
        });
        break;
      case "disabled-first":
        result.sort((a, b) => {
          if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
          return a.enabled ? 1 : -1;
        });
        break;
    }

    return result;
  }, [mods, searchQuery, filterOption, sortOption, modsWithMissingDeps]);

  // Visible mods (for infinite scroll)
  const visibleMods = useMemo(() => {
    return filteredMods.slice(0, visibleCount);
  }, [filteredMods, visibleCount]);

  const hasMore = visibleCount < filteredMods.length;

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(ITEMS_PER_BATCH);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [searchQuery, filterOption, sortOption]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          setVisibleCount((prev) => prev + ITEMS_PER_BATCH);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoading]);

  const handleSelectAll = useCallback(() => {
    if (selectedMods.size > 0) {
      clearModSelection();
    } else {
      selectAllMods();
    }
  }, [selectedMods.size, clearModSelection, selectAllMods]);

  // Import mods from file dialog
  const handleImportFromFiles = useCallback(async () => {
    if (!instanceId) return;

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Mods", extensions: ["jar"] }],
        title: "Select mod files to import",
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) {
        return;
      }

      const files = Array.isArray(selected) ? selected : [selected];
      setIsImporting(true);

      // Get the mods folder path
      const modsFolder = await invoke<string>("get_mods_folder_path", { instanceId });

      let imported = 0;
      for (const filePath of files) {
        const fileName = filePath.split(/[\\/]/).pop() || "";
        const destPath = `${modsFolder}/${fileName}`;
        try {
          await copyFile(filePath, destPath);
          imported++;
        } catch (err) {
          console.error(`Failed to copy ${fileName}:`, err);
        }
      }

      if (imported > 0) {
        toast.success(`${imported} mod(s) imported`);
        refreshMods();
      }
    } catch (err) {
      console.error("[PlaygroundModList] Import error:", err);
      toast.error(`Import failed: ${err}`);
    } finally {
      setIsImporting(false);
    }
  }, [instanceId, refreshMods]);

  const enabledCount = mods.filter((m) => m.enabled).length;
  const disabledCount = mods.filter((m) => !m.enabled).length;
  const missingDepsCount = modsWithMissingDeps.size;

  return (
    <div className="flex flex-col h-full relative">
      {/* Importing overlay */}
      {isImporting && (
        <div className="absolute inset-0 z-50 bg-background/80 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Importing mods...</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b space-y-3">
        {/* Search + Add buttons */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("instanceDetails.searchMods")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={handleImportFromFiles}
                  disabled={isImporting}
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import .jar files</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => setQuickAddOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add mod from Modrinth</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Filter & Sort */}
        <div className="flex items-center gap-2">
          {/* Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filterOption !== "all" ? "secondary" : "outline"}
                size="sm"
                className="h-7 gap-1 text-xs flex-1"
              >
                <Filter className="h-3 w-3" />
                {t("modsList.filter")}
                {filterOption !== "all" && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    1
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel className="text-xs">
                {t("modsList.filterBy")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={filterOption}
                onValueChange={(value) => setFilterOption(value as FilterOption)}
              >
                <DropdownMenuRadioItem value="all" className="text-xs">
                  {t("modsList.filterAll")} ({mods.length})
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="enabled" className="text-xs">
                  {t("modsList.filterEnabled")} ({enabledCount})
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="disabled" className="text-xs">
                  {t("modsList.filterDisabled")} ({disabledCount})
                </DropdownMenuRadioItem>
                {missingDepsCount > 0 && (
                  <DropdownMenuRadioItem value="missing-deps" className="text-xs text-destructive">
                    Missing Dependencies ({missingDepsCount})
                  </DropdownMenuRadioItem>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1">
                <SortAsc className="h-3 w-3" />
                {t("modsList.sort")}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs">
                {t("modsList.sortBy")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortOption}
                onValueChange={(value) => setSortOption(value as SortOption)}
              >
                <DropdownMenuRadioItem value="name-asc" className="text-xs">
                  {t("modsList.sortNameAsc")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name-desc" className="text-xs">
                  {t("modsList.sortNameDesc")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="enabled-first" className="text-xs">
                  {t("modsList.sortEnabledFirst")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="disabled-first" className="text-xs">
                  {t("modsList.sortDisabledFirst")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Selection bar */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
              checked={selectedMods.size > 0 && selectedMods.size === mods.length}
              onCheckedChange={handleSelectAll}
              className="h-3.5 w-3.5"
            />
            <label htmlFor="select-all" className="text-muted-foreground cursor-pointer">
              {selectedMods.size > 0
                ? `${selectedMods.size} selected`
                : t("instanceDetails.selectAll")}
            </label>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3 text-green-500" />
              {enabledCount}
            </span>
            <span className="flex items-center gap-1">
              <X className="h-3 w-3 text-muted-foreground" />
              {disabledCount}
            </span>
            {missingDepsCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {missingDepsCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Mod list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <Package className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("instanceDetails.noModInstalled")}
            </p>
          </div>
        ) : filteredMods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <Search className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("instances.noResults")}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {visibleMods.map((mod) => (
              <ModListItem
                key={mod.filename}
                mod={mod}
                hasMissingDeps={modsWithMissingDeps.has(mod.name)}
              />
            ))}

            {/* Load more trigger */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick add mod dialog */}
      <QuickAddModDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </div>
  );
}

export default PlaygroundModList;
