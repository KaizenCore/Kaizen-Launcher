import { useCallback, useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type OnConnect,
  type Node,
  type Edge,
  type NodeChange,
  type OnNodesChange,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { usePlaygroundLayout } from "./hooks";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { InstanceNodeData, ModNodeData } from "@/types/playground";
import { cn } from "@/lib/utils";

interface PlaygroundCanvasProps {
  className?: string;
}

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

function PlaygroundCanvasInner({ className }: PlaygroundCanvasProps) {
  const instance = usePlaygroundStore((s) => s.instance);
  const mods = usePlaygroundStore((s) => s.mods);
  const isRunning = usePlaygroundStore((s) => s.isRunning);
  const isInstalled = usePlaygroundStore((s) => s.isInstalled);
  const selectedNodeId = usePlaygroundStore((s) => s.selectedNodeId);
  const showOptionalDeps = usePlaygroundStore((s) => s.showOptionalDeps);
  const configNodes = usePlaygroundStore((s) => s.configNodes);
  const focusNodeId = usePlaygroundStore((s) => s.focusNodeId);
  const selectNode = usePlaygroundStore((s) => s.selectNode);
  const clearFocusNode = usePlaygroundStore((s) => s.clearFocusNode);
  const updateConfigNodePosition = usePlaygroundStore((s) => s.updateConfigNodePosition);
  const updateConfigNodeSize = usePlaygroundStore((s) => s.updateConfigNodeSize);

  const { calculateLayout } = usePlaygroundLayout();
  const { setCenter, getNode } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isLayoutCalculated, setIsLayoutCalculated] = useState(false);

  // Track config node positions and sizes locally (survives re-renders)
  const configNodeStateRef = useRef<Map<string, {
    position: { x: number; y: number };
    width?: number;
    height?: number;
  }>>(new Map());

  // Calculate layout when mods change
  useEffect(() => {
    if (!instance) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Merge store config nodes with locally tracked positions and sizes
    const configNodesWithState = configNodes.map((node) => {
      const savedState = configNodeStateRef.current.get(node.id);
      if (savedState) {
        return {
          ...node,
          position: savedState.position,
          ...(savedState.width && savedState.height ? {
            style: { ...node.style, width: savedState.width, height: savedState.height },
            width: savedState.width,
            height: savedState.height,
          } : {}),
        };
      }
      // Initialize state for new nodes
      configNodeStateRef.current.set(node.id, {
        position: node.position,
        width: node.width,
        height: node.height,
      });
      return node;
    });

    // Clean up refs for removed nodes
    const currentNodeIds = new Set(configNodes.map(n => n.id));
    for (const id of configNodeStateRef.current.keys()) {
      if (!currentNodeIds.has(id)) {
        configNodeStateRef.current.delete(id);
      }
    }

    const { nodes: layoutNodes, edges: layoutEdges } = calculateLayout(
      mods,
      showOptionalDeps,
      { centerX: 500, centerY: 400, existingConfigNodes: configNodesWithState }
    );

    // Inject instance data into instance node
    const nodesWithData = layoutNodes.map((node) => {
      if (node.id === "instance") {
        return {
          ...node,
          data: {
            instance,
            isRunning,
            isInstalled,
          } as InstanceNodeData,
        };
      }
      return node;
    });

    // Update selected state on mod nodes
    const nodesWithSelection = nodesWithData.map((node) => {
      if (node.type === "mod" && node.data) {
        return {
          ...node,
          data: {
            ...node.data,
            isSelected: node.id === selectedNodeId,
          } as ModNodeData,
        };
      }
      return node;
    });

    setNodes(nodesWithSelection);
    setEdges(layoutEdges);
    setIsLayoutCalculated(true);
  }, [
    instance,
    mods,
    isRunning,
    isInstalled,
    showOptionalDeps,
    selectedNodeId,
    configNodes,
    calculateLayout,
    setNodes,
    setEdges,
  ]);

  // Focus on a specific node when focusNodeId changes
  useEffect(() => {
    if (!focusNodeId) return;

    // Small delay to ensure nodes are rendered
    const timer = setTimeout(() => {
      const node = getNode(focusNodeId);
      if (node) {
        // Calculate center of the node
        const nodeWidth = node.width || 200;
        const nodeHeight = node.height || 100;
        const x = node.position.x + nodeWidth / 2;
        const y = node.position.y + nodeHeight / 2;

        setCenter(x, y, { zoom: 1, duration: 500 });
      }
      clearFocusNode();
    }, 100);

    return () => clearTimeout(timer);
  }, [focusNodeId, getNode, setCenter, clearFocusNode]);

  // Custom nodes change handler to track config node positions and sizes
  const handleNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        // Handle position changes (drag)
        if (change.type === "position" && change.id.startsWith("config-")) {
          if (change.position) {
            const current = configNodeStateRef.current.get(change.id) || { position: change.position };
            configNodeStateRef.current.set(change.id, {
              ...current,
              position: change.position,
            });
          }

          // When drag ends, save to store
          if (change.dragging === false && change.position) {
            updateConfigNodePosition(change.id, change.position);
          }
        }

        // Handle dimension changes (resize)
        if (change.type === "dimensions" && change.id.startsWith("config-")) {
          if (change.dimensions?.width && change.dimensions?.height) {
            const current = configNodeStateRef.current.get(change.id);
            if (current) {
              configNodeStateRef.current.set(change.id, {
                ...current,
                width: change.dimensions.width,
                height: change.dimensions.height,
              });
            }

            // When resize ends, save to store
            if (change.resizing === false) {
              updateConfigNodeSize(change.id, change.dimensions.width, change.dimensions.height);
            }
          }
        }
      }

      // Apply the changes to local state
      onNodesChange(changes);
    },
    [onNodesChange, updateConfigNodePosition, updateConfigNodeSize]
  );

  // Handle node selection
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node.id === "instance" ? null : node.id);
    },
    [selectNode]
  );

  // Handle pane click (deselect)
  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Don't connect edges manually
  const onConnect: OnConnect = useCallback(() => {
    // Edges are managed by dependencies, not user connections
  }, []);

  return (
    <div className={cn("w-full h-full", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={isLayoutCalculated}
        fitViewOptions={{
          padding: 0.2,
          maxZoom: 1,
        }}
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--muted-foreground) / 0.2)"
        />
        <Controls
          showInteractive={false}
          className="bg-card border rounded-lg shadow-lg"
        />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === "instance") return "hsl(var(--primary))";
            if (node.type === "config") return "hsl(var(--primary) / 0.7)";
            const modData = node.data as ModNodeData | undefined;
            if (modData?.hasMissingDeps) return "hsl(0, 84%, 60%)";
            if (modData?.mod?.enabled === false) return "hsl(var(--muted))";
            return "hsl(var(--card))";
          }}
          maskColor="hsl(var(--background) / 0.8)"
          className="bg-card border rounded-lg shadow-lg"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// Wrap with ReactFlowProvider to enable useReactFlow hook
export function PlaygroundCanvas({ className }: PlaygroundCanvasProps) {
  return (
    <ReactFlowProvider>
      <PlaygroundCanvasInner className={className} />
    </ReactFlowProvider>
  );
}
