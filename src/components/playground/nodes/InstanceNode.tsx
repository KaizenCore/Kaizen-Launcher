import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Play, Square, Server, Gamepad2, Network, RotateCcw, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { InstanceNodeData } from "@/types/playground";

type InstanceNodeProps = NodeProps & {
  data: InstanceNodeData;
};

function InstanceNodeComponent({ data, selected }: InstanceNodeProps) {
  const { t } = useTranslation();
  const { instance, isRunning, isInstalled } = data;
  const setRunningStatus = usePlaygroundStore((s) => s.setRunningStatus);
  const [isRestarting, setIsRestarting] = useState(false);

  const handleLaunch = async () => {
    if (!isInstalled) {
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
            accountId: null,
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
      console.error("[InstanceNode] Launch error:", err);
      toast.error(String(err));
    }
  };

  const handleRestart = async () => {
    if (!isRunning || !isInstalled) return;

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
          accountId: null,
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
      console.error("[InstanceNode] Restart error:", err);
      toast.error(String(err));
    } finally {
      setIsRestarting(false);
    }
  };

  const getInstanceIcon = () => {
    if (instance.is_proxy) return <Network className="h-8 w-8" />;
    if (instance.is_server) return <Server className="h-8 w-8" />;
    return <Gamepad2 className="h-8 w-8" />;
  };

  const getLoaderBadge = () => {
    if (!instance.loader) return null;
    const loaderColors: Record<string, string> = {
      fabric: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      forge: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      neoforge: "bg-red-500/20 text-red-400 border-red-500/30",
      quilt: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      paper: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      purpur: "bg-violet-500/20 text-violet-400 border-violet-500/30",
      velocity: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    };
    const colorClass =
      loaderColors[instance.loader.toLowerCase()] ||
      "bg-gray-500/20 text-gray-400 border-gray-500/30";

    return (
      <Badge variant="outline" className={cn("text-xs", colorClass)}>
        {instance.loader}
      </Badge>
    );
  };

  return (
    <div
      className={cn(
        "relative bg-card border-2 rounded-xl shadow-lg transition-all duration-200",
        "w-[300px] p-5",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isRunning && "border-green-500 shadow-green-500/20 shadow-lg"
      )}
    >
      {/* Top handle for mods to connect */}
      <Handle
        type="source"
        position={Position.Top}
        className="!bg-primary !w-3 !h-3 !border-2 !border-background"
      />

      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={cn(
            "flex-shrink-0 p-3 rounded-lg",
            isRunning ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
          )}
        >
          {getInstanceIcon()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg truncate">{instance.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">
              {instance.mc_version}
            </span>
            {getLoaderBadge()}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              isRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/50"
            )}
          />
          <span className="text-xs text-muted-foreground">
            {isRunning
              ? t("playground.running")
              : isInstalled
              ? t("playground.ready")
              : t("playground.notInstalled")}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRestart}
                    disabled={isRestarting}
                    className="h-8 w-8 p-0"
                  >
                    {isRestarting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("playground.restart")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            size="sm"
            variant={isRunning ? "destructive" : "default"}
            onClick={handleLaunch}
            disabled={!isInstalled || isRestarting}
            className="gap-1.5"
          >
            {isRunning ? (
              <>
                <Square className="h-3.5 w-3.5" />
                {t("playground.stop")}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                {t("playground.launch")}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Bottom handles for additional connections */}
      <Handle
        type="target"
        position={Position.Bottom}
        className="!bg-primary !w-3 !h-3 !border-2 !border-background"
      />
    </div>
  );
}

export const InstanceNode = memo(InstanceNodeComponent);
