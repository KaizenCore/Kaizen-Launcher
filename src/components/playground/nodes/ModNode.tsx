import { memo, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import {
  Package,
  AlertTriangle,
  ArrowUpCircle,
  MoreVertical,
  Trash2,
  ExternalLink,
  Power,
  PowerOff,
  Settings,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { usePlaygroundLayout } from "../hooks";
import type { ModNodeData } from "@/types/playground";

type ModNodeProps = NodeProps & {
  data: ModNodeData;
};

function ModNodeComponent({ id, data, selected }: ModNodeProps) {
  const { t } = useTranslation();
  const { mod, hasUpdate, hasMissingDeps } = data;
  const [isToggling, setIsToggling] = useState(false);

  const { getNode } = useReactFlow();
  const { createConfigNode } = usePlaygroundLayout();

  const toggleMod = usePlaygroundStore((s) => s.toggleMod);
  const deleteMod = usePlaygroundStore((s) => s.deleteMod);
  const selectNode = usePlaygroundStore((s) => s.selectNode);
  const addConfigNode = usePlaygroundStore((s) => s.addConfigNode);

  const handleToggle = async (enabled: boolean) => {
    setIsToggling(true);
    await toggleMod(mod.filename, enabled);
    setIsToggling(false);
  };

  const handleDelete = async () => {
    await deleteMod(mod.filename);
  };

  const handleViewOnModrinth = () => {
    if (mod.project_id) {
      window.open(`https://modrinth.com/mod/${mod.project_id}`, "_blank");
    }
  };

  const handleOpenConfig = () => {
    const currentNode = getNode(id);
    if (!currentNode) return;

    const configNode = createConfigNode(mod, currentNode.position);
    addConfigNode(configNode as import("@xyflow/react").Node<import("@/types/playground").ConfigNodeData>);
  };

  return (
    <div
      className={cn(
        "relative bg-card border rounded-lg shadow-md transition-all duration-200",
        "w-[240px] p-3.5",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        !mod.enabled && "opacity-60",
        hasMissingDeps && "border-red-500/50 shadow-red-500/10"
      )}
      onClick={() => selectNode(mod.filename)}
    >
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background"
      />

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 relative">
          {mod.icon_url ? (
            <img
              src={mod.icon_url}
              alt={mod.name}
              className="w-10 h-10 rounded-md object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
          )}

          {/* Status indicators */}
          {hasMissingDeps && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                    <AlertTriangle className="h-2.5 w-2.5 text-white" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("playground.missingDependencies")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {hasUpdate && !hasMissingDeps && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                    <ArrowUpCircle className="h-2.5 w-2.5 text-white" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("playground.updateAvailable")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate" title={mod.name}>
            {mod.name}
          </h4>
          <p className="text-xs text-muted-foreground truncate">{mod.version}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenConfig();
                  }}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("playground.openConfig")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Switch
            checked={mod.enabled}
            onCheckedChange={handleToggle}
            disabled={isToggling}
            className="scale-75"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={() => handleToggle(!mod.enabled)}
                disabled={isToggling}
              >
                {mod.enabled ? (
                  <>
                    <PowerOff className="h-4 w-4 mr-2" />
                    {t("playground.disable")}
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4 mr-2" />
                    {t("playground.enable")}
                  </>
                )}
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleOpenConfig}>
                <Settings className="h-4 w-4 mr-2" />
                {t("playground.openConfig")}
              </DropdownMenuItem>

              {mod.project_id && (
                <DropdownMenuItem onClick={handleViewOnModrinth}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t("playground.viewOnModrinth")}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("playground.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Dependency count indicator */}
      {(mod.dependencies.length > 0 || mod.dependents.length > 0) && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t text-xs text-muted-foreground">
          {mod.dependencies.length > 0 && (
            <span>
              {mod.dependencies.length} {t("playground.deps")}
            </span>
          )}
          {mod.dependents.length > 0 && (
            <span>
              {mod.dependents.length} {t("playground.dependents")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const ModNode = memo(ModNodeComponent);
