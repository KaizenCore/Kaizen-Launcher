import { useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { ModInfoWithDependencies, ModNodeData, ConfigNodeData } from "@/types/playground";

const MOD_NODE_WIDTH = 260;
const MOD_NODE_HEIGHT = 110;
const INSTANCE_WIDTH = 320;
const INSTANCE_HEIGHT = 200;

// Grid layout configuration
const ROW_GAP = 40;
const COL_GAP = 40;
const INSTANCE_TO_MODS_GAP = 100;

// Calculate optimal columns based on mod count
function getColumnsForModCount(modCount: number): number {
  if (modCount <= 4) return Math.min(modCount, 4);
  if (modCount <= 12) return 4;
  if (modCount <= 20) return 5;
  if (modCount <= 36) return 6;
  if (modCount <= 56) return 7;
  if (modCount <= 80) return 8;
  if (modCount <= 108) return 9;
  return 10; // Max 10 columns for very large modpacks
}

interface LayoutOptions {
  centerX?: number;
  centerY?: number;
  existingConfigNodes?: Node[];
}

export function usePlaygroundLayout() {
  const calculateLayout = useCallback(
    (
      mods: ModInfoWithDependencies[],
      showOptionalDeps: boolean,
      options: LayoutOptions = {}
    ): { nodes: Node[]; edges: Edge[] } => {
      const { centerX = 600, centerY = 150, existingConfigNodes = [] } = options;

      const nodes: Node[] = [];
      const edges: Edge[] = [];

      // Build project_id to mod mapping
      const modByProjectId = new Map<string, ModInfoWithDependencies>();
      for (const mod of mods) {
        if (mod.project_id) {
          modByProjectId.set(mod.project_id, mod);
        }
      }

      // Add instance node at top center
      const instanceX = centerX - INSTANCE_WIDTH / 2;
      const instanceY = centerY;

      nodes.push({
        id: "instance",
        type: "instance",
        position: { x: instanceX, y: instanceY },
        data: {},
      });

      // Calculate grid layout for mods
      const numMods = mods.length;
      const modsPerRow = getColumnsForModCount(numMods);
      const numRows = Math.ceil(numMods / modsPerRow);
      const gridStartY = instanceY + INSTANCE_HEIGHT + INSTANCE_TO_MODS_GAP;

      // Add mod nodes in grid
      mods.forEach((mod, index) => {
        const row = Math.floor(index / modsPerRow);
        const col = index % modsPerRow;

        // Center incomplete rows
        const modsInThisRow = row === numRows - 1
          ? numMods - (numRows - 1) * modsPerRow
          : modsPerRow;
        const rowWidth = modsInThisRow * (MOD_NODE_WIDTH + COL_GAP) - COL_GAP;
        const rowStartX = centerX - rowWidth / 2;

        const x = rowStartX + col * (MOD_NODE_WIDTH + COL_GAP);
        const y = gridStartY + row * (MOD_NODE_HEIGHT + ROW_GAP);

        const modNodeData: ModNodeData = {
          mod,
          hasUpdate: false,
          hasMissingDeps: mod.dependencies.some(
            (d) =>
              d.dependency_type === "required" &&
              !modByProjectId.has(d.project_id)
          ),
          isSelected: false,
        };

        nodes.push({
          id: mod.filename,
          type: "mod",
          position: { x, y },
          data: modNodeData,
        });

        // Add edge from instance to mod
        edges.push({
          id: `instance-${mod.filename}`,
          source: "instance",
          target: mod.filename,
          type: "smoothstep",
          animated: false,
          className: "stroke-muted-foreground/30",
          style: { strokeWidth: 1 },
        });
      });

      // Add dependency edges between mods
      for (const mod of mods) {
        if (!mod.project_id) continue;

        for (const dep of mod.dependencies) {
          if (!showOptionalDeps && dep.dependency_type === "optional") continue;
          if (dep.dependency_type === "incompatible") continue;

          const targetMod = modByProjectId.get(dep.project_id);

          if (targetMod) {
            edges.push({
              id: `dep-${mod.filename}-${targetMod.filename}`,
              source: mod.filename,
              target: targetMod.filename,
              type: "dependency",
              data: {
                type: dep.dependency_type === "optional" ? "optional" : "required",
                sourceMod: mod.name,
                targetMod: targetMod.name,
              },
            });
          }
        }
      }

      // Add existing config nodes (preserve their positions)
      for (const configNode of existingConfigNodes) {
        nodes.push(configNode);

        // Add edge from mod to config
        if (configNode.data && (configNode.data as ConfigNodeData).modFilename) {
          const modFilename = (configNode.data as ConfigNodeData).modFilename;
          edges.push({
            id: `config-${configNode.id}`,
            source: modFilename,
            target: configNode.id,
            type: "smoothstep",
            animated: true,
            className: "stroke-primary",
            style: { strokeWidth: 2 },
          });
        }
      }

      return { nodes, edges };
    },
    []
  );

  // Helper to create a config node for a mod
  const createConfigNode = useCallback(
    (
      mod: ModInfoWithDependencies,
      modNodePosition: { x: number; y: number },
      configPath?: string
    ): Node => {
      const configNodeData: ConfigNodeData = {
        modFilename: mod.filename,
        modName: mod.name,
        configPath: configPath || null,
        isEditing: false,
      };

      return {
        id: `config-${mod.filename}-${Date.now()}`,
        type: "config",
        position: {
          x: modNodePosition.x + MOD_NODE_WIDTH + 50,
          y: modNodePosition.y,
        },
        data: configNodeData,
        style: { width: 400, height: 400 },
        width: 400,
        height: 400,
      };
    },
    []
  );

  return { calculateLayout, createConfigNode, MOD_NODE_WIDTH, MOD_NODE_HEIGHT };
}
