// lib/propagateRiskByHalving.ts

type Link = { source: string; target: string };

type NodeLike = {
  id: string;
  baseRisk: number; // initial risk from database/flags
  risk: number;     // current risk (updated during propagation)
};

/**
 * Risk propagation using halving algorithm with mean averaging.
 * Uses average of neighbors' contributions instead of sum to prevent
 * artificially high risk when many neighbors exist.
 *
 * Algorithm per step:
 *   contrib(target) += risk(source) / 2
 *   risk_next(target) = baseRisk(target) + avg(contribs(target))
 */

export function propagateRiskByHalving(params: {
  nodes: NodeLike[];
  links: Link[];
  maxDepth: number;
}) {
  const { nodes, links } = params;
  const maxDepth = Math.max(1, Math.floor(params.maxDepth || 1));

  const nodeById = new Map<string, NodeLike>();
  for (const n of nodes) {
    // Normalize numbers to prevent NaN
    n.baseRisk = clamp100(n.baseRisk);
    n.risk = clamp100(n.risk);
    nodeById.set(n.id, n);
  }

  // Collect incoming edges for each target for fast contribution calculation
  const incoming = new Map<string, string[]>();
  for (const l of links) {
    const s = String(l.source);
    const t = String(l.target);
    if (!nodeById.has(s) || !nodeById.has(t)) continue;

    if (!incoming.has(t)) incoming.set(t, []);
    incoming.get(t)!.push(s);
  }

  // Iteratively propagate risk over depth hops
  for (let step = 0; step < maxDepth; step++) {
    // 1) Calculate contributions to each target
    const sumByTarget = new Map<string, number>();
    const cntByTarget = new Map<string, number>();

    for (const [targetId, sources] of incoming.entries()) {
      let sum = 0;
      let cnt = 0;

      for (const sourceId of sources) {
        const src = nodeById.get(sourceId);
        if (!src) continue;

        const contrib = clamp100(src.risk) * 0.7; // halving per hop
        if (!Number.isFinite(contrib) || contrib <= 0) continue;

        sum += contrib;
        cnt += 1;
      }

      if (cnt > 0) {
        sumByTarget.set(targetId, sum);
        cntByTarget.set(targetId, cnt);
      }
    }

    // 2) Update risk = baseRisk + AVG(contributions)
    const nextRisk = new Map<string, number>();

    for (const n of nodes) {
      const sum = sumByTarget.get(n.id);
      const cnt = cntByTarget.get(n.id);

      const avg = sum && cnt ? sum / cnt : 0;
      const updated = clamp100(n.baseRisk + avg);

      nextRisk.set(n.id, updated);
    }

    // 3) Apply updates for next iteration
    for (const n of nodes) {
      n.risk = clamp100(nextRisk.get(n.id) ?? n.baseRisk);
    }
  }
}

function clamp100(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}
