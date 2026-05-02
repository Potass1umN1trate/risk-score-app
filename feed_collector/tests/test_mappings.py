from app.mappings import map_source_category, map_source_chain


def test_dummy_chain_mappings():
    assert map_source_chain("dummy", "BTC") == "BTC"
    assert map_source_chain("dummy", "ETH") == "ETH"
    assert map_source_chain("dummy", "FAKECHAIN") is None


def test_dummy_category_mappings():
    assert map_source_category("dummy", "scam") == "scam"
    assert map_source_category("dummy", "phishing") == "phishing"
    assert map_source_category("dummy", "suspicious") == "suspicious"


def test_chainabuse_chain_mappings():
    assert map_source_chain("chainabuse", "BTC") == "BTC"
    assert map_source_chain("chainabuse", "ETH") == "ETH"
    assert map_source_chain("chainabuse", "TRON") == "TRX"
    assert map_source_chain("chainabuse", "SOL") == "SOL"
    assert map_source_chain("chainabuse", "BINANCE") == "BNB"
    assert map_source_chain("chainabuse", "LITECOIN") == "LTC"
    assert map_source_chain("chainabuse", "CARDANO") == "ADA"
    assert map_source_chain("chainabuse", "TON") == "TON"


def test_chainabuse_unsupported_xrp_and_doge():
    assert map_source_chain("chainabuse", "XRP") is None
    assert map_source_chain("chainabuse", "DOGE") is None


def test_chainabuse_known_but_unseeded_networks_return_none():
    assert map_source_chain("chainabuse", "POLYGON") is None
    assert map_source_chain("chainabuse", "BASE") is None


def test_scamsniffer_synthetic_chain_labels_map_to_eth_and_bnb():
    assert map_source_chain("scamsniffer", "EVM_UNSPECIFIED_EXPANDED_ETH") == "ETH"
    assert map_source_chain("scamsniffer", "EVM_UNSPECIFIED_EXPANDED_BNB") == "BNB"


def test_ofac_asset_chain_mappings():
    expected = {
        "XBT": "BTC",
        "BTC": "BTC",
        "ETH": "ETH",
        "TRX": "TRX",
        "LTC": "LTC",
        "XRP": "XRP",
        "ADA": "ADA",
        "DOGE": "DOGE",
        "TON": "TON",
        "BNB": "BNB",
        "BSC": "BNB",
        "OFAC_TOKEN_USDT_ETH_INFERRED": "ETH",
        "OFAC_TOKEN_USDC_ETH_INFERRED": "ETH",
        "OFAC_TOKEN_USDT_TRX_INFERRED": "TRX",
        "OFAC_TOKEN_USDC_TRX_INFERRED": "TRX",
    }

    for source_chain, network_code in expected.items():
        assert map_source_chain("ofac", source_chain) == network_code


def test_chainabuse_direct_category_mappings():
    assert map_source_category("chainabuse", "PHISHING") == "phishing"
    assert map_source_category("chainabuse", "RANSOMWARE") == "ransomware"


def test_chainabuse_scam_group_maps_to_scam():
    scam_categories = [
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
    ]
    for category in scam_categories:
        assert map_source_category("chainabuse", category) == "scam"


def test_chainabuse_suspicious_group_null_and_unknown_map_to_suspicious():
    suspicious_categories = [
        "CONTRACT_EXPLOIT",
        "AIRDROP",
        "MAN_IN_THE_MIDDLE_ATTACK",
        "OTHER_HACK",
        "OTHER_BLACKMAIL",
        "OTHER",
        None,
        "SOMETHING_NEW",
    ]
    for category in suspicious_categories:
        assert map_source_category("chainabuse", category) == "suspicious"


def test_scamsniffer_category_maps_to_phishing():
    assert map_source_category("scamsniffer", "PHISHING") == "phishing"
    assert map_source_category("scamsniffer", "phishing") == "phishing"
    assert map_source_category("scamsniffer", None) == "phishing"
    assert map_source_category("scamsniffer", "SOMETHING_NEW") == "phishing"


def test_ofac_category_always_maps_to_sanctions():
    assert map_source_category("ofac", "CYBER2,DPRK3") == "sanctions"
    assert map_source_category("ofac", "SANCTIONS") == "sanctions"
    assert map_source_category("ofac", "SOMETHING_NEW") == "sanctions"
    assert map_source_category("ofac", None) == "sanctions"


def test_mappings_are_case_insensitive_and_strip_whitespace():
    assert map_source_chain(" ChainAbuse ", " tron ") == "TRX"
    assert map_source_category(" ChainAbuse ", " phishing ") == "phishing"
    assert map_source_chain(" dummy ", " eth ") == "ETH"
    assert map_source_category(" dummy ", " scam ") == "scam"
    assert (
        map_source_chain(" ScamSniffer ", " evm_unspecified_expanded_eth ") == "ETH"
    )
    assert map_source_category(" ScamSniffer ", " phishing ") == "phishing"
    assert map_source_chain(" Ofac ", " xbt ") == "BTC"
    assert map_source_category(" Ofac ", " cyber2 ") == "sanctions"
