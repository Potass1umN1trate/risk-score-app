// lib/blockchainApi.ts
import type { SupportedBlockchain } from './types';

/**
 * Unified transaction format for analysis and graph building.
 * txid is optional and used for deduplication.
 */
export interface BlockchainTx {
  txid?: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number; // unix time (seconds)
}

/**
 * Prevent hitting external API rate limits by restricting total addresses analyzed.
 */
const MAX_ADDRESSES_PER_ANALYSIS = 15;
const MAX_DEPTH = 5;

/**
 * Result of transaction analysis for an address.
 */
export interface FetchTransactionsResult {
  transactions: BlockchainTx[];
  failedAddresses: string[]; // addresses where data fetch failed
}

/**
 * Queue node for breadth-first traversal by depth level.
 */
interface AddressNode {
  addr: string;
  level: number;
}

/**
 * Generic type for blockchain-specific transaction fetcher functions.
 */
type AddressTxFetcher = (address: string) => Promise<BlockchainTx[]>;

/**
 * Map blockchain names to their transaction fetcher functions.
 * Enables easy addition of new blockchain support.
 */
const addressTxFetchers: Record<SupportedBlockchain, AddressTxFetcher> = {
  bitcoin: fetchBitcoinAddressTransactions,
  ethereum: fetchEthereumAddressTransactions,
};

/**
 * Main entry point: collect transactions considering depth parameter.
 *
 * depth levels:
 *  1 - root address only
 *  2 - root address + direct counterparties (1 hop)
 *  3 - + counterparties of counterparties (2 hops), etc.
 */
export async function fetchTransactions(
  rootAddress: string,
  blockchain: SupportedBlockchain,
  depth: number,
): Promise<FetchTransactionsResult> {
  const maxDepth = Math.max(1, Math.min(depth, MAX_DEPTH));

  const failedAddresses: string[] = [];
  const collected: BlockchainTx[] = [];

  const visited = new Set<string>();
  const queue: AddressNode[] = [{ addr: rootAddress, level: 0 }];

  const fetcher = addressTxFetchers[blockchain];
  if (!fetcher) {
    throw new Error(`Unsupported blockchain: ${blockchain}`);
  }

  while (queue.length > 0 && visited.size < MAX_ADDRESSES_PER_ANALYSIS) {
    const { addr, level } = queue.shift()!;
    if (visited.has(addr)) continue;
    visited.add(addr);

    let addrTxs: BlockchainTx[] = [];
    try {
      addrTxs = await fetcher(addr);
    } catch (e) {
      console.error('Error fetching txs for', addr, e);
      failedAddresses.push(addr);
      continue;
    }

    collected.push(...addrTxs);

    // Stop traversing deeper at max depth
    if (level >= maxDepth - 1) continue;

    const neighbors = collectNeighbors(addr, addrTxs);
    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      if (visited.has(neighbor)) continue;
      if (queue.some((q) => q.addr === neighbor)) continue;
      if (visited.size + queue.length >= MAX_ADDRESSES_PER_ANALYSIS) break;

      queue.push({ addr: neighbor, level: level + 1 });
    }
  }

  return {
    transactions: deduplicateTransactions(collected),
    failedAddresses,
  };
}

/**
 * Collect unique neighbors: all unique from/to addresses except the current one.
 */
function collectNeighbors(
  currentAddr: string,
  txs: BlockchainTx[],
): Set<string> {
  const neighbors = new Set<string>();

  for (const tx of txs) {
    if (tx.from && tx.from !== currentAddr) {
      neighbors.add(tx.from);
    }
    if (tx.to && tx.to !== currentAddr) {
      neighbors.add(tx.to);
    }
  }

  return neighbors;
}

/**
 * Deduplicate transactions:
 * - if txid exists, use it as the key
 * - otherwise compose key from from/to/timestamp/amount
 */
function deduplicateTransactions(txs: BlockchainTx[]): BlockchainTx[] {
  const unique = new Map<string, BlockchainTx>();

  for (const tx of txs) {
    const key = tx.txid
      ? tx.txid
      : `${tx.from}->${tx.to}@${tx.timestamp}@${tx.amount.toFixed(8)}`;

    if (!unique.has(key)) {
      unique.set(key, tx);
    }
  }

  return Array.from(unique.values());
}

