// lib/types.ts

export type SupportedBlockchain = 'bitcoin' | 'ethereum';

export interface WalletAnalysisRequest {
  address: string;
  blockchain: SupportedBlockchain;
  depth: number;
}

export interface GraphNode {
  id: string;
  label: string;
  riskScore: number;
  isSuspicious: boolean;

  // Новые, опциональные поля — UI сможет их показывать, если захочешь
  badTag?: string | null;
  badSource?: string | null;
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

export interface WalletAnalysisMeta {
  partial: boolean;
  failedAddresses: string[];
}

export interface WalletAnalysisResult {
  rootAddress: string;
  blockchain: SupportedBlockchain;
  depth: number;
  globalRiskScore: number;
  graph: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  stats: ActivityStats;
  createdAt: string;
  meta: {
    partial: boolean;
    failedAddresses: string[];

    // Новое поле: что именно совпало с локальным blacklist
    badAddressesCount?: number; 
    badAddresses?: {
      address: string;
      tag: string | null;
      riskLevel: number;
      source: string | null;
      evidenceUrl: string | null;
    }[];
  };
}