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
  type FetchTransactionsResult,
} from './blockchainApi';
import {
  findBadAddressesForAddresses,
  type BadAddressRecord,
} from './badAddresses';
import { calculateRiskScore } from './riskScore';

export async function performFullAnalysis(
  req: WalletAnalysisRequest,
): Promise<WalletAnalysisResult> {
  const { transactions, failedAddresses } = await fetchTransactions(
    req.address,
    req.blockchain,
    req.depth,
  );

  const { nodes, links } = buildGraphFromTransactions(
    transactions,
    req.address,
  );

  // =========================
  // 1. Тянем "плохие" адреса из базы
  // =========================
  const allAddresses = Array.from(new Set(nodes.map((n) => n.id)));

  let badAddressMap: Map<string, BadAddressRecord> = new Map();
  try {
    badAddressMap = await findBadAddressesForAddresses(
      req.blockchain,
      allAddresses,
    );
  } catch (err) {
    console.error('Error checking bad addresses', err);
  }

  // =========================
  // 2. Помечаем ноды как подозрительные
  // =========================
  if (badAddressMap.size > 0) {
    applyBadFlagsToNodes(nodes, badAddressMap);
  }

  // =========================
  // 3. Остальной анализ как был
  // =========================
  const stats = analyzeActivity(transactions);

  // Базовый скор по твоей старой формуле
  let globalRiskScore = calculateRiskScore({ nodes, links, stats });

  // --- OVERRIDE: блоклист сильнее эвристик ---
  // Берём максимальный riskScore по узлам (куда мы уже залили risk_level из БД)
  const maxNodeRisk = nodes.reduce(
    (max, n) => Math.max(max, n.riskScore ?? 0),
    0,
  );

  if (maxNodeRisk > globalRiskScore) {
    globalRiskScore = maxNodeRisk;
  }

  return {
    rootAddress: req.address,
    blockchain: req.blockchain,
    depth: req.depth,
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

function applyBadFlagsToNodes(
  nodes: GraphNode[],
  badMap: Map<string, BadAddressRecord>,
) {
  for (const node of nodes) {
    const bad = badMap.get(node.id);
    if (!bad) continue;

    node.isSuspicious = true;

    // Минимальный вариант: риск узла не меньше risk_level из БД
    node.riskScore = Math.max(node.riskScore ?? 0, bad.riskLevel);

    // Доп. инфа (если захочешь подсвечивать её во фронте)
    node.badTag = bad.tag ?? null;
    node.badSource = bad.source ?? null;
  }
}


/**
 * Строим граф: из списка транзакций получаем узлы и связи.
 * Поправлено: корневой адрес приводим к одному варианту строки,
 * чтобы он не дублировался (особенно в Ethereum, где разные кейсы).
 */
function buildGraphFromTransactions(
  txs: BlockchainTx[],
  rootAddress: string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const linkKeyToCount = new Map<string, number>();

  // нормализованный вариант корневого адреса (для сравнения)
  const rootLower = rootAddress.toLowerCase();

  // корневой узел
  nodeMap.set(rootAddress, {
    id: rootAddress,
    label: shorten(rootAddress),
    riskScore: 0,
    isSuspicious: false,
  });

  for (const tx of txs) {
    let { from, to } = tx;

    // Если адрес из транзакции совпадает с корневым по регистронезависимому сравнению —
    // принудительно используем строку rootAddress, чтобы был один узел.
    if (from && from.toLowerCase() === rootLower) {
      from = rootAddress;
    }
    if (to && to.toLowerCase() === rootLower) {
      to = rootAddress;
    }

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
 * Анализ транзакционной активности (как раньше, только тип другой).
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
