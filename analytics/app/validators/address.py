"""
Network-specific wallet address format validation.

Performs lightweight regex/prefix/length checks suitable for MVP validation.
Does NOT perform full on-chain validation (e.g., checksum verification via RPC).

Spec requirement: basic validation of selected network and wallet address format
before analysis begins (contradiction C fix).
"""

import hashlib
import re
from typing import NamedTuple


class ValidationResult(NamedTuple):
    valid: bool
    reason: str  # human-readable rejection reason; empty string when valid


# ─── Per-network patterns ─────────────────────────────────────────────────────

# BTC: P2PKH (1…), P2SH (3…), bech32 mainnet (bc1…)
_BTC = re.compile(r"^(1[1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{6,87})$")

# ETH / BNB: 0x + 40 hex chars
_EVM = re.compile(r"^0x[0-9a-fA-F]{40}$")

# TRX: starts with T, base58, 34 chars total
_TRX = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")

# TRX provider/internal hex form: 21 bytes, represented as 41 + 20-byte address.
_TRX_HEX = re.compile(r"^41[0-9a-fA-F]{40}$")

# SOL: base58, 32–44 chars
_SOL = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")

# XRP: starts with r, base58, 25–34 chars
_XRP = re.compile(r"^r[1-9A-HJ-NP-Za-km-z]{24,33}$")

# LTC: P2PKH (L/M), P2SH (3), bech32 (ltc1)
_LTC = re.compile(r"^([LM][1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|ltc1[ac-hj-np-z02-9]{6,87})$")

# DOGE: starts with D, base58, 26–34 chars
_DOGE = re.compile(r"^D[1-9A-HJ-NP-Za-km-z]{25,33}$")

# ADA: Shelley bech32 (addr1…) or Byron base58 (Ae2…/DdzFF…)
_ADA = re.compile(r"^(addr1[a-z0-9]{50,110}|Ae2[1-9A-HJ-NP-Za-km-z]{50,}|DdzFF[1-9A-HJ-NP-Za-km-z]{80,})$")

# TON: base64url or bounceable, 48 chars
_TON = re.compile(r"^[0-9A-Za-z_\-+/]{48}$")

# EVM networks whose addresses are case-insensitive hex (EIP-55 checksum variants
# must be treated as identical to their lowercase equivalents).
_EVM_NETWORKS: frozenset[str] = frozenset({"ETH", "BNB"})

_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _base58check_encode(payload: bytes) -> str:
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    raw = payload + checksum
    value = int.from_bytes(raw, byteorder="big")

    encoded = ""
    while value:
        value, remainder = divmod(value, 58)
        encoded = _BASE58_ALPHABET[remainder] + encoded

    leading_zeroes = len(raw) - len(raw.lstrip(b"\0"))
    return ("1" * leading_zeroes) + (encoded or "1")


def _normalize_trx_address(address: str) -> str:
    """
    Return canonical user-facing TRX address form when conversion is safe.

    TRON providers may return address bytes as hex with the 0x41 network prefix.
    Analytics uses base58check T... addresses as the canonical TRX form.
    Unknown or malformed strings are left unchanged so normalization remains
    defensive and does not turn provider quirks into unexpected exceptions.
    """
    if _TRX.match(address):
        return address
    if not _TRX_HEX.match(address):
        return address

    try:
        return _base58check_encode(bytes.fromhex(address))
    except ValueError:
        return address


def normalize_address_for_network(network: str, address: str) -> str:
    """
    Return the canonical form of an address for the given network.

    ETH/BNB: strip whitespace and lowercase (EVM addresses are case-insensitive).
    TRX: strip whitespace and convert provider hex 41... addresses to base58 T....
    All other networks: strip whitespace only — casing is meaningful.
    """
    stripped = address.strip()
    network_code = network.upper()
    if network_code in _EVM_NETWORKS:
        return stripped.lower()
    if network_code == "TRX":
        return _normalize_trx_address(stripped)
    return stripped


_VALIDATORS: dict[str, re.Pattern] = {
    "BTC":  _BTC,
    "ETH":  _EVM,
    "BNB":  _EVM,
    "TRX":  _TRX,
    "SOL":  _SOL,
    "XRP":  _XRP,
    "LTC":  _LTC,
    "DOGE": _DOGE,
    "ADA":  _ADA,
    "TON":  _TON,
}


def validate_address(network: str, address: str) -> ValidationResult:
    """
    Returns ValidationResult(valid=True) when address passes format check,
    or ValidationResult(valid=False, reason=...) otherwise.
    """
    pattern = _VALIDATORS.get(network.upper())
    if pattern is None:
        # Unknown network — let downstream reject it; don't block here
        return ValidationResult(valid=True, reason="")

    if pattern.match(address):
        return ValidationResult(valid=True, reason="")

    return ValidationResult(
        valid=False,
        reason=f"Address '{address}' does not match expected format for network {network}.",
    )
