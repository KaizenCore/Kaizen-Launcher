import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Package, Server, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";

export function PlaygroundSearch() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const instance = usePlaygroundStore((s) => s.instance);
  const mods = usePlaygroundStore((s) => s.mods);
  const isSearchOpen = usePlaygroundStore((s) => s.isSearchOpen);
  const setSearchOpen = usePlaygroundStore((s) => s.setSearchOpen);
  const focusNode = usePlaygroundStore((s) => s.focusNode);

  // Build searchable items
  const searchItems = useMemo(() => {
    const items: { id: string; name: string; type: "instance" | "mod"; icon?: string }[] = [];

    // Add instance
    if (instance) {
      items.push({
        id: "instance",
        name: instance.name,
        type: "instance",
      });
    }

    // Add mods
    for (const mod of mods) {
      items.push({
        id: mod.filename,
        name: mod.name,
        type: "mod",
        icon: mod.icon_url ?? undefined,
      });
    }

    return items;
  }, [instance, mods]);

  // Filter results
  const filteredResults = useMemo(() => {
    if (!query.trim()) return searchItems.slice(0, 10);

    const lowerQuery = query.toLowerCase();
    return searchItems
      .filter((item) => item.name.toLowerCase().includes(lowerQuery))
      .slice(0, 10);
  }, [searchItems, query]);

  // Reset on open
  useEffect(() => {
    if (isSearchOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isSearchOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isSearchOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredResults.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredResults.length - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (filteredResults[selectedIndex]) {
            handleSelect(filteredResults[selectedIndex].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          setSearchOpen(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, filteredResults, selectedIndex, setSearchOpen]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= filteredResults.length) {
      setSelectedIndex(Math.max(0, filteredResults.length - 1));
    }
  }, [filteredResults.length, selectedIndex]);

  const handleSelect = (nodeId: string) => {
    focusNode(nodeId);
    setSearchOpen(false);
  };

  return (
    <Dialog open={isSearchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("playground.searchNodes")}</DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 px-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("playground.searchPlaceholder")}
            className="h-11 border-0 focus-visible:ring-0 px-0"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <ScrollArea className="max-h-[300px]">
          {filteredResults.length > 0 ? (
            <div className="p-1">
              {filteredResults.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  {item.type === "instance" ? (
                    <Server className="h-5 w-5 text-primary flex-shrink-0" />
                  ) : item.icon ? (
                    <img
                      src={item.icon}
                      alt=""
                      className="h-5 w-5 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="truncate block text-sm">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.type === "instance"
                        ? t("playground.instance")
                        : t("playground.mod")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground text-sm">
              {t("playground.noResults")}
            </div>
          )}
        </ScrollArea>

        {/* Footer hint */}
        <div className="px-3 py-2 border-t text-xs text-muted-foreground flex items-center gap-4">
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
              ↑↓
            </kbd>{" "}
            {t("playground.navigate")}
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
              ↵
            </kbd>{" "}
            {t("playground.select")}
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
              Esc
            </kbd>{" "}
            {t("playground.close")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PlaygroundSearch;
