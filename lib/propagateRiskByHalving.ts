// lib/propagateRiskByHalving.ts
type Node = {
  id: string;
  risk?: number;        // сюда запишем итоговый propagated risk
  baseRisk?: number;    // исходный риск (bad db / isSuspicious / tag)
};

type Link = { source: string; target: string };

export function propagateRiskByHalving(params: {
  nodes: Node[];
  links: Link[];
  maxDepth?: number; // можно = depth анализа
}) {
  const { nodes, links, maxDepth = 3 } = params;

  const byId = new Map<string, Node>();
  for (const n of nodes) byId.set(n.id, n);

  // adjacency
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of links) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }

  // baseRisk: если не задан — считаем 0
  const base = new Map<string, number>();
  for (const n of nodes) {
    const br = Number.isFinite(n.baseRisk) ? (n.baseRisk as number) : 0;
    base.set(n.id, clamp100(br));
  }

  // propagated = base + сумма вкладов
  const propagated = new Map<string, number>();
  for (const n of nodes) propagated.set(n.id, base.get(n.id) ?? 0);

  // источники: все, у кого baseRisk > 0 (можно ограничить baseRisk>=50, если хочешь)
  const sources = nodes
    .map((n) => ({ id: n.id, score: base.get(n.id) ?? 0 }))
    .filter((x) => x.score > 0);

  // Для каждого источника делаем BFS до maxDepth и добавляем вклад score / 2^dist
  // Вклад на dist=0 НЕ добавляем (иначе удвоение), т.к. base уже учтён.
  for (const s of sources) {
    const visited = new Map<string, number>(); // nodeId -> minDist
    const q: Array<{ id: string; d: number }> = [{ id: s.id, d: 0 }];
    visited.set(s.id, 0);

    while (q.length) {
      const cur = q.shift()!;
      const { id, d } = cur;
      if (d >= maxDepth) continue;

      for (const nb of adj.get(id) ?? []) {
        const nd = d + 1;
        const prev = visited.get(nb);
        if (prev !== undefined && prev <= nd) continue; // уже был короче
        visited.set(nb, nd);
        q.push({ id: nb, d: nd });

        // добавляем вклад только если это не сам источник
        const add = s.score / Math.pow(2, nd);
        propagated.set(nb, clamp100((propagated.get(nb) ?? 0) + add));
      }
    }
  }

  // записываем обратно в nodes[].risk
  for (const n of nodes) {
    n.risk = clamp100(propagated.get(n.id) ?? 0);
  }

  return nodes;
}

function clamp100(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}
