import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { DependencyEdgeData } from "@/types/playground";

function DependencyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
  });

  const edgeData = data as DependencyEdgeData | undefined;

  const getEdgeStyle = () => {
    switch (edgeData?.type) {
      case "required":
        return {
          stroke: "hsl(142, 76%, 36%)", // green-500
          strokeWidth: 2,
          strokeDasharray: undefined,
        };
      case "optional":
        return {
          stroke: "hsl(45, 93%, 47%)", // amber-500
          strokeWidth: 1.5,
          strokeDasharray: "5,5",
        };
      case "missing":
        return {
          stroke: "hsl(0, 84%, 60%)", // red-500
          strokeWidth: 2,
          strokeDasharray: undefined,
        };
      default:
        return {
          stroke: "hsl(var(--muted-foreground))",
          strokeWidth: 1.5,
          strokeDasharray: "5,5",
        };
    }
  };

  const style = getEdgeStyle();

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          opacity: selected ? 1 : 0.7,
          transition: "opacity 0.2s",
        }}
        className={cn(edgeData?.type === "missing" && "animate-pulse")}
      />

      {/* Edge label for missing dependencies */}
      {edgeData?.type === "missing" && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-medium"
          >
            Missing
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const DependencyEdge = memo(DependencyEdgeComponent);
