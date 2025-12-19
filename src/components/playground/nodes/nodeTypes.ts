import type { NodeTypes } from "@xyflow/react";
import { InstanceNode } from "./InstanceNode";
import { ModNode } from "./ModNode";
import { ConfigNode } from "./ConfigNode";

export const nodeTypes: NodeTypes = {
  instance: InstanceNode,
  mod: ModNode,
  config: ConfigNode,
};
