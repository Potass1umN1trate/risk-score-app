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
  const stats = analyzeActivity(transactions);
  const globalRiskScore = calculateRiskScore({ nodes, links, stats });

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
    },
  };
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
