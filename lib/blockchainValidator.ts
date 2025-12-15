// lib/blockchainValidators.ts
import type { SupportedBlockchain } from './types';

// Простейшие, но уже нормальные проверки формата

// Legacy / P2SH: 1..., 3..., base58, 26–35 символов
const BTC_BASE58_REGEX = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
// Bech32: bc1...
const BTC_BECH32_REGEX = /^(bc1|BC1)[0-9a-zA-Z]{11,71}$/;

// ETH: 0x + 40 hex
const ETH_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddressFormat(
  blockchain: SupportedBlockchain,
  address: string,
): boolean {
  if (!address) return false;
  const value = address.trim();

  switch (blockchain) {
    case 'bitcoin':
      return BTC_BASE58_REGEX.test(value) || BTC_BECH32_REGEX.test(value);

    case 'ethereum':
      return ETH_REGEX.test(value);

    default:
      return false;
  }
}
