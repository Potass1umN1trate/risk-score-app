// lib/types.ts

export type SupportedBlockchain = 'bitcoin' | 'ethereum';

export interface WalletAnalysisRequest {
  address: string;
  blockchain: SupportedBlockchain;
  depth: number; // чтобы не ломать старые места, но логически — больше не используется
}

export interface GraphNode {
  id: string;
  label: string;
  riskScore: number;
  isSuspicious: boolean;
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
  badAddressesCount?: number;
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
  meta?: {
    partial?: boolean;
    failedAddresses?: string[];
    badAddressesCount?: number;
  };
}

export type UserRole = 'user' | 'pusher' | 'admin';

export interface User {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthSession {
  userId: number;
  role: UserRole;
  email: string;
}