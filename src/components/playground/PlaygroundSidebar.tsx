import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FlaskConical,
  Server,
  Gamepad2,
  Network,
  RefreshCw,
  FolderOpen,
  Settings2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export function PlaygroundSidebar() {
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
        console.error("[PlaygroundSidebar] Failed to load instances:", err);
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
      console.error("[PlaygroundSidebar] Failed to open folder:", err);
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

  return (
    <div className="w-64 border-r bg-card/50 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">{t("playground.title")}</h2>
        </div>

        {/* Instance Selector */}
        <Select
          value={instanceId || ""}
          onValueChange={handleInstanceChange}
          disabled={isLoadingInstances}
        >
          <SelectTrigger className="w-full">
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
      </div>

      {/* Instance Info */}
      {instance && (
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">
              {t("playground.instanceInfo")}
            </span>
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                isRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/50"
              )}
            />
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("playground.version")}</span>
              <span>{instance.mc_version}</span>
            </div>
            {instance.loader && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("playground.loader")}</span>
                <span>{instance.loader}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("playground.type")}</span>
              <span>
                {instance.is_proxy
                  ? t("playground.proxy")
                  : instance.is_server
                  ? t("playground.server")
                  : t("playground.client")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Mods Summary */}
      {instance && (
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">{t("playground.mods")}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={refreshMods}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
              />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded-md">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span>
                {enabledCount} {t("playground.enabled")}
              </span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
              <span>
                {disabledCount} {t("playground.disabled")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {instance && (
        <div className="p-4 flex-1">
          <span className="text-sm font-medium mb-3 block">
            {t("playground.quickActions")}
          </span>

          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={handleOpenFolder}
            >
              <FolderOpen className="h-4 w-4" />
              {t("playground.openModsFolder")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={cn(
                "w-full justify-start gap-2",
                showOptionalDeps && "bg-primary/10 border-primary/50"
              )}
              onClick={toggleOptionalDeps}
            >
              <Settings2 className="h-4 w-4" />
              {showOptionalDeps
                ? t("playground.hideOptionalDeps")
                : t("playground.showOptionalDeps")}
            </Button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!instance && !isLoadingInstances && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            {t("playground.selectInstanceToStart")}
          </p>
        </div>
      )}

      {/* Loading State */}
      {isLoadingInstances && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
