// lib/blockchainApi.ts
import type { SupportedBlockchain } from './types';

/**
 * Унифицированная транзакция для анализа и графа.
 * amount — в "человеческих" единицах (BTC / ETH / токенах).
 */
export interface BlockchainTx {
  from: string;
  to: string;
  amount: number;
  timestamp: number; // unix time (сек)
}

/**
 * Главная функция: получить транзакции по адресу.
 * depth сейчас не используется (берём транзакции только самого адреса),
 * но оставляем параметр "на вырост", чтобы не ломать сигнатуру.
 */
export async function fetchTransactions(
  address: string,
  blockchain: SupportedBlockchain,
  depth: number,
): Promise<BlockchainTx[]> {
  void depth; // чтобы линтер не ругался

  if (blockchain === 'bitcoin') {
    return fetchBitcoinTransactions(address);
  }

  if (blockchain === 'ethereum') {
    return fetchEthereumTransactions(address);
  }

  throw new Error(`Unsupported blockchain: ${blockchain}`);
}

/* ========================= BITCOIN ========================= */

type BitcoinRawAddr = {
  txs: {
    time: number;
    inputs: { prev_out?: { addr?: string; value?: number } }[];
    out: { addr?: string; value?: number }[];
  }[];
};

/**
 * Забираем историю адреса через blockchain.info/rawaddr
 */
async function fetchBitcoinTransactions(
  address: string,
): Promise<BlockchainTx[]> {
  const url = `https://blockchain.info/rawaddr/${encodeURIComponent(
    address,
  )}?limit=50`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Bitcoin API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as BitcoinRawAddr;

  const txs: BlockchainTx[] = [];

  for (const tx of data.txs || []) {
    const time = tx.time;

    const inputs = tx.inputs ?? [];
    const outputs = tx.out ?? [];

    const inputAddrs = inputs
      .map((i) => i.prev_out?.addr)
      .filter((a): a is string => Boolean(a));
    const outputAddrs = outputs
      .map((o) => o.addr)
      .filter((a): a is string => Boolean(a));

    const fromHasRoot = inputAddrs.includes(address);
    const toHasRoot = outputAddrs.includes(address);

    // Исходящие: root -> каждый другой получатель
    if (fromHasRoot) {
      for (const out of outputs) {
        if (!out.addr || out.addr === address) continue;
        const btc = (out.value ?? 0) / 1e8; // sat → BTC
        txs.push({
          from: address,
          to: out.addr,
          amount: btc,
          timestamp: time,
        });
      }
    }

    // Входящие: каждый отправитель -> root
    if (toHasRoot) {
      for (const input of inputs) {
        const addr = input.prev_out?.addr;
        if (!addr || addr === address) continue;
        const btc = (input.prev_out?.value ?? 0) / 1e8;
        txs.push({
          from: addr,
          to: address,
          amount: btc,
          timestamp: time,
        });
      }
    }
  }

  return txs;
}

/* ========================= ETHEREUM ========================= */

type EthplorerHistory = {
  operations?: {
    timestamp: number;
    from?: string;
    to?: string;
    value?: number;
    tokenInfo?: {
      decimals?: string | number;
      symbol?: string;
    };
  }[];
};

/**
 * Забираем историю операций через Ethplorer.
 * Для dev можно оставить apiKey=freekey, потом заменить на свой.
 */
async function fetchEthereumTransactions(
  address: string,
): Promise<BlockchainTx[]> {
  const apiKey = process.env.ETHPLORER_API_KEY || 'freekey';

  const url = `https://api.ethplorer.io/getAddressHistory/${encodeURIComponent(
    address,
  )}?apiKey=${encodeURIComponent(apiKey)}&limit=50`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ethplorer API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as EthplorerHistory;

  const txs: BlockchainTx[] = [];

  for (const op of data.operations || []) {
    const from = op.from || address;
    const to = op.to || address;

    const decimalsRaw = op.tokenInfo?.decimals ?? 18;
    const decimals =
      typeof decimalsRaw === 'string'
        ? parseInt(decimalsRaw, 10)
        : decimalsRaw;
    const divisor = Math.pow(10, isFinite(decimals) ? decimals : 18);

    const amount = (op.value ?? 0) / divisor;

    txs.push({
      from,
      to,
      amount,
      timestamp: op.timestamp,
    });
  }

  return txs;
}
