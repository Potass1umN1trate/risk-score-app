// lib/analysis.ts
import type {
  WalletAnalysisRequest,
  WalletAnalysisResult,
  GraphNode,
  GraphLink,
  ActivityStats,
} from './types';
import { fetchTransactions, type BlockchainTx } from './blockchainApi';
import {
  findBadAddressesForAddresses,
  type BadAddressRecord,
} from './badAddresses';
import { propagateRiskByHalving } from './propagateRiskByHalving';
import { upsertScannedAddressRisk } from './db';

/**
 * Tx-risk parts (твоя логика):
 * - small transfers: (share_<1usd * 100) * 0.7
 * - activity: (max_tx_per_day / 10) * 0.5
 */
function calcSmallTxRisk(stats: ActivityStats): number {
  return clamp100((stats.smallTxShare * 100) * 0.7);
}

function calcActivityRisk(stats: ActivityStats): number {
  return clamp100((stats.peakDayTx / 10) * 0.5);
}

/**
 * Итоговый риск теперь НЕ сумма, а максимум из 3 сигналов:
 * - graph/root risk (после propagation)
 * - smallTxRisk
 * - activityRisk
 */
function calcGlobalRisk(params: {
  graphRisk: number;
  smallTxRisk: number;
  activityRisk: number;
}): number {
  return clamp100(Math.max(params.graphRisk, params.smallTxRisk, params.activityRisk));
}

/**
 * Главная функция анализа:
 * - строим граф
 * - подтягиваем bad_addresses и выставляем baseRisk
 * - распространяем риск (halving, mean)
 * - stats считаем по root-транзакциям
 * - globalRiskScore = MAX(graphRisk, smallTxRisk, activityRisk)
 * - сохраняем globalRiskScore в БД (только root), но только если > 50
 */
export async function performFullAnalysis(
  req: WalletAnalysisRequest,
): Promise<WalletAnalysisResult> {
  const depth = Math.max(1, Math.min(req.depth ?? 1, 5));

  // нормализация адресов для сопоставления с БД (Ethereum)
  const normalize = (a: string) =>
    req.blockchain === 'ethereum' ? a.toLowerCase() : a;

  const rootAddress = normalize(String(req.address ?? '').trim());

  const { transactions, failedAddresses } = await fetchTransactions(
    rootAddress,
    req.blockchain,
    depth,
  );

  const { nodes, links } = buildGraphFromTransactions(
    transactions,
    rootAddress,
    normalize,
  );

  // 1) все адреса графа
  const allAddresses = nodes.map((n) => n.id);

  // 2) bad addresses из БД
  let badAddressMap: Map<string, BadAddressRecord>;
  try {
    badAddressMap = await findBadAddressesForAddresses(req.blockchain, allAddresses);
  } catch (err) {
    console.error('Error checking bad addresses', err);
    badAddressMap = new Map();
  }

  // 3) baseRisk: выставляем исходный риск узлам из БД
  for (const node of nodes) {
    const bad = badAddressMap.get(node.id);

    if (bad) {
      node.isSuspicious = true;
      node.riskScore = Math.max(node.riskScore ?? 0, Number(bad.riskLevel ?? 0));
    } else {
      node.isSuspicious = node.isSuspicious ?? false;
      node.riskScore = Number.isFinite(node.riskScore as any)
        ? (node.riskScore as number)
        : 0;
    }
    node.riskScore = clamp100(node.riskScore ?? 0);
  }

  /**
   * 4) Propagation:
   * делаем отдельные узлы с baseRisk/risk, не ломая GraphNode тип.
   */
  type PropNode = GraphNode & { baseRisk: number; risk: number };

  const propNodes: PropNode[] = nodes.map((n) => ({
    ...n,
    baseRisk: clamp100(n.riskScore ?? 0),
    risk: clamp100(n.riskScore ?? 0),
  }));

  propagateRiskByHalving({
    nodes: propNodes,
    links: links.map((l) => ({
      source: String(l.source),
      target: String(l.target),
    })),
    maxDepth: depth,
  });

  // копируем результат propagation обратно в nodes
  const riskById = new Map<string, number>();
  for (const n of propNodes) riskById.set(n.id, clamp100(n.risk));

  for (const node of nodes) {
    node.riskScore = clamp100(riskById.get(node.id) ?? 0);
  }

  // 5) stats для UI: считаем ТОЛЬКО root-транзакции
  const stats = analyzeActivityForRoot(transactions, rootAddress, req.blockchain);

  // 6) graphRisk = риск root после propagation
  const rootNode = nodes.find((n) => n.id === rootAddress);
  const graphRisk = clamp100(rootNode?.riskScore ?? 0);

  // 7) tx-risk parts и финальный риск = MAX(...)
  const smallTxRisk = calcSmallTxRisk(stats);
  const activityRisk = calcActivityRisk(stats);

  // IMPORTANT: округляем до int, потому что analysis_history.global_risk_score у тебя integer
  const globalRiskScore = Math.round(
    calcGlobalRisk({ graphRisk, smallTxRisk, activityRisk }),
  );

  // 8) динамика: пишем в БД только root и только если > 50
  try {
    if (globalRiskScore > 50) {
      await upsertScannedAddressRisk({
        blockchain: req.blockchain,
        address: rootAddress,
        riskLevel: globalRiskScore,
      });
    }
  } catch (e) {
    console.error('Failed to upsert scanned address risk', e);
  }

  return {
    rootAddress,
    blockchain: req.blockchain,
    depth,
    globalRiskScore,
    graph: { nodes, links },
    stats,
    createdAt: new Date().toISOString(),
    meta: {
      partial: failedAddresses.length > 0,
      failedAddresses,
      badAddressesCount: badAddressMap.size,
      // если захочешь дебажить формулу на фронте — добавь эти поля в тип meta и раскомментируй:
      // graphRisk,
      // smallTxRisk,
      // activityRisk,
    } as any,
  };
}

