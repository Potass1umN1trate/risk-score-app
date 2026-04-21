"""
Tests verifying alignment with the technical specification.

Covers the four contradictions fixed in this pass:
  A — network-aware flagged address matching
  B — period_days parameter accepted and validated
  C — network-specific address format validation
  D — nullable user_id in analysis request persistence

Run with:  pytest analytics/tests/test_spec_alignment.py -v
"""

import pytest
from pydantic import ValidationError

from app.validators.address import validate_address


# ─── Contradiction C: address format validation ───────────────────────────────

class TestAddressValidation:

    # Valid addresses
    @pytest.mark.parametrize("network,address", [
        ("BTC",  "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na"),  # genesis (strip test)
        ("BTC",  "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
        ("BTC",  "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"),
        ("ETH",  "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe"),
        ("BNB",  "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe"),
        ("TRX",  "TN9RRaXkCFtTXRso2GdTZxSxxwufzxLQPP"),
        ("SOL",  "So11111111111111111111111111111111111111112"),
        ("XRP",  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"),
        ("LTC",  "LQjStb1DcKcX8UBKJ5iNSTGcfT23HTCSP3"),
        ("DOGE", "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L"),
    ])
    def test_valid_addresses(self, network, address):
        result = validate_address(network, address.strip())
        assert result.valid, f"Expected {network}:{address} to be valid, got: {result.reason}"

    # Invalid addresses
    @pytest.mark.parametrize("network,address,reason_fragment", [
        ("BTC", "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe", "BTC"),
        ("ETH", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "ETH"),
        ("TRX", "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe", "TRX"),
        ("BTC", "short", "BTC"),
        ("XRP", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "XRP"),
    ])
    def test_invalid_addresses(self, network, address, reason_fragment):
        result = validate_address(network, address)
        assert not result.valid, f"Expected {network}:{address} to be invalid"
        assert reason_fragment in result.reason

    def test_unknown_network_passes_through(self):
        # Unknown networks are not rejected by the validator (downstream handles it)
        result = validate_address("UNKNOWN", "anyaddress1234567890")
        assert result.valid

    def test_btc_rejects_eth_address(self):
        eth_addr = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe"
        result = validate_address("BTC", eth_addr)
        assert not result.valid

    def test_eth_rejects_btc_address(self):
        btc_addr = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        result = validate_address("ETH", btc_addr)
        assert not result.valid


# ─── Contradiction B: period_days in AnalyzeRequest ──────────────────────────

class TestAnalyzeRequestSchema:
    """Pydantic model tests — do not require a running DB."""

    def _make_request(self, **kwargs):
        from app.api.analyze import AnalyzeRequest
        defaults = dict(
            address="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
            network="BTC",
        )
        defaults.update(kwargs)
        return AnalyzeRequest(**defaults)

    def test_period_days_optional(self):
        req = self._make_request()
        assert req.period_days is None

    def test_period_days_accepted(self):
        req = self._make_request(period_days=90)
        assert req.period_days == 90

    def test_period_days_max(self):
        req = self._make_request(period_days=3650)
        assert req.period_days == 3650

    def test_period_days_zero_rejected(self):
        with pytest.raises(ValidationError):
            self._make_request(period_days=0)

    def test_period_days_negative_rejected(self):
        with pytest.raises(ValidationError):
            self._make_request(period_days=-1)

    def test_period_days_above_max_rejected(self):
        with pytest.raises(ValidationError):
            self._make_request(period_days=3651)

    def test_network_normalized_to_uppercase(self):
        req = self._make_request(network="btc")
        assert req.network == "BTC"

    def test_address_stripped(self):
        req = self._make_request(address="  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa  ")
        assert req.address == "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"


# ─── Contradiction A: network-aware flagged lookup (signature checks) ─────────

class TestRepositorySignatures:
    """Verify that the repository functions require network_code (no DB needed)."""

    def test_get_address_flag_requires_network_code(self):
        import inspect
        from app.db.repository import get_address_flag
        sig = inspect.signature(get_address_flag)
        assert "network_code" in sig.parameters, (
            "get_address_flag must accept network_code for network-aware lookup"
        )

    def test_get_flagged_addresses_requires_network_code(self):
        import inspect
        from app.db.repository import get_flagged_addresses
        sig = inspect.signature(get_flagged_addresses)
        param = sig.parameters.get("network_code")
        assert param is not None, (
            "get_flagged_addresses must accept network_code"
        )
        # Must be a required parameter (no default) to prevent accidental cross-network matches
        assert param.default is inspect.Parameter.empty, (
            "network_code must be required (no default) to prevent accidental cross-network matches"
        )

    def test_get_address_flag_requires_network_code(self):
        import inspect
        from app.db.repository import get_address_flag
        sig = inspect.signature(get_address_flag)
        assert "network_code" in sig.parameters, (
            "get_address_flag must accept network_code for network-aware lookup"
        )


# ─── Contradiction D: save_analysis accepts user_id ──────────────────────────

class TestSaveAnalysisSignature:
    def test_save_analysis_accepts_user_id(self):
        import inspect
        from app.db.repository import save_analysis
        sig = inspect.signature(save_analysis)
        assert "user_id" in sig.parameters, (
            "save_analysis must accept user_id for user-bound history"
        )

    def test_user_id_defaults_to_none(self):
        import inspect
        from app.db.repository import save_analysis
        sig = inspect.signature(save_analysis)
        param = sig.parameters["user_id"]
        assert param.default is None, (
            "user_id must default to None to preserve anonymous/internal execution paths"
        )

    def test_get_history_by_user_exists(self):
        from app.db import repository
        assert hasattr(repository, "get_history_by_user"), (
            "get_history_by_user must exist for user-bound history retrieval"
        )
