// lib/blockchainApi.ts
import type { SupportedBlockchain } from './types';

interface Tx {
  from: string;
  to: string;
  amount: number;
  timestamp: number;
}

// Пока это заглушка. Для реальной работы сюда подключается реальное API.
export async function fetchTransactionsMock(
  address: string,
  blockchain: SupportedBlockchain,
  depth: number,
): Promise<Tx[]> {
  // Тут мог бы быть запрос к реальному API:
  // if (blockchain === 'bitcoin') { ... }
  // if (blockchain === 'ethereum') { ... }

  // Сейчас просто генерируем фиктивные данные для демонстрации
  const now = Math.floor(Date.now() / 1000);

  return [
    {
      from: address,
      to: 'addr_1',
      amount: 0.005,
      timestamp: now - 3600 * 24,
    },
    {
      from: 'addr_1',
      to: 'addr_2',
      amount: 0.1,
      timestamp: now - 3600 * 12,
    },
    {
      from: 'addr_3',
      to: address,
      amount: 1.2,
      timestamp: now - 3600 * 6,
    },
  ];
}
