// lib/analysis.ts
import type {
  WalletAnalysisRequest,
  WalletAnalysisResult,
  GraphNode,
  GraphLink,
  ActivityStats,
} from './types';
import { fetchTransactionsMock } from './blockchainApi';
import { calculateRiskScore } from './riskScore';

export async function performFullAnalysis(
  req: WalletAnalysisRequest,
): Promise<WalletAnalysisResult> {
  // 1. Получаем транзакции с публичных API (пока заглушка)
  const transactions = await fetchTransactionsMock(req.address, req.blockchain, req.depth);

  // 2. Строим граф связей на основе транзакций
  const { nodes, links } = buildGraphFromTransactions(transactions, req.address);

  // 3. Анализируем транзакционную активность
  const stats = analyzeActivity(transactions);

  // 4. Считаем итоговый risk score
  const globalRiskScore = calculateRiskScore({ nodes, links, stats });

  return {
    rootAddress: req.address,
    blockchain: req.blockchain,
    depth: req.depth,
    globalRiskScore,
    graph: { nodes, links },
    stats,
    createdAt: new Date().toISOString(),
  };
}

// Тип для транзакции (упрощённо)
interface Tx {
  from: string;
  to: string;
  amount: number;
  timestamp: number; // unix time
}

// В реальности сюда должен попадать массив Tx из API
function buildGraphFromTransactions(txs: Tx[], rootAddress: string): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodeMap = new Map<string, GraphNode>();
  const linkKeyToCount = new Map<string, number>();

  // Добавляем корневой узел
  nodeMap.set(rootAddress, {
    id: rootAddress,
    label: shorten(rootAddress),
    riskScore: 0,
    isSuspicious: false,
  });

  for (const tx of txs) {
    // регистрируем узлы
    for (const addr of [tx.from, tx.to]) {
      if (!nodeMap.has(addr)) {
        nodeMap.set(addr, {
          id: addr,
          label: shorten(addr),
          riskScore: 0,
          isSuspicious: false,
        });
      }
    }

    // считаем количество транзакций между парами
    const key = `${tx.from}->${tx.to}`;
    linkKeyToCount.set(key, (linkKeyToCount.get(key) || 0) + 1);
  }

  const links: GraphLink[] = [];
  for (const [key, count] of linkKeyToCount.entries()) {
    const [from, to] = key.split('->');
    links.push({ source: from, target: to, txCount: count });
  }

  const nodes = Array.from(nodeMap.values());
  return { nodes, links };
}

function analyzeActivity(txs: Tx[]): ActivityStats {
  const totalTx = txs.length;
  if (totalTx === 0) {
    return { totalTx: 0, smallTxShare: 0, peakDayTx: 0 };
  }

  // Мелкие переводы < 0.01 монеты (условно)
  const smallTxCount = txs.filter((tx) => tx.amount < 0.01).length;
  const smallTxShare = smallTxCount / totalTx;

  // Пик транзакций в день
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
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}