/**
 * Строим граф: из списка транзакций получаем узлы и связи.
 * normalize() обязателен, иначе Ethereum развалит lookup по БД.
 */
function buildGraphFromTransactions(
  txs: BlockchainTx[],
  rootAddress: string,
  normalize: (a: string) => string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const linkKeyToCount = new Map<string, number>();

  const root = normalize(rootAddress);

  nodeMap.set(root, {
    id: root,
    label: shorten(root),
    riskScore: 0,
    isSuspicious: false,
  });

  for (const rawTx of txs) {
    const from = rawTx.from ? normalize(rawTx.from) : null;
    const to = rawTx.to ? normalize(rawTx.to) : null;

    for (const addr of [from, to]) {
      if (!addr) continue;
      if (!nodeMap.has(addr)) {
        nodeMap.set(addr, {
          id: addr,
          label: shorten(addr),
          riskScore: 0,
          isSuspicious: false,
        });
      }
    }

    if (from && to) {
      const key = `${from}->${to}`;
      linkKeyToCount.set(key, (linkKeyToCount.get(key) || 0) + 1);
    }
  }

  const links: GraphLink[] = [];
  for (const [key, count] of linkKeyToCount.entries()) {
    const [from, to] = key.split('->');
    links.push({ source: from, target: to, txCount: count });
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

/**
 * ActivityStats ТОЛЬКО для root:
 * - totalTx: сколько транзакций, где root участвовал (from/to)
 * - smallTxShare: доля транзакций < $1 (если есть курс в env)
 * - peakDayTx: максимум root-транзакций за один день (UTC)
 *
 * ВАЖНО: tx.amount у тебя в нативных единицах (BTC/ETH).
 * Для $1 нужен курс:
 *   PRICE_USD_BTC, PRICE_USD_ETH
 * Если курса нет => smallTxShare = 0 (честно).
 */
function analyzeActivityForRoot(
  txs: BlockchainTx[],
  rootAddress: string,
  blockchain: string,
): ActivityStats {
  const rootLower = rootAddress.toLowerCase();

  const rootTxs = txs.filter((tx) => {
    const f = (tx.from ?? '').toLowerCase();
    const t = (tx.to ?? '').toLowerCase();
    return f === rootLower || t === rootLower;
  });

  const totalTx = rootTxs.length;
  if (totalTx === 0) return { totalTx: 0, smallTxShare: 0, peakDayTx: 0 };

  const priceUsd = getPriceUsd(blockchain);

  let smallTxCount = 0;
  if (priceUsd > 0) {
    for (const tx of rootTxs) {
      const usd = Math.abs(tx.amount) * priceUsd;
      if (usd < 1) smallTxCount += 1;
    }
  } else {
    smallTxCount = 0;
  }

  const smallTxShare = smallTxCount / totalTx;

  const perDay = new Map<string, number>();
  for (const tx of rootTxs) {
    const day = new Date(tx.timestamp * 1000).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  const peakDayTx = Math.max(...perDay.values());

  return { totalTx, smallTxShare, peakDayTx };
}

function getPriceUsd(blockchain: string): number {
  const b = (blockchain || '').toLowerCase();
  if (b === 'bitcoin' || b === 'btc') return Number(process.env.PRICE_USD_BTC ?? 0) || 0;
  if (b === 'ethereum' || b === 'eth') return Number(process.env.PRICE_USD_ETH ?? 0) || 0;
  return 0;
}

function shorten(addr: string) {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function clamp100(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}
