// lib/riskScore.ts
import type { GraphNode, GraphLink } from './types';

export interface RiskScoreInput {
  nodes: GraphNode[];
  links: GraphLink[];
  rootAddress: string; // главный адрес, для которого считаем итоговый риск
}

// ограничиваем риск 0–100
const clamp = (x: number) => Math.max(0, Math.min(100, x));

export function calculateRiskScore({
  nodes,
  links,
  rootAddress,
}: RiskScoreInput): number {
  // Быстрый доступ: id -> node
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
  }

  // Базовый риск корневого адреса (из БД, если он там есть)
  const root = byId.get(rootAddress);
  const baseRootRisk = clamp(root?.riskScore ?? 0);

  // Собираем соседей корневого адреса по рёбрам графа
  const neighbors = new Set<string>();
  for (const link of links) {
    const src =
      typeof link.source === 'object'
        ? (link.source as any).id
        : String(link.source);
    const dst =
      typeof link.target === 'object'
        ? (link.target as any).id
        : String(link.target);

    if (src === rootAddress && dst !== rootAddress) {
      neighbors.add(dst);
    } else if (dst === rootAddress && src !== rootAddress) {
      neighbors.add(src);
    }
  }

  // Средний риск соседей
  let neighborsSum = 0;
  for (const id of neighbors) {
    const n = byId.get(id);
    if (!n) continue;
    neighborsSum += clamp(n.riskScore ?? 0);
  }
  const neighborsAvg = neighbors.size ? neighborsSum / neighbors.size : 0;

  // Итог: базовый риск корневого + половина среднего риска соседей
  const finalRootRisk = clamp(baseRootRisk + neighborsAvg / 2);

  return Math.round(finalRootRisk);
}
