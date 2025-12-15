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
 * Главная функция анализа:
 * - тянем транзакции с учётом глубины (depth)
 * - строим граф
 * - подтягиваем "плохие" адреса из БД и помечаем ноды (baseRisk)
 * - распространяем риск по графу (halving per hop)
 * - итоговый риск = риск корневого узла после propagation
 * - сохраняем root risk в БД (только root)
 */
export async function performFullAnalysis(
  req: WalletAnalysisRequest,
): Promise<WalletAnalysisResult> {
  const depth = Math.max(1, Math.min(req.depth ?? 1, 5));

  // ВАЖНО: для Ethereum нормализуем адреса в lower-case, чтобы совпадали с БД
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
    badAddressMap = await findBadAddressesForAddresses(
      req.blockchain,
      allAddresses,
    );
  } catch (err) {
    console.error('Error checking bad addresses', err);
    badAddressMap = new Map();
  }

  // 3) baseRisk: выставляем исходный риск узлам
  for (const node of nodes) {
    const bad = badAddressMap.get(node.id);

    if (bad) {
      node.isSuspicious = true;
      node.riskScore = Math.max(node.riskScore ?? 0, Number(bad.riskLevel ?? 0));
      // Если твой GraphNode/WalletAnalysisResult поддерживает эти поля — можно включить:
      // (node as any).badTag = bad.tag ?? null;
      // (node as any).badSource = bad.source ?? null;
    } else {
      node.isSuspicious = node.isSuspicious ?? false;
      node.riskScore = Number.isFinite(node.riskScore as any) ? (node.riskScore as number) : 0;
    }
  }

  /**
   * 4) Propagation:
   * ВНИМАНИЕ: чтобы не ломать типы, делаем отдельное “представление” узлов:
   *  - baseRisk = node.riskScore до propagation
   *  - risk = baseRisk + вклад соседей
   */
  type PropNode = GraphNode & { baseRisk: number; risk: number };

  const propNodes: PropNode[] = nodes.map((n) => ({
    ...n,
    baseRisk: clamp100(n.riskScore ?? 0),
    risk: clamp100(n.riskScore ?? 0),
  }));

  // propagateRiskByHalving должен работать по id/source/target
  propagateRiskByHalving({
    nodes: propNodes,
    links: links.map((l) => ({
      source: String(l.source),
      target: String(l.target),
    })),
    maxDepth: depth,
  });

  // копируем результат обратно в nodes (чтобы UI видел)
  const riskById = new Map<string, number>();
  for (const n of propNodes) riskById.set(n.id, clamp100(n.risk));

  for (const node of nodes) {
    const r = riskById.get(node.id);
    node.riskScore = clamp100(r ?? 0);
  }

  // 5) stats для UI
  const stats = analyzeActivity(transactions);

  // 6) Итоговый риск = риск root после propagation
  const rootNode = nodes.find((n) => n.id === rootAddress);
  const globalRiskScore = clamp100(rootNode?.riskScore ?? 0);

  // 7) "Динамика": обновляем/пишем в БД ТОЛЬКО root адрес (не всех соседей)
  //    Чтобы не превращать bad_addresses в помойку, пишем только если риск > 0
  //    (если хочешь всегда — убери условие)
  try {
    if (globalRiskScore > 0) {
      await upsertScannedAddressRisk({
        blockchain: req.blockchain,
        address: rootAddress,
        riskLevel: globalRiskScore,
      });
    }
  } catch (e) {
    // не роняем анализ из-за записи в БД
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
    },
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

function analyzeActivity(txs: BlockchainTx[]): ActivityStats {
  const totalTx = txs.length;
  if (totalTx === 0) return { totalTx: 0, smallTxShare: 0, peakDayTx: 0 };

  const amounts = txs.map((tx) => Math.abs(tx.amount));
  const sorted = [...amounts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = median || 0.0001;

  const smallTxCount = txs.filter((tx) => Math.abs(tx.amount) <= threshold).length;
  const smallTxShare = smallTxCount / totalTx;

  const perDay = new Map<string, number>();
  for (const tx of txs) {
    const day = new Date(tx.timestamp * 1000).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  const peakDayTx = Math.max(...perDay.values());

  return { totalTx, smallTxShare, peakDayTx };
}

function shorten(addr: string) {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function clamp100(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}
