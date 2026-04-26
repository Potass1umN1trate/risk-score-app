"""
Unit tests for analytics/app/scoring/factors.py

Covers:
  - Schema shape: every returned factor has exactly the five required keys
  - Database path: root_flag present → root_address_flagged factor
  - Clean/empty: no factors when inputs are zero/None
  - Flagged neighbors: count, addresses, severity thresholds
  - Low distance to flagged address: emit range 1–3, suppress outside
  - Elevated flagged-neighbor ratio: threshold and severity tiers
  - Category-specific flags: all 8 categories (parametrized)
  - High transaction frequency: threshold and severity tiers
  - Many unique counterparties: threshold and severity tiers
  - High received / sent volume: threshold and severity tiers

All tests are pure unit tests: no DB, no network, no async, no FastAPI, no model files.
"""

import dataclasses

import pytest

from app.graph.features import AddressFeatures, FLAG_CATEGORIES
from app.scoring.base import ScoreResult
from app.scoring.factors import build_factors

_SCHEMA_KEYS = {"key", "label", "value", "severity", "description"}

_VALID_SEVERITIES = {"LOW", "MEDIUM", "HIGH"}


def _score(risk_level: str = "LOW") -> ScoreResult:
    return ScoreResult(score=0.0, risk_level=risk_level,
                       model_version="test", raw_probability=0.0)


def _feat(**overrides) -> AddressFeatures:
    """Return zero_features with selected fields replaced."""
    base = AddressFeatures(
        tx_in_count=0, tx_out_count=0,
        total_received=0.0, total_sent=0.0,
        median_tx_amount=0.0, max_tx_amount=0.0,
        unique_counterparties=0,
        depth1_neighbors=0, depth2_neighbors=0,
        in_degree=0, out_degree=0,
        graph_density=0.0, clustering_coefficient=0.0,
        active_days=0, tx_per_day=0.0, lifespan_days=0,
        flagged_neighbors_count=0, flagged_neighbors_ratio=0.0,
        min_dist_to_flagged=999,
        flag_mixer=0, flag_scam=0, flag_sanctions=0, flag_darknet_market=0,
        flag_ransomware=0, flag_gambling=0, flag_phishing=0, flag_suspicious=0,
    )
    return dataclasses.replace(base, **overrides)


# ── Group A: schema shape ─────────────────────────────────────────────────────

class TestFactorSchemaShape:

    def test_root_flag_factor_has_required_keys(self):
        factors = build_factors(
            features=None,
            flagged={},
            root_flag={"flag_type": "ransomware"},
            score_result=_score("HIGH"),
        )
        assert len(factors) == 1
        assert set(factors[0].keys()) == _SCHEMA_KEYS

    def test_multi_factor_result_all_have_required_keys(self):
        features = _feat(
            flagged_neighbors_count=1,
            flagged_neighbors_ratio=0.5,
            min_dist_to_flagged=1,
            flag_ransomware=1,
            tx_per_day=25.0,
            unique_counterparties=25,
            total_received=15.0,
            total_sent=15.0,
        )
        flagged = {"addr1": ["ransomware"]}
        factors = build_factors(
            features=features,
            flagged=flagged,
            root_flag=None,
            score_result=_score("HIGH"),
        )
        assert len(factors) > 0
        for f in factors:
            assert set(f.keys()) == _SCHEMA_KEYS

    def test_all_severities_are_valid(self):
        features = _feat(
            flagged_neighbors_count=5,
            flagged_neighbors_ratio=0.5,
            min_dist_to_flagged=1,
            flag_sanctions=1,
            flag_gambling=1,
            tx_per_day=110.0,
            unique_counterparties=110,
            total_received=1100.0,
            total_sent=1100.0,
        )
        factors = build_factors(
            features=features,
            flagged={"a": ["sanctions"], "b": ["gambling"], "c": ["sanctions"],
                     "d": ["gambling"], "e": ["sanctions"]},
            root_flag={"flag_type": "sanctions"},
            score_result=_score("HIGH"),
        )
        for f in factors:
            assert f["severity"] in _VALID_SEVERITIES


# ── Group B: database path / root flagged ─────────────────────────────────────

class TestRootFlagFactor:

    def test_root_flag_emits_factor(self):
        factors = build_factors(
            features=None, flagged={},
            root_flag={"flag_type": "scam"},
            score_result=_score("MEDIUM"),
        )
        keys = [f["key"] for f in factors]
        assert "root_address_flagged" in keys

    def test_root_flag_value_is_flag_type(self):
        factors = build_factors(
            features=None, flagged={},
            root_flag={"flag_type": "mixer"},
            score_result=_score("LOW"),
        )
        factor = next(f for f in factors if f["key"] == "root_address_flagged")
        assert factor["value"] == "mixer"

    @pytest.mark.parametrize("risk_level", ["LOW", "MEDIUM", "HIGH"])
    def test_root_flag_severity_follows_score_result(self, risk_level):
        factors = build_factors(
            features=None, flagged={},
            root_flag={"flag_type": "sanctions"},
            score_result=_score(risk_level),
        )
        factor = next(f for f in factors if f["key"] == "root_address_flagged")
        assert factor["severity"] == risk_level

    def test_features_none_with_root_flag_returns_only_root_flag(self):
        factors = build_factors(
            features=None, flagged={},
            root_flag={"flag_type": "phishing"},
            score_result=_score("HIGH"),
        )
        assert len(factors) == 1
        assert factors[0]["key"] == "root_address_flagged"


