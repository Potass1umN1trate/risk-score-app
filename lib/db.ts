// lib/db.ts
import type { WalletAnalysisResult } from './types';

// В реальном приложении это будет таблица в PostgreSQL
const storage = new Map<string, WalletAnalysisResult[]>();

export async function saveAnalysis(userId: string, result: WalletAnalysisResult) {
  const list = storage.get(userId) ?? [];
  list.push(result);
  storage.set(userId, list);
}

export async function getUserHistory(userId: string): Promise<WalletAnalysisResult[]> {
  return storage.get(userId) ?? [];
}