/* ========================= BITCOIN ========================= */

const BTC_CACHE_TTL_MS = 60_000; // 60 seconds

// In-memory cache (persists for process lifetime)
type BtcCacheEntry = { ts: number; txs: BlockchainTx[] };

const globalAny = globalThis as { __btcCache?: Map<string, BtcCacheEntry> };

if (!globalAny.__btcCache) {
  globalAny.__btcCache = new Map<string, BtcCacheEntry>();
}

const btcCache = globalAny.__btcCache!;

type EsploraTx = {
  txid: string;
  vin: {
    prevout?: {
      scriptpubkey_address?: string;
      value?: number;
    };
  }[];
  vout: {
    scriptpubkey_address?: string;
    value?: number;
  }[];
  status?: {
    block_time?: number;
  };
};

async function fetchBitcoinAddressTransactions(
  address: string,
): Promise<BlockchainTx[]> {
  const now = Date.now();
  const cached = btcCache.get(address);

  if (cached && now - cached.ts < BTC_CACHE_TTL_MS) {
    return cached.txs;
  }

  const url = `https://mempool.space/api/address/${encodeURIComponent(
    address,
  )}/txs`;

  const res = await fetch(url);
  if (!res.ok) {
    // Treat HTTP errors as failure (400, 429, 500, etc.)
    throw new Error(
      `Bitcoin API (mempool.space) error for ${address}: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as EsploraTx[];
  const txs = parseEsploraTransactions(address, data);

  btcCache.set(address, { ts: now, txs });

  return txs;
}

/**
 * Convert Esplora API format to unified BlockchainTx format.
 */
function parseEsploraTransactions(
  address: string,
  data: EsploraTx[] = [],
): BlockchainTx[] {
  const txs: BlockchainTx[] = [];

  for (const tx of data) {
    const time = tx.status?.block_time ?? Math.floor(Date.now() / 1000);

    const inputs = tx.vin || [];
    const outputs = tx.vout || [];

    const inputAddrs = inputs
      .map((i) => i.prevout?.scriptpubkey_address)
      .filter((a): a is string => Boolean(a));

    const outputAddrs = outputs
      .map((o) => o.scriptpubkey_address)
      .filter((a): a is string => Boolean(a));

    const fromHasAddr = inputAddrs.includes(address);
    const toHasAddr = outputAddrs.includes(address);

    // Outgoing transactions: our address in inputs, others are recipients
    if (fromHasAddr) {
      for (const out of outputs) {
        const to = out.scriptpubkey_address;
        if (!to || to === address) continue;

        const btc = (out.value ?? 0) / 1e8;
        txs.push({
          txid: tx.txid,
          from: address,
          to,
          amount: btc,
          timestamp: time,
        });
      }
    }

    // Incoming transactions: our address in outputs, others are senders
    if (toHasAddr) {
      for (const input of inputs) {
        const from = input.prevout?.scriptpubkey_address;
        if (!from || from === address) continue;

        const btc = (input.prevout?.value ?? 0) / 1e8;
        txs.push({
          txid: tx.txid,
          from,
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

type EthplorerTx = {
  timestamp: number;
  hash?: string;
  from?: string;
  to?: string;
  value?: number; // value already in ETH
};

async function fetchEthereumAddressTransactions(
  address: string,
): Promise<BlockchainTx[]> {
  const apiKey = process.env.ETHPLORER_API_KEY || 'freekey';

  // Use getAddressTransactions - returns regular ETH transactions only
  const url = `https://api.ethplorer.io/getAddressTransactions/${encodeURIComponent(
    address,
  )}?apiKey=${encodeURIComponent(apiKey)}&limit=50&showZeroValues=false`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Ethplorer API error for ${address}: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as EthplorerTx[];
  const txs: BlockchainTx[] = [];

  for (const tx of data || []) {
    const from = tx.from || address;
    const to = tx.to || address;
    const amount = tx.value ?? 0;

    // Skip zero or invalid transactions
    if (!from || !to) continue;
    if (!Number.isFinite(amount) || amount === 0) continue;

    txs.push({
      txid: tx.hash,
      from,
      to,
      amount, // already in ETH
      timestamp: tx.timestamp,
    });
  }

  return txs;
}