# ── Group C: clean / empty output ─────────────────────────────────────────────

class TestCleanEmptyOutput:

    def test_features_none_no_root_flag_returns_empty(self):
        factors = build_factors(
            features=None, flagged={},
            root_flag=None,
            score_result=_score("LOW"),
        )
        assert factors == []

    def test_zero_features_no_flags_no_root_flag_returns_empty(self, zero_features):
        factors = build_factors(
            features=zero_features, flagged={},
            root_flag=None,
            score_result=_score("LOW"),
        )
        assert factors == []


# ── Group D: flagged neighbors ────────────────────────────────────────────────

class TestFlaggedNeighbors:

    def test_one_flagged_neighbor_emits_factor(self):
        features = _feat(flagged_neighbors_count=1)
        flagged = {"addr1": ["scam"]}
        factors = build_factors(features=features, flagged=flagged,
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "flagged_neighbors_present" in keys

    def test_zero_flagged_neighbors_no_factor(self):
        factors = build_factors(features=_feat(), flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "flagged_neighbors_present" not in keys

    def test_value_contains_count_and_addresses(self):
        features = _feat(flagged_neighbors_count=2)
        flagged = {"addr_b": ["scam"], "addr_a": ["mixer"]}
        factors = build_factors(features=features, flagged=flagged,
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == "flagged_neighbors_present")
        assert factor["value"]["count"] == 2
        assert "addresses" in factor["value"]

    def test_addresses_in_value_are_sorted(self):
        features = _feat(flagged_neighbors_count=3)
        flagged = {"zzz": ["scam"], "aaa": ["mixer"], "mmm": ["phishing"]}
        factors = build_factors(features=features, flagged=flagged,
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == "flagged_neighbors_present")
        addresses = factor["value"]["addresses"]
        assert addresses == sorted(addresses)

    def test_addresses_capped_at_10(self):
        features = _feat(flagged_neighbors_count=15)
        flagged = {f"addr{i:02d}": ["scam"] for i in range(15)}
        factors = build_factors(features=features, flagged=flagged,
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == "flagged_neighbors_present")
        assert len(factor["value"]["addresses"]) <= 10

    def test_severity_medium_when_count_less_than_3(self):
        features = _feat(flagged_neighbors_count=2)
        flagged = {"a": ["scam"], "b": ["mixer"]}
        factors = build_factors(features=features, flagged=flagged,
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == "flagged_neighbors_present")
        assert factor["severity"] == "MEDIUM"

    def test_severity_high_when_count_ge_3(self):
        features = _feat(flagged_neighbors_count=3)
        flagged = {"a": ["scam"], "b": ["mixer"], "c": ["phishing"]}
        factors = build_factors(features=features, flagged=flagged,
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == "flagged_neighbors_present")
        assert factor["severity"] == "HIGH"


# ── Group E: low distance to flagged address ──────────────────────────────────

class TestLowDistanceToFlagged:

    @pytest.mark.parametrize("distance,expected_severity", [
        (1, "HIGH"),
        (2, "MEDIUM"),
        (3, "LOW"),
    ])
    def test_distances_1_2_3_emit_factor_with_correct_severity(self, distance, expected_severity):
        features = _feat(min_dist_to_flagged=distance)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next((f for f in factors if f["key"] == "low_distance_to_flagged_address"), None)
        assert factor is not None
        assert factor["severity"] == expected_severity

    @pytest.mark.parametrize("distance", [4, 5, 999])
    def test_distances_outside_range_do_not_emit(self, distance):
        features = _feat(min_dist_to_flagged=distance)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "low_distance_to_flagged_address" not in keys

    def test_factor_value_is_the_distance(self):
        features = _feat(min_dist_to_flagged=2)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == "low_distance_to_flagged_address")
        assert factor["value"] == 2


# ── Group F: elevated flagged-neighbor ratio ──────────────────────────────────

class TestElevatedFlaggedNeighborRatio:

    def test_ratio_below_threshold_does_not_emit(self):
        features = _feat(flagged_neighbors_ratio=0.09)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "elevated_flagged_neighbor_ratio" not in keys

    @pytest.mark.parametrize("ratio,expected_severity", [
        (0.10, "MEDIUM"),
        (0.15, "MEDIUM"),
        (0.25, "HIGH"),
        (0.50, "HIGH"),
    ])
    def test_ratio_at_and_above_threshold_emits_with_correct_severity(self, ratio, expected_severity):
        features = _feat(flagged_neighbors_ratio=ratio)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next((f for f in factors if f["key"] == "elevated_flagged_neighbor_ratio"), None)
        assert factor is not None
        assert factor["severity"] == expected_severity


# ── Group G: category-specific flags ─────────────────────────────────────────

_CATEGORY_EXPECTED_SEVERITY = {
    "sanctions": "HIGH",
    "darknet_market": "HIGH",
    "ransomware": "HIGH",
    "mixer": "MEDIUM",
    "scam": "MEDIUM",
    "phishing": "MEDIUM",
    "gambling": "LOW",
    "suspicious": "LOW",
}


class TestCategoryFlags:

    @pytest.mark.parametrize("category", FLAG_CATEGORIES)
    def test_nonzero_flag_emits_category_factor(self, category):
        features = _feat(**{f"flag_{category}": 1})
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert f"category_{category}_present" in keys

    @pytest.mark.parametrize("category", FLAG_CATEGORIES)
    def test_zero_flag_does_not_emit_category_factor(self, category):
        factors = build_factors(features=_feat(), flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert f"category_{category}_present" not in keys

    @pytest.mark.parametrize("category", FLAG_CATEGORIES)
    def test_category_factor_severity(self, category):
        features = _feat(**{f"flag_{category}": 2})
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == f"category_{category}_present")
        assert factor["severity"] == _CATEGORY_EXPECTED_SEVERITY[category]

    @pytest.mark.parametrize("category", FLAG_CATEGORIES)
    def test_category_factor_value_is_count(self, category):
        features = _feat(**{f"flag_{category}": 3})
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next(f for f in factors if f["key"] == f"category_{category}_present")
        assert factor["value"] == 3


# ── Group H: high transaction frequency ──────────────────────────────────────

class TestHighTransactionFrequency:

    def test_tx_per_day_at_threshold_does_not_emit(self):
        features = _feat(tx_per_day=20.0)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "high_transaction_frequency" not in keys

    @pytest.mark.parametrize("tx_per_day,expected_severity", [
        (21.0, "LOW"),
        (51.0, "MEDIUM"),
        (101.0, "HIGH"),
    ])
    def test_tx_per_day_above_threshold_emits_with_correct_severity(self, tx_per_day, expected_severity):
        features = _feat(tx_per_day=tx_per_day)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next((f for f in factors if f["key"] == "high_transaction_frequency"), None)
        assert factor is not None
        assert factor["severity"] == expected_severity


# ── Group I: many unique counterparties ──────────────────────────────────────

class TestManyUniqueCounterparties:

    def test_below_threshold_does_not_emit(self):
        features = _feat(unique_counterparties=19)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "high_unique_counterparties" not in keys

    @pytest.mark.parametrize("count,expected_severity", [
        (20, "LOW"),
        (49, "LOW"),
        (50, "MEDIUM"),
        (99, "MEDIUM"),
        (100, "HIGH"),
    ])
    def test_at_and_above_threshold_emits_with_correct_severity(self, count, expected_severity):
        features = _feat(unique_counterparties=count)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next((f for f in factors if f["key"] == "high_unique_counterparties"), None)
        assert factor is not None
        assert factor["severity"] == expected_severity


# ── Group J: high received / sent volume ──────────────────────────────────────

class TestHighVolume:

    def test_received_below_threshold_does_not_emit(self):
        features = _feat(total_received=9.0)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "high_total_received" not in keys

    def test_sent_below_threshold_does_not_emit(self):
        features = _feat(total_sent=9.0)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        keys = [f["key"] for f in factors]
        assert "high_total_sent" not in keys

    @pytest.mark.parametrize("amount,expected_severity", [
        (10.0, "LOW"),
        (99.0, "LOW"),
        (100.0, "MEDIUM"),
        (999.0, "MEDIUM"),
        (1000.0, "HIGH"),
    ])
    def test_received_severity_tiers(self, amount, expected_severity):
        features = _feat(total_received=amount)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next((f for f in factors if f["key"] == "high_total_received"), None)
        assert factor is not None
        assert factor["severity"] == expected_severity

    @pytest.mark.parametrize("amount,expected_severity", [
        (10.0, "LOW"),
        (100.0, "MEDIUM"),
        (1000.0, "HIGH"),
    ])
    def test_sent_severity_tiers(self, amount, expected_severity):
        features = _feat(total_sent=amount)
        factors = build_factors(features=features, flagged={},
                                root_flag=None, score_result=_score())
        factor = next((f for f in factors if f["key"] == "high_total_sent"), None)
        assert factor is not None
        assert factor["severity"] == expected_severity
