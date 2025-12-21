import { memo, useCallback } from "react";
import { Package, AlertTriangle, MoreVertical, ExternalLink, Trash2, Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { ModInfoWithDependencies } from "@/types/playground";

interface ModListItemProps {
  mod: ModInfoWithDependencies;
  hasMissingDeps: boolean;
}

const MODRINTH_PROJECT_URL = "https://modrinth.com/mod";

export const ModListItem = memo(function ModListItem({
  mod,
  hasMissingDeps,
}: ModListItemProps) {
  const { t } = useTranslation();

  const selectedModFilename = usePlaygroundStore((s) => s.selectedModFilename);
  const selectedMods = usePlaygroundStore((s) => s.selectedMods);
  const selectMod = usePlaygroundStore((s) => s.selectMod);
  const toggleModSelection = usePlaygroundStore((s) => s.toggleModSelection);
  const toggleMod = usePlaygroundStore((s) => s.toggleMod);
  const deleteMod = usePlaygroundStore((s) => s.deleteMod);
  const setActiveDetailsTab = usePlaygroundStore((s) => s.setActiveDetailsTab);

  const isSelected = selectedModFilename === mod.filename;
  const isMultiSelected = selectedMods.has(mod.filename);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Multi-select with Ctrl/Cmd
        toggleModSelection(mod.filename);
      } else if (e.shiftKey) {
        // Range select with Shift (simplified - just toggle for now)
        toggleModSelection(mod.filename);
      } else {
        // Single select
        selectMod(mod.filename);
      }
    },
    [mod.filename, selectMod, toggleModSelection]
  );

  const handleToggle = useCallback(
    (checked: boolean) => {
      toggleMod(mod.filename, checked);
    },
    [mod.filename, toggleMod]
  );

  const handleDelete = useCallback(() => {
    deleteMod(mod.filename);
  }, [mod.filename, deleteMod]);

  const handleOpenModrinth = useCallback(() => {
    if (mod.project_id) {
      window.open(`${MODRINTH_PROJECT_URL}/${mod.project_id}`, "_blank");
    }
  }, [mod.project_id]);

  const handleOpenConfig = useCallback(() => {
    selectMod(mod.filename);
    setActiveDetailsTab("config");
  }, [mod.filename, selectMod, setActiveDetailsTab]);

  const depsCount = mod.dependencies?.length || 0;
  const dependentsCount = mod.dependents?.length || 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
        "hover:bg-accent/50",
        isSelected && "bg-accent",
        isMultiSelected && "bg-primary/10",
        !mod.enabled && "opacity-60"
      )}
      onClick={handleClick}
    >
      {/* Checkbox for multi-select */}
      <Checkbox
        checked={isMultiSelected}
        onCheckedChange={() => toggleModSelection(mod.filename)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 flex-shrink-0"
      />

      {/* Icon */}
      {mod.icon_url ? (
        <img
          src={mod.icon_url}
          alt={mod.name}
          className="w-8 h-8 rounded object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm truncate">{mod.name}</span>
          {hasMissingDeps && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Missing required dependencies</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{mod.version}</span>
          {(depsCount > 0 || dependentsCount > 0) && (
            <span className="flex-shrink-0">
              {depsCount > 0 && `${depsCount} deps`}
              {depsCount > 0 && dependentsCount > 0 && " · "}
              {dependentsCount > 0 && `${dependentsCount} dependents`}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={mod.enabled}
          onCheckedChange={handleToggle}
          className="scale-75"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleOpenConfig}>
              <Settings className="h-4 w-4 mr-2" />
              {t("playground.openConfig")}
            </DropdownMenuItem>
            {mod.project_id && (
              <DropdownMenuItem onClick={handleOpenModrinth}>
                <ExternalLink className="h-4 w-4 mr-2" />
                {t("modsList.viewOnModrinth")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export default ModListItem;
