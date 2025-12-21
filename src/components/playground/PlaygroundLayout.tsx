import { useEffect } from "react";
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
} from "react-resizable-panels";
import { GripVertical } from "lucide-react";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { PlaygroundModList } from "./panels/PlaygroundModList";
import { PlaygroundDetailsPanel } from "./panels/PlaygroundDetailsPanel";
import { PlaygroundConsole } from "./PlaygroundConsole";

export function PlaygroundLayout() {
  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const instance = usePlaygroundStore((s) => s.instance);
  const isRunning = usePlaygroundStore((s) => s.isRunning);
  const leftPanelCollapsed = usePlaygroundStore((s) => s.leftPanelCollapsed);
  const rightPanelCollapsed = usePlaygroundStore((s) => s.rightPanelCollapsed);

  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

  // Sync panel collapse state with store
  useEffect(() => {
    const panel = leftPanelRef.current;
    if (panel) {
      try {
        if (leftPanelCollapsed) {
          panel.collapse();
        } else {
          panel.expand();
        }
      } catch {
        // Panel not yet registered in Group, ignore
      }
    }
  }, [leftPanelCollapsed, leftPanelRef]);

  useEffect(() => {
    const panel = rightPanelRef.current;
    if (panel) {
      try {
        if (rightPanelCollapsed) {
          panel.collapse();
        } else {
          panel.expand();
        }
      } catch {
        // Panel not yet registered in Group, ignore
      }
    }
  }, [rightPanelCollapsed, rightPanelRef]);

  if (!instanceId || !instance) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Select an instance from the toolbar to get started</p>
      </div>
    );
  }

  return (
    <Group
      orientation="horizontal"
      className="h-full w-full"
    >
      {/* Left Panel - Mod List */}
      <Panel
        id="mod-list"
        defaultSize="25"
        minSize="15"
        maxSize="40"
        collapsible
        panelRef={leftPanelRef}
      >
        <div className="h-full bg-card/30 border-r overflow-hidden">
          <PlaygroundModList />
        </div>
      </Panel>

      <Separator className="w-2 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors flex items-center justify-center data-[state=dragging]:bg-primary/50">
        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
      </Separator>

      {/* Center Panel - Console */}
      <Panel
        id="console"
        defaultSize="50"
        minSize="20"
      >
        <div className="h-full bg-background overflow-hidden">
          <PlaygroundConsole
            instanceId={instanceId}
            isRunning={isRunning}
            isServer={instance.is_server || instance.is_proxy}
          />
        </div>
      </Panel>

      <Separator className="w-2 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors flex items-center justify-center data-[state=dragging]:bg-primary/50">
        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
      </Separator>

      {/* Right Panel - Details */}
      <Panel
        id="details"
        defaultSize="25"
        minSize="15"
        maxSize="40"
        collapsible
        panelRef={rightPanelRef}
      >
        <div className="h-full bg-card/30 border-l overflow-hidden">
          <PlaygroundDetailsPanel />
        </div>
      </Panel>
    </Group>
  );
}

export default PlaygroundLayout;
