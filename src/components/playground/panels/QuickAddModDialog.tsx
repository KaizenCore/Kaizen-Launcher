import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  Search,
  Download,
  Loader2,
  Package,
  Check,
  ExternalLink,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlaygroundStore } from "@/stores/playgroundStore";

interface ModSearchResult {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url: string | null;
  categories: string[];
  game_versions: string[];
  loaders: string[];
}

interface ModSearchResponse {
  results: ModSearchResult[];
  total_hits: number;
  offset: number;
  limit: number;
}

interface InstallProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  instance_id: string | null;
}

interface QuickAddModDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDownloads(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

const RESULTS_PER_PAGE = 20;

export function QuickAddModDialog({ open, onOpenChange }: QuickAddModDialogProps) {
  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const instance = usePlaygroundStore((s) => s.instance);
  const mods = usePlaygroundStore((s) => s.mods);
  const refreshMods = usePlaygroundStore((s) => s.refreshMods);

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ModSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalHits, setTotalHits] = useState(0);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  // Get installed mod slugs/project IDs for checking
  const installedModNames = new Set(mods.map((m) => m.name.toLowerCase()));

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSearchQuery("");
      setResults([]);
      setInstalledIds(new Set());
      setHasMore(false);
      setTotalHits(0);
    }
  }, [open]);

  // Listen for install progress
  useEffect(() => {
    const unlisten = listen<InstallProgress>("install-progress", (event) => {
      if (event.payload.stage === "complete" && event.payload.instance_id === instanceId) {
        refreshMods();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [instanceId, refreshMods]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim() || !instance) {
      setResults([]);
      setHasMore(false);
      setTotalHits(0);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const loader = instance.loader?.toLowerCase() || "";

        const response = await invoke<ModSearchResponse>("search_modrinth_mods", {
          query: searchQuery,
          gameVersion: instance.mc_version,
          loader: loader || null,
          projectType: "mod",
          sortBy: "relevance",
          limit: RESULTS_PER_PAGE,
          offset: 0,
        });

        setResults(response.results);
        setTotalHits(response.total_hits);
        setHasMore(response.results.length < response.total_hits);
      } catch (err) {
        console.error("[QuickAddMod] Search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, instance]);

  // Load more results
  const loadMore = useCallback(async () => {
    if (!instance || !searchQuery.trim() || isLoadingMore || !hasMore || loadingMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const loader = instance.loader?.toLowerCase() || "";

      const response = await invoke<ModSearchResponse>("search_modrinth_mods", {
        query: searchQuery,
        gameVersion: instance.mc_version,
        loader: loader || null,
        projectType: "mod",
        sortBy: "relevance",
        limit: RESULTS_PER_PAGE,
        offset: results.length,
      });

      setResults((prev) => [...prev, ...response.results]);
      setHasMore(results.length + response.results.length < response.total_hits);
    } catch (err) {
      console.error("[QuickAddMod] Load more error:", err);
    } finally {
      setIsLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [instance, searchQuery, isLoadingMore, hasMore, results.length]);

  // Handle scroll for infinite loading
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.target as HTMLDivElement;
      const { scrollTop, scrollHeight, clientHeight } = target;

      // Load more when scrolled to 80% of the content
      if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !isLoadingMore) {
        loadMore();
      }
    },
    [hasMore, isLoadingMore, loadMore]
  );

  const handleInstall = useCallback(
    async (mod: ModSearchResult) => {
      if (!instanceId || !instance) return;

      setInstallingIds((prev) => new Set(prev).add(mod.project_id));

      try {
        // Get the best version for this instance
        const loader = instance.loader?.toLowerCase() || "";
        const versions = await invoke<Array<{
          id: string;
          name: string;
          version_number: string;
          game_versions: string[];
          loaders: string[];
          version_type: string;
        }>>("get_modrinth_mod_versions", {
          projectId: mod.project_id,
          gameVersion: instance.mc_version,
          loader: loader || null,
        });

        // Filter to compatible versions (already filtered by backend, but double-check)
        const compatibleVersions = versions.filter(
          (v) =>
            v.game_versions.includes(instance.mc_version) &&
            (loader ? v.loaders.map((l) => l.toLowerCase()).includes(loader) : true)
        );

        if (compatibleVersions.length === 0) {
          toast.error(`No compatible version found for ${instance.mc_version}`);
          return;
        }

        // Prefer stable, then beta, then alpha
        const sortedVersions = compatibleVersions.sort((a, b) => {
          const typeOrder = { release: 0, beta: 1, alpha: 2 };
          return (typeOrder[a.version_type as keyof typeof typeOrder] || 3) -
            (typeOrder[b.version_type as keyof typeof typeOrder] || 3);
        });

        const bestVersion = sortedVersions[0];

        // Install the mod
        await invoke("install_modrinth_mod", {
          instanceId,
          projectId: mod.project_id,
          versionId: bestVersion.id,
          projectType: "mod",
        });

        setInstalledIds((prev) => new Set(prev).add(mod.project_id));
        toast.success(`${mod.title} installed`);
        refreshMods();
      } catch (err) {
        console.error("[QuickAddMod] Install error:", err);
        toast.error(`Failed to install ${mod.title}: ${err}`);
      } finally {
        setInstallingIds((prev) => {
          const next = new Set(prev);
          next.delete(mod.project_id);
          return next;
        });
      }
    },
    [instanceId, instance, refreshMods]
  );

  const isInstalled = (mod: ModSearchResult) => {
    return (
      installedIds.has(mod.project_id) ||
      installedModNames.has(mod.title.toLowerCase()) ||
      installedModNames.has(mod.slug.toLowerCase())
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Quick Add Mod
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search and install mods from Modrinth
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search Modrinth..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {instance && (
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="secondary" className="text-xs">
                {instance.mc_version}
              </Badge>
              {instance.loader && (
                <Badge variant="outline" className="text-xs">
                  {instance.loader}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-hidden border-t">
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto"
            onScroll={handleScroll}
          >
            {isSearching ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                {searchQuery ? (
                  <>
                    <Search className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No mods found</p>
                  </>
                ) : (
                  <>
                    <Package className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Search for mods on Modrinth
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {results.map((mod) => {
                  const installing = installingIds.has(mod.project_id);
                  const installed = isInstalled(mod);

                  return (
                    <div
                      key={mod.project_id}
                      className="flex items-center gap-3 p-3 hover:bg-muted/50"
                    >
                      {/* Icon */}
                      {mod.icon_url ? (
                        <img
                          src={mod.icon_url}
                          alt={mod.title}
                          className="w-10 h-10 rounded object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{mod.title}</span>
                          <span className="text-xs text-muted-foreground">
                            by {mod.author}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {mod.description}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Download className="h-3 w-3" />
                            {formatDownloads(mod.downloads)}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            window.open(`https://modrinth.com/mod/${mod.slug}`, "_blank")
                          }
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>

                        {installed ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled
                            className="gap-1.5 w-24"
                          >
                            <Check className="h-4 w-4" />
                            Installed
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            disabled={installing}
                            onClick={() => handleInstall(mod)}
                            className="gap-1.5 w-24"
                          >
                            {installing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            {installing ? "..." : "Install"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Loading more indicator */}
                {isLoadingMore && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Results count */}
                {!hasMore && results.length > 0 && (
                  <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                    {results.length} of {totalHits} results
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QuickAddModDialog;
