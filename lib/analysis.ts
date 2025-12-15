// lib/analysis.ts
import type {
  WalletAnalysisRequest,
  WalletAnalysisResult,
  GraphNode,
  GraphLink,
  ActivityStats,
} from './types';
import {
  fetchTransactions,
  type BlockchainTx,
} from './blockchainApi';
import {
  findBadAddressesForAddresses,
  type BadAddressRecord,
} from './badAddresses';
import { calculateRiskScore } from './riskScore';

/**
 * Главная функция анализа:
 * - тянем транзакции с учётом глубины (depth)
 * - строим граф
 * - подтягиваем "плохие" адреса из БД и помечаем ноды
 * - считаем итоговый risk score только по графу
 */
export async function performFullAnalysis(
  req: WalletAnalysisRequest,
): Promise<WalletAnalysisResult> {
  // нормализуем глубину
  const depth = Math.max(1, Math.min(req.depth ?? 1, 5));

  const { transactions, failedAddresses } = await fetchTransactions(
    req.address,
    req.blockchain,
    depth,
  );

  const { nodes, links } = buildGraphFromTransactions(
    transactions,
    req.address,
  );

  // 1) собираем все адреса из графа
  const allAddresses = nodes.map((n) => n.id);

  // 2) тянем по ним "плохие" записи из базы
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

  // 3) помечаем ноды как подозрительные и выравниваем riskScore
  for (const node of nodes) {
    const bad = badAddressMap.get(node.id);

    if (bad) {
      node.isSuspicious = true;
      // риск узла не ниже, чем из базы
      node.riskScore = Math.max(node.riskScore ?? 0, bad.riskLevel ?? 0);
    } else {
      // чтобы на фронте всегда были численные значения
      node.isSuspicious = node.isSuspicious ?? false;
      node.riskScore = node.riskScore ?? 0;
    }
  }

  // 4) считаем статистику (для UI) и общий риск только по графу
  const stats = analyzeActivity(transactions);
  const globalRiskScore = calculateRiskScore({ nodes, links, rootAddress: req.address });

  return {
    rootAddress: req.address,
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
 * Корневой адрес приводим к одному варианту строки (по регистру),
 * чтобы он не дублировался (особенно для Ethereum).
 */
function buildGraphFromTransactions(
  txs: BlockchainTx[],
  rootAddress: string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const linkKeyToCount = new Map<string, number>();

  const rootLower = rootAddress.toLowerCase();

  // корневой узел
  nodeMap.set(rootAddress, {
    id: rootAddress,
    label: shorten(rootAddress),
    riskScore: 0,
    isSuspicious: false,
  });

  for (const rawTx of txs) {
    let { from, to } = rawTx;

    if (from && from.toLowerCase() === rootLower) from = rootAddress;
    if (to && to.toLowerCase() === rootLower) to = rootAddress;

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

  const nodes = Array.from(nodeMap.values());
  return { nodes, links };
}

/**
 * Анализ транзакционной активности.
 * Сейчас используется только для отображения на фронте,
 * на risk score не влияет.
 */
function analyzeActivity(txs: BlockchainTx[]): ActivityStats {
  const totalTx = txs.length;
  if (totalTx === 0) {
    return { totalTx: 0, smallTxShare: 0, peakDayTx: 0 };
  }

  const amounts = txs.map((tx) => Math.abs(tx.amount));
  const sorted = [...amounts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = median || 0.0001;

  const smallTxCount = txs.filter(
    (tx) => Math.abs(tx.amount) <= threshold,
  ).length;
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
