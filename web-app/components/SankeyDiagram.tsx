"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import type { EdgeOut } from "@/lib/analytics";

const ROOT_COLOR = "#4f46e5";
const FLAGGED_COLOR = "#ef4444";
const NORMAL_COLOR = "#3d4268";
const LINK_COLOR = "#2d3148";
const LINK_COLOR_ROOT = "#4f46e5";
const LINK_COLOR_FLAGGED = "#7f1d1d";

function truncate(addr: string): string {
  if (addr.length <= 14) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-6);
}

function formatTs(ts: number | null): string {
  if (ts === null) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

interface SankeyNodeDatum {
  id: string;
  label: string;
  isRoot: boolean;
  isFlagged: boolean;
  // d3-sankey fills these in
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  index?: number;
}

interface SankeyLinkDatum {
  source: number | SankeyNodeDatum;
  target: number | SankeyNodeDatum;
  value: number;
  txCount: number;
  totalAmount: number;
  firstSeen: number | null;
  lastSeen: number | null;
  // d3-sankey fills these in
  width?: number;
  y0?: number;
  y1?: number;
  index?: number;
}

export default function SankeyDiagram({
  edges,
  rootAddress,
  flaggedAddresses,
}: {
  edges: EdgeOut[];
  rootAddress: string;
  flaggedAddresses: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setWidth(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const flaggedSet = useMemo(() => new Set(flaggedAddresses), [flaggedAddresses]);

  const graph = useMemo((): SankeyGraph<SankeyNodeDatum, SankeyLinkDatum> | null => {
    if (edges.length === 0) return null;

    const addrSet = new Set<string>();
    for (const e of edges) {
      addrSet.add(e.from_address);
      addrSet.add(e.to_address);
    }

    const nodeList: SankeyNodeDatum[] = Array.from(addrSet).map((addr) => ({
      id: addr,
      label: truncate(addr),
      isRoot: addr === rootAddress,
      isFlagged: flaggedSet.has(addr),
    }));

    const addrIndex = new Map(nodeList.map((n, i) => [n.id, i]));

    // Collapse parallel edges (same from→to) into one link
    const linkMap = new Map<string, SankeyLinkDatum>();
    for (const e of edges) {
      const key = `${e.from_address}||${e.to_address}`;
      const existing = linkMap.get(key);
      if (existing) {
        existing.txCount += e.tx_count;
        existing.totalAmount += e.total_amount;
        existing.value = existing.totalAmount > 0 ? existing.totalAmount : existing.txCount;
      } else {
        const val = e.total_amount > 0 ? e.total_amount : e.tx_count;
        linkMap.set(key, {
          source: addrIndex.get(e.from_address)!,
          target: addrIndex.get(e.to_address)!,
          value: Math.max(val, 0.001),
          txCount: e.tx_count,
          totalAmount: e.total_amount,
          firstSeen: e.first_seen,
          lastSeen: e.last_seen,
        });
      }
    }

    const linkList = Array.from(linkMap.values());

    const HEIGHT = 320;
    const gen = sankey<SankeyNodeDatum, SankeyLinkDatum>()
      .nodeId((d) => d.id)
      .nodeWidth(16)
      .nodePadding(12)
      .extent([
        [24, 16],
        [width - 24, HEIGHT - 16],
      ]);

    try {
      return gen({ nodes: nodeList, links: linkList });
    } catch {
      return null;
    }
  }, [edges, rootAddress, flaggedSet, width]);

  if (edges.length === 0 || !graph) {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
        No transaction edges found — visualization is not available.
      </p>
    );
  }

  const HEIGHT = 320;

  return (
    <div ref={containerRef} className="sankey-container">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: "visible" }}
      >
        {/* Links */}
        {graph.links.map((link, i) => {
          const srcNode = link.source as SankeyNodeDatum;
          const path = sankeyLinkHorizontal()(link as never) ?? "";
          const linkColor = srcNode.isRoot
            ? LINK_COLOR_ROOT
            : srcNode.isFlagged
            ? LINK_COLOR_FLAGGED
            : LINK_COLOR;

          const title = [
            `${(link.source as SankeyNodeDatum).id} → ${(link.target as SankeyNodeDatum).id}`,
            `tx_count: ${link.txCount}`,
            `total_amount: ${link.totalAmount.toFixed(8)}`,
            `first_seen: ${formatTs(link.firstSeen)}`,
            `last_seen: ${formatTs(link.lastSeen)}`,
          ].join("\n");

          return (
            <path
              key={i}
              d={path}
              fill="none"
              stroke={linkColor}
              strokeWidth={Math.max(link.width ?? 1, 1)}
              strokeOpacity={0.45}
              style={{ cursor: "default" }}
            >
              <title>{title}</title>
            </path>
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node, i) => {
          const x0 = node.x0 ?? 0;
          const x1 = node.x1 ?? 0;
          const y0 = node.y0 ?? 0;
          const y1 = node.y1 ?? 0;
          const nodeColor = node.isRoot
            ? ROOT_COLOR
            : node.isFlagged
            ? FLAGGED_COLOR
            : NORMAL_COLOR;
          const textX = x1 < width / 2 ? x1 + 6 : x0 - 6;
          const textAnchor = x1 < width / 2 ? "start" : "end";

          return (
            <g key={i}>
              <rect
                x={x0}
                y={y0}
                width={x1 - x0}
                height={y1 - y0}
                fill={nodeColor}
                rx={3}
              >
                <title>{node.id}</title>
              </rect>
              <text
                x={textX}
                y={(y0 + y1) / 2}
                dy="0.35em"
                fontSize={10}
                fill="#8892a4"
                textAnchor={textAnchor}
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="sankey-legend">
        <span className="sankey-legend-item" style={{ color: "#818cf8" }}>
          <span className="sankey-dot" style={{ background: ROOT_COLOR }} />
          Root
        </span>
        <span className="sankey-legend-item" style={{ color: "#fca5a5" }}>
          <span className="sankey-dot" style={{ background: FLAGGED_COLOR }} />
          Flagged
        </span>
        <span className="sankey-legend-item" style={{ color: "#8892a4" }}>
          <span className="sankey-dot" style={{ background: NORMAL_COLOR }} />
          Normal
        </span>
      </div>
    </div>
  );
}
