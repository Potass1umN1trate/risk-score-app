"""
Source-aware mappings from feed-native values into project codes.

These mappings intentionally do not fetch from external sources. They only
translate source payload values already handed to the feed collector.
"""

_DUMMY_CHAIN_MAP: dict[str, str | None] = {
    "BTC": "BTC",
    "ETH": "ETH",
    "FAKECHAIN": None,
}

_DUMMY_CATEGORY_MAP: dict[str, str] = {
    "SCAM": "scam",
    "PHISHING": "phishing",
    "SUSPICIOUS": "suspicious",
}

_CHAINABUSE_CHAIN_MAP: dict[str, str | None] = {
    "BTC": "BTC",
    "ETH": "ETH",
    "TRON": "TRX",
    "SOL": "SOL",
    "BINANCE": "BNB",
    "LITECOIN": "LTC",
    "CARDANO": "ADA",
    "TON": "TON",
    "POLYGON": None,
    "HBAR": None,
    "AVALANCHE": None,
    "MULTIVERSX": None,
    "ARBITRUM": None,
    "ALGORAND": None,
    "BASE": None,
    "XRP": None,
    "DOGE": None,
}

_SCAMSNIFFER_CHAIN_MAP: dict[str, str | None] = {
    "EVM_UNSPECIFIED_EXPANDED_ETH": "ETH",
    "EVM_UNSPECIFIED_EXPANDED_BNB": "BNB",
}

_CHAINABUSE_SCAM_CATEGORIES: frozenset[str] = frozenset(
    {
        "RUG_PULL",
        "UKRANIAN_DONATION_SCAM",
        "DONATION_SCAM",
        "SEXTORTION",
        "SIM_SWAP",
        "ROMANCE",
        "PIGBUTCHERING",
        "FAKE_PROJECT",
        "IMPERSONATION",
        "FAKE_RETURNS",
        "UPGRADE_SCAM",
        "OTHER_INVESTMENT_SCAM",
    }
)

_CHAINABUSE_SUSPICIOUS_CATEGORIES: frozenset[str] = frozenset(
    {
        "CONTRACT_EXPLOIT",
        "AIRDROP",
        "MAN_IN_THE_MIDDLE_ATTACK",
        "OTHER_HACK",
        "OTHER_BLACKMAIL",
        "OTHER",
    }
)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned.upper()


def map_source_chain(source_code: str, source_chain: str | None) -> str | None:
    source = _clean(source_code)
    chain = _clean(source_chain)
    if chain is None:
        return None

    if source == "DUMMY":
        return _DUMMY_CHAIN_MAP.get(chain)
    if source == "CHAINABUSE":
        return _CHAINABUSE_CHAIN_MAP.get(chain)
    if source == "SCAMSNIFFER":
        return _SCAMSNIFFER_CHAIN_MAP.get(chain)
    return None


def map_source_category(source_code: str, source_category: str | None) -> str | None:
    source = _clean(source_code)
    category = _clean(source_category)

    if source == "DUMMY":
        if category is None:
            return None
        return _DUMMY_CATEGORY_MAP.get(category)

    if source == "CHAINABUSE":
        if category is None:
            return "suspicious"
        if category == "PHISHING":
            return "phishing"
        if category == "RANSOMWARE":
            return "ransomware"
        if category in _CHAINABUSE_SCAM_CATEGORIES:
            return "scam"
        if category in _CHAINABUSE_SUSPICIOUS_CATEGORIES:
            return "suspicious"
        return "suspicious"

    if source == "SCAMSNIFFER":
        if category is None:
            return "phishing"
        if category == "PHISHING":
            return "phishing"
        return "phishing"

    return None
