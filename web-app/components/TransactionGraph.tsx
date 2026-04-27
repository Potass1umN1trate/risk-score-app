"use client";

import { useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { NodeOut, EdgeOut } from "@/lib/analytics";

const NODE_W = 180;
const NODE_H = 48;

function truncate(addr: string): string {
  if (addr.length <= 16) return addr;
  return addr.slice(0, 8) + "…" + addr.slice(-6);
}

function formatTs(ts: number | null): string {
  if (ts === null) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function nodeStyle(n: NodeOut | { is_root: boolean; is_flagged: boolean }): React.CSSProperties {
  if (n.is_root) {
    return {
      background: "#4f46e5",
      border: "2px solid #818cf8",
      color: "#fff",
      borderRadius: 8,
      fontSize: 11,
      padding: "6px 10px",
      fontFamily: "ui-monospace, monospace",
      width: NODE_W,
    };
  }
  if (n.is_flagged) {
    return {
      background: "#450a0a",
      border: "2px solid #ef4444",
      color: "#fca5a5",
      borderRadius: 8,
      fontSize: 11,
      padding: "6px 10px",
      fontFamily: "ui-monospace, monospace",
      width: NODE_W,
    };
  }
  return {
    background: "#1a1d27",
    border: "1px solid #2d3148",
    color: "#e2e8f0",
    borderRadius: 8,
    fontSize: 11,
    padding: "6px 10px",
    fontFamily: "ui-monospace, monospace",
    width: NODE_W,
  };
}

function applyDagreLayout(
  rfNodes: Node[],
  rfEdges: Edge[]
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 40 });

  for (const n of rfNodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of rfEdges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return rfNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: pos.x - NODE_W / 2,
        y: pos.y - NODE_H / 2,
      },
    };
  });
}

function buildGraph(
  nodes: NodeOut[],
  edges: EdgeOut[],
  rootAddress: string
): { rfNodes: Node[]; rfEdges: Edge[] } {
  // Index existing nodes by address
  const nodeMap = new Map<string, NodeOut>(nodes.map((n) => [n.address, n]));

  // Ensure every address referenced by edges has a node (fallback)
  for (const e of edges) {
    for (const addr of [e.from_address, e.to_address]) {
      if (!nodeMap.has(addr)) {
        nodeMap.set(addr, {
          address: addr,
          depth: 0,
          is_root: addr === rootAddress,
          is_flagged: false,
          flag_types: [],
        });
      }
    }
  }

  const rfNodes: Node[] = Array.from(nodeMap.values()).map((n) => ({
    id: n.address,
    data: {
      label: (
        <span title={n.address}>
          {truncate(n.address)}
          {n.is_root && <span style={{ marginLeft: 4, opacity: 0.7 }}>(root)</span>}
          {n.is_flagged && (
            <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>
              [{n.flag_types.join(", ")}]
            </span>
          )}
        </span>
      ),
    },
    style: nodeStyle(n),
    position: { x: 0, y: 0 },
  }));

  const rfEdges: Edge[] = edges.map((e, i) => ({
    id: `e-${i}-${e.from_address}-${e.to_address}`,
    source: e.from_address,
    target: e.to_address,
    label: `${e.tx_count} tx`,
    labelStyle: { fontSize: 10, fill: "#8892a4" },
    labelBgStyle: { fill: "#1a1d27", fillOpacity: 0.85 },
    style: { stroke: "#4f46e5", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#4f46e5" },
    title: [
      `tx_count: ${e.tx_count}`,
      `total_amount: ${e.total_amount.toFixed(8)}`,
      `first_seen: ${formatTs(e.first_seen)}`,
      `last_seen: ${formatTs(e.last_seen)}`,
    ].join("\n"),
  }));

  return { rfNodes, rfEdges };
}

function FlowInner({
  nodes,
  edges,
  rootAddress,
}: {
  nodes: NodeOut[];
  edges: EdgeOut[];
  rootAddress: string;
}) {
  const { rfNodes: initialNodes, rfEdges: initialEdges } = buildGraph(nodes, edges, rootAddress);
  const laid = applyDagreLayout(initialNodes, initialEdges);

  const [rfNodes, , onNodesChange] = useNodesState(laid);
  const [rfEdges, , onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();

  const onInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.15 }), 50);
  }, [fitView]);

  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.15 }), 50);
  }, [fitView]);

  return (
    <div className="graph-container">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="dark"
      >
        <Background color="#2d3148" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function TransactionGraph({
  nodes,
  edges,
  rootAddress,
}: {
  nodes: NodeOut[];
  edges: EdgeOut[];
  rootAddress: string;
}) {
  if (edges.length === 0) {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
        No transaction edges found — visualization is not available.
      </p>
    );
  }

  return (
    <ReactFlowProvider>
      <FlowInner nodes={nodes} edges={edges} rootAddress={rootAddress} />
    </ReactFlowProvider>
  );
}
