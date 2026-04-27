"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import type { EdgeOut } from "@/lib/analytics";

const ROOT_COLOR = "#4f46e5";
const FLAGGED_COLOR = "#ef4444";
const NORMAL_COLOR = "#3d4268";
const LINK_COLOR = "#2d3148";
const LINK_COLOR_ROOT = "#4f46e5";
const LINK_COLOR_FLAGGED = "#7f1d1d";

const HEIGHT = 320;

function truncate(addr: string): string {
  if (addr.length <= 14) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-6);
}

function formatTs(ts: number | null): string {
  if (ts === null) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// Node shape after d3-sankey layout fills in coordinates.
interface LayoutNode {
  id: string;
  label: string;
  isRoot: boolean;
  isFlagged: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// Link shape after d3-sankey layout fills in coordinates.
interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  value: number;
  txCount: number;
  totalAmount: number;
  firstSeen: number | null;
  lastSeen: number | null;
  width: number;
  y0: number;
  y1: number;
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

  // "layoutError" is distinct from "no edges": it means edges exist but layout failed.
  const { layoutNodes, layoutLinks, layoutError } = useMemo(() => {
    if (edges.length === 0) {
      return { layoutNodes: null, layoutLinks: null, layoutError: false };
    }

    // 1. Collect unique addresses in stable insertion order.
    const addrOrder: string[] = [];
    const addrIndex = new Map<string, number>();
    for (const e of edges) {
      for (const addr of [e.from_address, e.to_address]) {
        if (!addrIndex.has(addr)) {
          addrIndex.set(addr, addrOrder.length);
          addrOrder.push(addr);
        }
      }
    }

    // 2. Build node objects. d3-sankey uses array position as the implicit id
    //    when no .nodeId() is configured — so we do NOT call .nodeId().
    const nodeInput = addrOrder.map((addr) => ({
      id: addr,
      label: truncate(addr),
      isRoot: addr === rootAddress,
      isFlagged: flaggedSet.has(addr),
    }));

    // 3. Collapse parallel edges and build link objects with numeric indexes.
    const linkMap = new Map<string, {
      source: number;
      target: number;
      value: number;
      txCount: number;
      totalAmount: number;
      firstSeen: number | null;
      lastSeen: number | null;
    }>();

    for (const e of edges) {
      const si = addrIndex.get(e.from_address);
      const ti = addrIndex.get(e.to_address);
      if (si === undefined || ti === undefined) continue;

      const rawVal = e.total_amount > 0 ? e.total_amount : e.tx_count;
      const val = Number.isFinite(rawVal) && rawVal > 0 ? rawVal : e.tx_count;
      if (!Number.isFinite(val) || val <= 0) continue;

      const key = `${si}||${ti}`;
      const ex = linkMap.get(key);
      if (ex) {
        ex.txCount += e.tx_count;
        ex.totalAmount += e.total_amount;
        const merged = ex.totalAmount > 0 ? ex.totalAmount : ex.txCount;
        ex.value = Number.isFinite(merged) && merged > 0 ? merged : 0.001;
      } else {
        linkMap.set(key, {
          source: si,
          target: ti,
          value: Math.max(val, 0.001),
          txCount: e.tx_count,
          totalAmount: e.total_amount,
          firstSeen: e.first_seen,
          lastSeen: e.last_seen,
        });
      }
    }

    if (linkMap.size === 0) {
      return { layoutNodes: null, layoutLinks: null, layoutError: true };
    }

    const linkInput = Array.from(linkMap.values());

    // 4. Run d3-sankey layout. No .nodeId() — source/target are plain numeric indexes.
    const gen = sankey()
      .nodeWidth(16)
      .nodePadding(12)
      .extent([
        [24, 16],
        [width - 24, HEIGHT - 16],
      ]);

    let result: ReturnType<typeof gen>;
    try {
      result = gen({ nodes: nodeInput as never[], links: linkInput as never[] });
    } catch {
      return { layoutNodes: null, layoutLinks: null, layoutError: true };
    }

    return {
      layoutNodes: result.nodes as unknown as LayoutNode[],
      layoutLinks: result.links as unknown as LayoutLink[],
      layoutError: false,
    };
  }, [edges, rootAddress, flaggedSet, width]);

  // Case 1: no edges at all
  if (edges.length === 0) {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
        No transaction edges found — visualization is not available.
      </p>
    );
  }

  // Case 2: edges exist but layout failed
  if (layoutError || !layoutNodes || !layoutLinks) {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
        Transaction flow layout could not be generated.
      </p>
    );
  }

  return (
    <div ref={containerRef} className="sankey-container">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: "visible" }}
      >
        {/* Links */}
        {layoutLinks.map((link, i) => {
          const path = sankeyLinkHorizontal()(link as never) ?? "";
          const linkColor = link.source.isRoot
            ? LINK_COLOR_ROOT
            : link.source.isFlagged
            ? LINK_COLOR_FLAGGED
            : LINK_COLOR;

          const title = [
            `${link.source.id} → ${link.target.id}`,
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
        {layoutNodes.map((node, i) => {
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
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={nodeColor} rx={3}>
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
