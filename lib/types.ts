// lib/types.ts

export type SupportedBlockchain = 'bitcoin' | 'ethereum';

export interface WalletAnalysisRequest {
  address: string;
  blockchain: SupportedBlockchain;
  depth: number;
}

export interface GraphNode {
  id: string;               // адрес кошелька
  label: string;            // короткий текст (например, сокращённый адрес)
  riskScore: number;        // локальный risk score для узла
  isSuspicious: boolean;    // флаг "подозрительный"
}

export interface GraphLink {
  source: string;           // id узла-отправителя
  target: string;           // id узла-получателя
  txCount: number;          // количество транзакций по этой связи
}

export interface ActivityStats {
  totalTx: number;          // всего транзакций
  smallTxShare: number;     // доля мелких транзакций (0..1)
  peakDayTx: number;        // максимум транзакций в день
}

export interface WalletAnalysisResult {
  rootAddress: string;
  blockchain: SupportedBlockchain;
  depth: number;
  globalRiskScore: number;  // итоговый risk score кошелька
  graph: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  stats: ActivityStats;
  createdAt: string;        // ISO дата
}
