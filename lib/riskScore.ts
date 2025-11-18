// lib/riskScore.ts
import type { GraphNode, GraphLink, ActivityStats } from './types';

interface RiskInput {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: ActivityStats;
}

export function calculateRiskScore(input: RiskInput): number {
  const { stats } = input;

  let score = 0;

  // Пример факторов:
  // 1) чем больше транзакций — тем потенциально выше риск
  if (stats.totalTx > 100) score += 30;
  else if (stats.totalTx > 20) score += 15;
  else if (stats.totalTx > 0) score += 5;

  // 2) большое количество мелких транзакций — признак «обналички»
  if (stats.smallTxShare > 0.7) score += 40;
  else if (stats.smallTxShare > 0.4) score += 20;

  // 3) всплески активности
  if (stats.peakDayTx > 50) score += 30;
  else if (stats.peakDayTx > 10) score += 15;

  // ограничиваем 0..100
  return Math.min(100, Math.max(0, score));
}
