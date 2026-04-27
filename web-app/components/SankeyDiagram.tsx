"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import type { EdgeOut } from "@/lib/analytics";

const ROOT_COLOR = "#4f46e5";
const ROOT_BORDER = "#818cf8";
const FLAGGED_COLOR = "#ef4444";
const FLAGGED_BG = "#450a0a";
const NORMAL_COLOR = "#3d4268";
const FLOW_IN_COLOR = "#4f46e5";
const FLOW_OUT_COLOR = "#6366f1";
const FLOW_FLAGGED_COLOR = "#7f1d1d";

const SVG_HEIGHT = 360;
const NODE_W_SIDE = 14;
const NODE_W_ROOT = 28;
const ROOT_H_MIN = 60;
const NODE_H_MIN = 18;
const NODE_H_MAX = 48;
const COL_MARGIN = 96; // distance from SVG edge to node column
const LABEL_OFFSET = 8;
const FONT_SIZE = 10;
const STROKE_MIN = 2;
const STROKE_MAX = 24;
const MAX_VISIBLE_NODES = 20;
const PADDING_Y = 20;

function truncate(addr: string): string {
  if (addr.length <= 14) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-6);
}

function formatTs(ts: number | null): string {
  if (ts === null) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function strokeWidth(txCount: number, maxTx: number): number {
  if (maxTx <= 0) return STROKE_MIN;
  // sqrt scale, clamped to [STROKE_MIN, STROKE_MAX]
  const ratio = Math.sqrt(txCount) / Math.sqrt(maxTx);
  return STROKE_MIN + ratio * (STROKE_MAX - STROKE_MIN);
}

interface FlowItem {
  normKey: string;
  originalAddr: string;
  txCount: number;
  totalAmount: number;
  firstSeen: number | null;
  lastSeen: number | null;
  isFlagged: boolean;
}

function buildFlows(
  edges: EdgeOut[],
  normRoot: string,
  flaggedSet: Set<string>
): { incoming: FlowItem[]; outgoing: FlowItem[] } {
  const inMap = new Map<string, FlowItem>();
  const outMap = new Map<string, FlowItem>();

  for (const e of edges) {
    const normFrom = e.from_address.trim().toLowerCase();
    const normTo = e.to_address.trim().toLowerCase();

    if (normTo === normRoot) {
      // incoming: counterparty → root
      const key = normFrom;
      const ex = inMap.get(key);
      if (ex) {
        ex.txCount += e.tx_count;
        ex.totalAmount += e.total_amount;
        if (e.first_seen !== null) {
          ex.firstSeen = ex.firstSeen === null ? e.first_seen : Math.min(ex.firstSeen, e.first_seen);
        }
        if (e.last_seen !== null) {
          ex.lastSeen = ex.lastSeen === null ? e.last_seen : Math.max(ex.lastSeen, e.last_seen);
        }
      } else {
        inMap.set(key, {
          normKey: key,
          originalAddr: e.from_address,
          txCount: e.tx_count,
          totalAmount: e.total_amount,
          firstSeen: e.first_seen,
          lastSeen: e.last_seen,
          isFlagged: flaggedSet.has(key),
        });
      }
    } else if (normFrom === normRoot) {
      // outgoing: root → counterparty
      const key = normTo;
      const ex = outMap.get(key);
      if (ex) {
        ex.txCount += e.tx_count;
        ex.totalAmount += e.total_amount;
        if (e.first_seen !== null) {
          ex.firstSeen = ex.firstSeen === null ? e.first_seen : Math.min(ex.firstSeen, e.first_seen);
        }
        if (e.last_seen !== null) {
          ex.lastSeen = ex.lastSeen === null ? e.last_seen : Math.max(ex.lastSeen, e.last_seen);
        }
      } else {
        outMap.set(key, {
          normKey: key,
          originalAddr: e.to_address,
          txCount: e.tx_count,
          totalAmount: e.total_amount,
          firstSeen: e.first_seen,
          lastSeen: e.last_seen,
          isFlagged: flaggedSet.has(key),
        });
      }
    }
    // deeper non-root edges are silently ignored
  }

  // Sort descending by txCount for readability; cap at MAX_VISIBLE_NODES
  const sortDesc = (a: FlowItem, b: FlowItem) => b.txCount - a.txCount;
  return {
    incoming: Array.from(inMap.values()).sort(sortDesc).slice(0, MAX_VISIBLE_NODES),
    outgoing: Array.from(outMap.values()).sort(sortDesc).slice(0, MAX_VISIBLE_NODES),
  };
}

function distributeY(count: number, height: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [height / 2];
  const step = (height - PADDING_Y * 2) / (count - 1);
  return Array.from({ length: count }, (_, i) => PADDING_Y + i * step);
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

  const normRoot = rootAddress.trim().toLowerCase();
  const flaggedSet = useMemo(
    () => new Set(flaggedAddresses.map((a) => a.trim().toLowerCase())),
    [flaggedAddresses]
  );

  const { incoming, outgoing } = useMemo(
    () => buildFlows(edges, normRoot, flaggedSet),
    [edges, normRoot, flaggedSet]
  );

  // Empty state: no root-adjacent edges at all
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
        No root-adjacent transaction edges found — Sankey flow is not available.
      </p>
    );
  }

  // Layout computation wrapped in try/catch for layout-error fallback
  let svgContent: React.ReactNode;
  try {
    // X positions
    const leftX = COL_MARGIN;
    const rightX = width - COL_MARGIN - NODE_W_SIDE;
    const rootX = (width - NODE_W_ROOT) / 2;

    // Compute node height per side based on count
    const inH = Math.min(NODE_H_MAX, Math.max(NODE_H_MIN, (SVG_HEIGHT - PADDING_Y * 2) / Math.max(incoming.length, 1) - 8));
    const outH = Math.min(NODE_H_MAX, Math.max(NODE_H_MIN, (SVG_HEIGHT - PADDING_Y * 2) / Math.max(outgoing.length, 1) - 8));

    // Y centers for counterparty nodes
    const inYCenters = distributeY(incoming.length, SVG_HEIGHT);
    const outYCenters = distributeY(outgoing.length, SVG_HEIGHT);

    // Root height: proportional to total tx volume, between ROOT_H_MIN and SVG_HEIGHT - PADDING_Y * 2
    const totalTx = [...incoming, ...outgoing].reduce((s, f) => s + f.txCount, 0);
    const rootH = Math.min(SVG_HEIGHT - PADDING_Y * 2, Math.max(ROOT_H_MIN, Math.sqrt(totalTx) * 8));
    const rootY = (SVG_HEIGHT - rootH) / 2;

    // Max tx across all flows for stroke scaling
    const maxTx = Math.max(...[...incoming, ...outgoing].map((f) => f.txCount), 1);

    // Connection anchors on root rect
    const rootInY = (f: FlowItem, i: number) => {
      // incoming connects to left side of root, spread vertically
      const span = rootH * 0.8;
      const step = incoming.length > 1 ? span / (incoming.length - 1) : 0;
      return rootY + rootH * 0.1 + i * step;
    };
    const rootOutY = (f: FlowItem, i: number) => {
      const span = rootH * 0.8;
      const step = outgoing.length > 1 ? span / (outgoing.length - 1) : 0;
      return rootY + rootH * 0.1 + i * step;
    };

    // Cubic bezier control point X (halfway between columns)
    const inMidX = (leftX + NODE_W_SIDE + rootX) / 2;
    const outMidX = (rootX + NODE_W_ROOT + rightX) / 2;

    svgContent = (
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: "visible" }}
      >
        {/* Incoming flows: counterparty → root */}
        {incoming.map((flow, i) => {
          const cy = inYCenters[i];
          const ry = rootInY(flow, i);
          // Source anchor: right side of left node
          const sx = leftX + NODE_W_SIDE;
          // Target anchor: left side of root
          const tx = rootX;
          const sw = strokeWidth(flow.txCount, maxTx);
          const color = flow.isFlagged ? FLOW_FLAGGED_COLOR : FLOW_IN_COLOR;

          const title = [
            `${flow.originalAddr} → ${rootAddress}`,
            `tx_count: ${flow.txCount}`,
            `total_amount: ${flow.totalAmount.toFixed(8)}`,
            `first_seen: ${formatTs(flow.firstSeen)}`,
            `last_seen: ${formatTs(flow.lastSeen)}`,
          ].join("\n");

          return (
            <path
              key={`in-${i}`}
              d={`M ${sx} ${cy} C ${inMidX} ${cy}, ${inMidX} ${ry}, ${tx} ${ry}`}
              fill="none"
              stroke={color}
              strokeWidth={sw}
              strokeOpacity={0.5}
              style={{ cursor: "default" }}
            >
              <title>{title}</title>
            </path>
          );
        })}

        {/* Outgoing flows: root → counterparty */}
        {outgoing.map((flow, i) => {
          const cy = outYCenters[i];
          const ry = rootOutY(flow, i);
          // Source anchor: right side of root
          const sx = rootX + NODE_W_ROOT;
          // Target anchor: left side of right node
          const tx = rightX;
          const sw = strokeWidth(flow.txCount, maxTx);
          const color = flow.isFlagged ? FLOW_FLAGGED_COLOR : FLOW_OUT_COLOR;

          const title = [
            `${rootAddress} → ${flow.originalAddr}`,
            `tx_count: ${flow.txCount}`,
            `total_amount: ${flow.totalAmount.toFixed(8)}`,
            `first_seen: ${formatTs(flow.firstSeen)}`,
            `last_seen: ${formatTs(flow.lastSeen)}`,
          ].join("\n");

          return (
            <path
              key={`out-${i}`}
              d={`M ${sx} ${ry} C ${outMidX} ${ry}, ${outMidX} ${cy}, ${tx} ${cy}`}
              fill="none"
              stroke={color}
              strokeWidth={sw}
              strokeOpacity={0.5}
              style={{ cursor: "default" }}
            >
              <title>{title}</title>
            </path>
          );
        })}

        {/* Root node */}
        <rect
          x={rootX}
          y={rootY}
          width={NODE_W_ROOT}
          height={rootH}
          fill={ROOT_COLOR}
          stroke={ROOT_BORDER}
          strokeWidth={2}
          rx={4}
        >
          <title>{rootAddress}</title>
        </rect>
        <text
          x={rootX + NODE_W_ROOT / 2}
          y={rootY - 7}
          fontSize={FONT_SIZE}
          fill="#818cf8"
          textAnchor="middle"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          {truncate(rootAddress)}
        </text>

        {/* Incoming counterparty nodes (left column) */}
        {incoming.map((flow, i) => {
          const cy = inYCenters[i];
          const nodeY = cy - inH / 2;
          const color = flow.isFlagged ? FLAGGED_COLOR : NORMAL_COLOR;
          const bgColor = flow.isFlagged ? FLAGGED_BG : undefined;
          const textX = leftX - LABEL_OFFSET;

          return (
            <g key={`in-node-${i}`}>
              <rect
                x={leftX}
                y={nodeY}
                width={NODE_W_SIDE}
                height={inH}
                fill={bgColor ?? color}
                stroke={color}
                strokeWidth={flow.isFlagged ? 1.5 : 0}
                rx={3}
              >
                <title>{flow.originalAddr}</title>
              </rect>
              {inH >= 12 && (
                <text
                  x={textX}
                  y={cy}
                  dy="0.35em"
                  fontSize={FONT_SIZE}
                  fill={flow.isFlagged ? "#fca5a5" : "#8892a4"}
                  textAnchor="end"
                  style={{ fontFamily: "ui-monospace, monospace" }}
                >
                  {truncate(flow.originalAddr)}
                </text>
              )}
            </g>
          );
        })}

        {/* Outgoing counterparty nodes (right column) */}
        {outgoing.map((flow, i) => {
          const cy = outYCenters[i];
          const nodeY = cy - outH / 2;
          const color = flow.isFlagged ? FLAGGED_COLOR : NORMAL_COLOR;
          const bgColor = flow.isFlagged ? FLAGGED_BG : undefined;
          const textX = rightX + NODE_W_SIDE + LABEL_OFFSET;

          return (
            <g key={`out-node-${i}`}>
              <rect
                x={rightX}
                y={nodeY}
                width={NODE_W_SIDE}
                height={outH}
                fill={bgColor ?? color}
                stroke={color}
                strokeWidth={flow.isFlagged ? 1.5 : 0}
                rx={3}
              >
                <title>{flow.originalAddr}</title>
              </rect>
              {outH >= 12 && (
                <text
                  x={textX}
                  y={cy}
                  dy="0.35em"
                  fontSize={FONT_SIZE}
                  fill={flow.isFlagged ? "#fca5a5" : "#8892a4"}
                  textAnchor="start"
                  style={{ fontFamily: "ui-monospace, monospace" }}
                >
                  {truncate(flow.originalAddr)}
                </text>
              )}
            </g>
          );
        })}

        {/* Direction arrows as small SVG text labels */}
        {incoming.length > 0 && (
          <text
            x={(leftX + NODE_W_SIDE + rootX) / 2}
            y={SVG_HEIGHT - 6}
            fontSize={9}
            fill="#4b5270"
            textAnchor="middle"
          >
            incoming →
          </text>
        )}
        {outgoing.length > 0 && (
          <text
            x={(rootX + NODE_W_ROOT + rightX) / 2}
            y={SVG_HEIGHT - 6}
            fontSize={9}
            fill="#4b5270"
            textAnchor="middle"
          >
            → outgoing
          </text>
        )}
      </svg>
    );
  } catch {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
        Transaction flow layout could not be generated.
      </p>
    );
  }

  return (
    <div ref={containerRef} className="sankey-container">
      {svgContent}

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
        <span className="sankey-legend-item" style={{ color: "#6366f1" }}>
          <span className="sankey-dot" style={{ background: FLOW_IN_COLOR, width: 16, height: 4, borderRadius: 2, display: "inline-block" }} />
          Incoming flow
        </span>
        <span className="sankey-legend-item" style={{ color: "#818cf8" }}>
          <span className="sankey-dot" style={{ background: FLOW_OUT_COLOR, width: 16, height: 4, borderRadius: 2, display: "inline-block" }} />
          Outgoing flow
        </span>
      </div>
    </div>
  );
}
