import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { RequirePermission } from "@/components/permissions/RequirePermission";
import { PERMISSIONS } from "@/hooks/usePermission";
import {
  PlaygroundCanvas,
  PlaygroundToolbar,
  PlaygroundContextPanel,
  PlaygroundSearch,
} from "@/components/playground";
import { usePlaygroundStore } from "@/stores/playgroundStore";

interface InstanceStatusEvent {
  instance_id: string;
  running: boolean;
}

export function Playground() {
  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const setRunningStatus = usePlaygroundStore((s) => s.setRunningStatus);
  const refreshMods = usePlaygroundStore((s) => s.refreshMods);
  const setSearchOpen = usePlaygroundStore((s) => s.setSearchOpen);

  // Listen for instance status changes
  useEffect(() => {
    const unlistenStatus = listen<InstanceStatusEvent>(
      "instance-status",
      (event) => {
        if (event.payload.instance_id === instanceId) {
          setRunningStatus(event.payload.running);
        }
      }
    );

    return () => {
      unlistenStatus.then((fn) => fn());
    };
  }, [instanceId, setRunningStatus]);

  // Refresh mods when window regains focus (in case files changed externally)
  useEffect(() => {
    const handleFocus = () => {
      if (instanceId) {
        refreshMods();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [instanceId, refreshMods]);

  // Keyboard shortcut: Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  return (
    <RequirePermission permission={PERMISSIONS.BETA}>
      {/* Negative margins to negate parent padding and go edge-to-edge */}
      <div className="flex flex-col overflow-hidden -m-6" style={{ height: "calc(100vh - 40px)" }}>
        {/* Top Toolbar - Instance Selector & Quick Actions */}
        <PlaygroundToolbar />

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Center - Canvas */}
          <div className="flex-1 overflow-hidden">
            <PlaygroundCanvas />
          </div>

          {/* Right Panel - Console & Details */}
          <PlaygroundContextPanel />
        </div>
      </div>

      {/* Search Dialog (Ctrl+K) */}
      <PlaygroundSearch />
    </RequirePermission>
  );
}

export default Playground;
