import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Server,
  Gamepad2,
  Network,
  Clock,
  Calendar,
  HardDrive,
  Cpu,
  FolderOpen,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { usePlaygroundStore } from "@/stores/playgroundStore";

export function InstanceInfoTab() {

  const instance = usePlaygroundStore((s) => s.instance);
  const mods = usePlaygroundStore((s) => s.mods);
  const isRunning = usePlaygroundStore((s) => s.isRunning);
  const isInstalled = usePlaygroundStore((s) => s.isInstalled);

  const handleOpenFolder = useCallback(async () => {
    if (!instance) return;
    try {
      await invoke("open_instance_folder", { instanceId: instance.id });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, [instance]);

  if (!instance) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No instance selected
      </div>
    );
  }

  const getInstanceIcon = () => {
    if (instance.is_proxy) return <Network className="h-5 w-5" />;
    if (instance.is_server) return <Server className="h-5 w-5" />;
    return <Gamepad2 className="h-5 w-5" />;
  };

  const getInstanceType = () => {
    if (instance.is_proxy) return "Proxy";
    if (instance.is_server) return "Server";
    return "Client";
  };

  const formatPlaytime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const enabledMods = mods.filter((m) => m.enabled).length;
  const totalMods = mods.length;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {getInstanceIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">{instance.name}</h3>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge variant="secondary" className="text-xs">
                {instance.mc_version}
              </Badge>
              {instance.loader && (
                <Badge variant="outline" className="text-xs">
                  {instance.loader}
                </Badge>
              )}
              <Badge
                variant={isRunning ? "default" : "secondary"}
                className="text-xs"
              >
                {isRunning ? "Running" : "Stopped"}
              </Badge>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={handleOpenFolder}
        >
          <FolderOpen className="h-4 w-4" />
          Open Folder
        </Button>
      </div>

      <Separator />

      {/* Stats */}
      <div className="p-4 space-y-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Instance Info
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={<Package className="h-4 w-4" />}
              label="Type"
              value={getInstanceType()}
            />
            <StatCard
              icon={<Package className="h-4 w-4" />}
              label="Mods"
              value={`${enabledMods}/${totalMods}`}
            />
            <StatCard
              icon={<Clock className="h-4 w-4" />}
              label="Playtime"
              value={formatPlaytime(instance.total_playtime_seconds)}
            />
            <StatCard
              icon={<Calendar className="h-4 w-4" />}
              label="Last Played"
              value={formatDate(instance.last_played)}
            />
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Java Settings
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5" />
                Memory
              </span>
              <span className="font-mono text-xs">
                {instance.memory_min_mb}MB - {instance.memory_max_mb}MB
              </span>
            </div>
            {instance.java_path && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  Java
                </span>
                <span className="font-mono text-xs truncate max-w-[60%]" title={instance.java_path}>
                  {instance.java_path.split(/[\\/]/).pop() || "Custom"}
                </span>
              </div>
            )}
          </div>
        </div>

        {(instance.is_server || instance.is_proxy) && (
          <>
            <Separator />

            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Server Settings
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Port</span>
                  <span className="font-mono text-xs">{instance.server_port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge
                    variant={isInstalled ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {isInstalled ? "Installed" : "Not Installed"}
                  </Badge>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export default InstanceInfoTab;
