import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FlaskConical,
  Server,
  Gamepad2,
  Network,
  RefreshCw,
  FolderOpen,
  Loader2,
  Package,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import {
  usePlaygroundStore,
  usePlaygroundSettingsStore,
} from "@/stores/playgroundStore";
import type { Instance } from "@/types/playground";

interface InstanceOption {
  id: string;
  name: string;
  type: "client" | "server" | "proxy";
  loader: string | null;
  mc_version: string;
}

export function PlaygroundToolbar() {
  const { t } = useTranslation();

  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const instance = usePlaygroundStore((s) => s.instance);
  const mods = usePlaygroundStore((s) => s.mods);
  const isLoading = usePlaygroundStore((s) => s.isLoading);
  const isRunning = usePlaygroundStore((s) => s.isRunning);
  const loadInstance = usePlaygroundStore((s) => s.loadInstance);
  const refreshMods = usePlaygroundStore((s) => s.refreshMods);
  const showOptionalDeps = usePlaygroundStore((s) => s.showOptionalDeps);
  const toggleOptionalDeps = usePlaygroundStore((s) => s.toggleOptionalDeps);

  const lastInstanceId = usePlaygroundSettingsStore((s) => s.lastInstanceId);

  const [instances, setInstances] = useState<InstanceOption[]>([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(true);

  // Load all instances on mount
  useEffect(() => {
    const loadInstances = async () => {
      try {
        const allInstances = await invoke<Instance[]>("get_instances");
        const options: InstanceOption[] = allInstances.map((inst) => ({
          id: inst.id,
          name: inst.name,
          type: inst.is_proxy ? "proxy" : inst.is_server ? "server" : "client",
          loader: inst.loader,
          mc_version: inst.mc_version,
        }));
        setInstances(options);

        // Auto-load last instance if available
        if (lastInstanceId && !instanceId) {
          const exists = options.some((i) => i.id === lastInstanceId);
          if (exists) {
            loadInstance(lastInstanceId);
          }
        }
      } catch (err) {
        console.error("[PlaygroundToolbar] Failed to load instances:", err);
      } finally {
        setIsLoadingInstances(false);
      }
    };

    loadInstances();
  }, [lastInstanceId, instanceId, loadInstance]);

  const handleInstanceChange = useCallback(
    (id: string) => {
      loadInstance(id);
    },
    [loadInstance]
  );

  const handleOpenFolder = useCallback(async () => {
    if (!instanceId) return;
    try {
      await invoke("open_mods_folder", { instanceId });
    } catch (err) {
      console.error("[PlaygroundToolbar] Failed to open folder:", err);
    }
  }, [instanceId]);

  const getInstanceIcon = (type: "client" | "server" | "proxy") => {
    switch (type) {
      case "proxy":
        return <Network className="h-4 w-4" />;
      case "server":
        return <Server className="h-4 w-4" />;
      default:
        return <Gamepad2 className="h-4 w-4" />;
    }
  };

  const enabledCount = mods.filter((m) => m.enabled).length;
  const disabledCount = mods.filter((m) => !m.enabled).length;
  const totalCount = mods.length;

  return (
    <div className="h-14 border-b bg-card/50 flex items-center px-4 gap-4">
      {/* Title */}
      <div className="flex items-center gap-2">
        <FlaskConical className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">{t("playground.title")}</h2>
      </div>

      <Separator orientation="vertical" className="h-8" />

      {/* Instance Selector */}
      <div className="flex items-center gap-2">
        <Select
          value={instanceId || ""}
          onValueChange={handleInstanceChange}
          disabled={isLoadingInstances}
        >
          <SelectTrigger className="w-[220px] h-9">
            <SelectValue placeholder={t("playground.selectInstance")} />
          </SelectTrigger>
          <SelectContent>
            {instances.map((inst) => (
              <SelectItem key={inst.id} value={inst.id}>
                <div className="flex items-center gap-2">
                  {getInstanceIcon(inst.type)}
                  <span className="truncate">{inst.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Running indicator */}
        {instance && (
          <div
            className={cn(
              "w-2.5 h-2.5 rounded-full flex-shrink-0",
              isRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"
            )}
            title={isRunning ? t("playground.running") : t("playground.stopped")}
          />
        )}
      </div>

      {/* Instance Info Badges */}
      {instance && (
        <>
          <Separator orientation="vertical" className="h-8" />

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5">
              {instance.mc_version}
            </Badge>
            {instance.loader && (
              <Badge variant="outline" className="gap-1.5">
                {instance.loader}
              </Badge>
            )}
            <Badge variant="outline" className="gap-1.5">
              {getInstanceIcon(instance.is_proxy ? "proxy" : instance.is_server ? "server" : "client")}
              {instance.is_proxy
                ? t("playground.proxy")
                : instance.is_server
                ? t("playground.server")
                : t("playground.client")}
            </Badge>
          </div>
        </>
      )}

      {/* Mods Summary */}
      {instance && (
        <>
          <Separator orientation="vertical" className="h-8" />

          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <span className="text-green-500 font-medium">{enabledCount}</span>
              <span className="text-muted-foreground"> / {totalCount}</span>
            </span>
            {disabledCount > 0 && (
              <span className="text-xs text-muted-foreground">
                ({disabledCount} {t("playground.disabled")})
              </span>
            )}
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      {instance && (
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={refreshMods}
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isLoading && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.refresh")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleOpenFolder}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("playground.openModsFolder")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showOptionalDeps ? "secondary" : "ghost"}
                  size="icon"
                  className="h-9 w-9"
                  onClick={toggleOptionalDeps}
                >
                  {showOptionalDeps ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showOptionalDeps
                  ? t("playground.hideOptionalDeps")
                  : t("playground.showOptionalDeps")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Loading indicator */}
      {isLoadingInstances && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
