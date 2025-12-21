import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  FlaskConical,
  Server,
  Gamepad2,
  Network,
  RefreshCw,
  FolderOpen,
  Loader2,
  Package,
  Play,
  Square,
  RotateCcw,
  PanelLeftClose,
  PanelRightClose,
  PanelLeft,
  PanelRight,
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
  const isInstalled = usePlaygroundStore((s) => s.isInstalled);
  const loadInstance = usePlaygroundStore((s) => s.loadInstance);
  const refreshMods = usePlaygroundStore((s) => s.refreshMods);
  const setRunningStatus = usePlaygroundStore((s) => s.setRunningStatus);
  const leftPanelCollapsed = usePlaygroundStore((s) => s.leftPanelCollapsed);
  const rightPanelCollapsed = usePlaygroundStore((s) => s.rightPanelCollapsed);
  const toggleLeftPanel = usePlaygroundStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = usePlaygroundStore((s) => s.toggleRightPanel);

  const lastInstanceId = usePlaygroundSettingsStore((s) => s.lastInstanceId);

  const [instances, setInstances] = useState<InstanceOption[]>([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);

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

  const handleLaunch = useCallback(async () => {
    if (!instance || !isInstalled) {
      toast.error(t("playground.instanceNotInstalled"));
      return;
    }

    try {
      if (isRunning) {
        await invoke("stop_instance", { instanceId: instance.id });
        setRunningStatus(false);
        toast.success(t("playground.instanceStopped"));
      } else {
        // For servers, we don't need an account
        if (instance.is_server || instance.is_proxy) {
          await invoke("launch_instance", {
            instanceId: instance.id,
            accountId: "",
          });
        } else {
          // For clients, we need to get the active account
          const activeAccount = await invoke<{ id: string } | null>(
            "get_active_account"
          );
          if (!activeAccount) {
            toast.error(t("playground.noActiveAccount"));
            return;
          }
          await invoke("launch_instance", {
            instanceId: instance.id,
            accountId: activeAccount.id,
          });
        }
        setRunningStatus(true);
        toast.success(t("playground.instanceLaunched"));
      }
    } catch (err) {
      console.error("[PlaygroundToolbar] Launch error:", err);
      toast.error(String(err));
    }
  }, [instance, isInstalled, isRunning, setRunningStatus, t]);

  const handleRestart = useCallback(async () => {
    if (!instance || !isRunning || !isInstalled) return;

    setIsRestarting(true);
    try {
      // Stop the instance
      await invoke("stop_instance", { instanceId: instance.id });
      setRunningStatus(false);

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Relaunch
      if (instance.is_server || instance.is_proxy) {
        await invoke("launch_instance", {
          instanceId: instance.id,
          accountId: "",
        });
      } else {
        const activeAccount = await invoke<{ id: string } | null>(
          "get_active_account"
        );
        if (!activeAccount) {
          toast.error(t("playground.noActiveAccount"));
          setIsRestarting(false);
          return;
        }
        await invoke("launch_instance", {
          instanceId: instance.id,
          accountId: activeAccount.id,
        });
      }
      setRunningStatus(true);
      toast.success(t("playground.instanceRestarted"));
    } catch (err) {
      console.error("[PlaygroundToolbar] Restart error:", err);
      toast.error(String(err));
    } finally {
      setIsRestarting(false);
    }
  }, [instance, isRunning, isInstalled, setRunningStatus, t]);

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
    <div className="h-14 flex-shrink-0 border-b bg-card/50 flex items-center px-4 gap-4">
      {/* Left panel toggle */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleLeftPanel}
            >
              {leftPanelCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {leftPanelCollapsed ? "Show mod list" : "Hide mod list"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

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

      {/* Launch Controls */}
      {instance && (
        <div className="flex items-center gap-2">
          {isRunning && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestart}
                    disabled={isRestarting || !isInstalled}
                    className="h-9 w-9 p-0"
                  >
                    {isRestarting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("playground.restart")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <Button
            variant={isRunning ? "destructive" : "default"}
            size="sm"
            onClick={handleLaunch}
            disabled={!isInstalled || isRestarting}
            className="gap-1.5 h-9"
          >
            {isRunning ? (
              <>
                <Square className="h-4 w-4" />
                {t("playground.stop")}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {t("playground.launch")}
              </>
            )}
          </Button>

          <Separator orientation="vertical" className="h-8" />
        </div>
      )}

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
        </div>
      )}

      {/* Right panel toggle */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleRightPanel}
            >
              {rightPanelCollapsed ? (
                <PanelRight className="h-4 w-4" />
              ) : (
                <PanelRightClose className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {rightPanelCollapsed ? "Show details" : "Hide details"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Loading indicator */}
      {isLoadingInstances && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
