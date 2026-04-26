"""
Unit tests for analytics/app/scoring/xgboost_scorer.py

Covers:
  - _validate_feature_vector: all validation failure paths (no model artifacts needed)
  - UniversalXGBoostScorer heuristic fallback when model file is missing
  - Optional smoke test for loaded scorer (skip-guarded when artifacts absent)

All tests in Groups A and B are pure unit tests:
  no DB, no network, no FastAPI, no Docker, no model artifacts.
"""

import dataclasses
import types
from pathlib import Path

import numpy as np
import pytest

import app.scoring.xgboost_scorer as scorer_module
from app.graph.features import AddressFeatures, OUR_FEATURE_NAMES
from app.scoring.xgboost_scorer import (
    ScoringValidationError,
    _FALLBACK_RAW_STATS,
    _validate_feature_vector,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _feat(**overrides) -> AddressFeatures:
    """Zero feature vector with selected fields replaced."""
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


def _good_stats() -> dict:
    """Valid scaler stats covering all _LOG_FEATURES — use to seed _RAW_STATS."""
    return dict(_FALLBACK_RAW_STATS)


# ── Group A: _validate_feature_vector — direct calls, no scorer, no files ────

class TestValidationPasses:

    def test_valid_zero_features_with_none_model(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        result = _validate_feature_vector(_feat(), None)
        assert result.shape == (27,)

    def test_valid_zero_features_with_model_feature_names_none(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        mock_model = types.SimpleNamespace(feature_names=None)
        result = _validate_feature_vector(_feat(), mock_model)
        assert result.shape == (27,)

    def test_valid_zero_features_model_without_feature_names_attr(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        mock_model = types.SimpleNamespace()  # no feature_names attribute at all
        result = _validate_feature_vector(_feat(), mock_model)
        assert result.shape == (27,)


class TestNonFiniteValues:

    def test_nan_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match="non-finite"):
            _validate_feature_vector(_feat(tx_in_count=float("nan")), None)

    def test_positive_inf_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match="non-finite"):
            _validate_feature_vector(_feat(total_received=float("inf")), None)

    def test_negative_inf_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match="non-finite"):
            _validate_feature_vector(_feat(total_sent=float("-inf")), None)


class TestNegativeValues:

    def test_negative_tx_in_count_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match="non-negative"):
            _validate_feature_vector(_feat(tx_in_count=-1), None)

    def test_negative_unique_counterparties_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match="non-negative"):
            _validate_feature_vector(_feat(unique_counterparties=-5), None)

    def test_negative_lifespan_days_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match="non-negative"):
            _validate_feature_vector(_feat(lifespan_days=-1), None)


class TestRatioFeatureBounds:

    def test_graph_density_above_one_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match=r"\[0, 1\]"):
            _validate_feature_vector(_feat(graph_density=1.5), None)

    def test_graph_density_below_zero_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match=r"\[0, 1\]"):
            _validate_feature_vector(_feat(graph_density=-0.1), None)

    def test_clustering_coefficient_above_one_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match=r"\[0, 1\]"):
            _validate_feature_vector(_feat(clustering_coefficient=1.01), None)

    def test_clustering_coefficient_below_zero_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match=r"\[0, 1\]"):
            _validate_feature_vector(_feat(clustering_coefficient=-0.01), None)

    def test_flagged_neighbors_ratio_above_one_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match=r"\[0, 1\]"):
            _validate_feature_vector(_feat(flagged_neighbors_ratio=1.001), None)

    def test_flagged_neighbors_ratio_below_zero_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        with pytest.raises(ScoringValidationError, match=r"\[0, 1\]"):
            _validate_feature_vector(_feat(flagged_neighbors_ratio=-0.001), None)


class TestScalerStats:

    def test_missing_scaler_stat_raises(self, monkeypatch):
        # Drop one required log-feature key from _RAW_STATS
        stats = _good_stats()
        stats.pop("tx_in_count")
        monkeypatch.setattr(scorer_module, "_RAW_STATS", stats)
        with pytest.raises(ScoringValidationError, match="Missing scaler stats"):
            _validate_feature_vector(_feat(), None)

    def test_sigma_zero_raises(self, monkeypatch):
        stats = _good_stats()
        stats["tx_in_count"] = (0.7, 0.0)  # sigma == 0
        monkeypatch.setattr(scorer_module, "_RAW_STATS", stats)
        with pytest.raises(ScoringValidationError, match="Invalid scaler stats"):
            _validate_feature_vector(_feat(), None)

    def test_sigma_negative_raises(self, monkeypatch):
        stats = _good_stats()
        stats["tx_in_count"] = (0.7, -1.0)  # sigma < 0
        monkeypatch.setattr(scorer_module, "_RAW_STATS", stats)
        with pytest.raises(ScoringValidationError, match="Invalid scaler stats"):
            _validate_feature_vector(_feat(), None)

    def test_sigma_inf_raises(self, monkeypatch):
        stats = _good_stats()
        stats["tx_out_count"] = (0.9, float("inf"))
        monkeypatch.setattr(scorer_module, "_RAW_STATS", stats)
        with pytest.raises(ScoringValidationError, match="Invalid scaler stats"):
            _validate_feature_vector(_feat(), None)

    def test_mu_nan_raises(self, monkeypatch):
        stats = _good_stats()
        stats["total_received"] = (float("nan"), 1.5)
        monkeypatch.setattr(scorer_module, "_RAW_STATS", stats)
        with pytest.raises(ScoringValidationError, match="Invalid scaler stats"):
            _validate_feature_vector(_feat(), None)


class TestBoosterFeatureNames:

    def test_booster_feature_name_mismatch_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        wrong_names = OUR_FEATURE_NAMES[::-1]  # reversed order
        mock_model = types.SimpleNamespace(feature_names=wrong_names)
        with pytest.raises(ScoringValidationError, match="booster feature names"):
            _validate_feature_vector(_feat(), mock_model)

    def test_booster_feature_names_none_skips_check(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        mock_model = types.SimpleNamespace(feature_names=None)
        # Must not raise
        _validate_feature_vector(_feat(), mock_model)

    def test_booster_partial_name_list_raises(self, monkeypatch):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        mock_model = types.SimpleNamespace(feature_names=OUR_FEATURE_NAMES[:10])
        with pytest.raises(ScoringValidationError, match="booster feature names"):
            _validate_feature_vector(_feat(), mock_model)


class TestFieldOrderAndLength:

    def test_field_order_mismatch_raises(self, monkeypatch):
        # Patch OUR_FEATURE_NAMES in the scorer module to a reversed list.
        # _validate_feature_vector checks fields(AddressFeatures) != OUR_FEATURE_NAMES.
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        reversed_names = list(reversed(OUR_FEATURE_NAMES))
        monkeypatch.setattr(scorer_module, "OUR_FEATURE_NAMES", reversed_names)
        with pytest.raises(ScoringValidationError, match="field order"):
            _validate_feature_vector(_feat(), None)

    def test_vector_length_mismatch_raises(self, monkeypatch):
        # Add an extra name to OUR_FEATURE_NAMES so len != 27.
        monkeypatch.setattr(scorer_module, "_RAW_STATS", _good_stats())
        extra_names = OUR_FEATURE_NAMES + ["extra_feature"]
        monkeypatch.setattr(scorer_module, "OUR_FEATURE_NAMES", extra_names)
        # field order check passes (fields still != extra_names), but the
        # field-order mismatch fires first; both are ScoringValidationError
        with pytest.raises(ScoringValidationError):
            _validate_feature_vector(_feat(), None)


# ── Group B: heuristic fallback — no model artifacts ─────────────────────────

# Fixture that creates a scorer pointing at a nonexistent model path.
# _RAW_STATS must be reset to {} so _load() repopulates it from fallback stats.
# monkeypatch is function-scoped so state is restored after each test.

@pytest.fixture
def heuristic_scorer(monkeypatch, tmp_path):
    """
    UniversalXGBoostScorer with no model file — heuristic-only mode.
    _RAW_STATS is reset to {} before construction so _load() runs fresh.
    """
    from app.scoring.xgboost_scorer import UniversalXGBoostScorer
    monkeypatch.setattr(scorer_module, "_RAW_STATS", {})
    return UniversalXGBoostScorer("BTC", str(tmp_path / "nonexistent_model.json"))


class TestHeuristicFallback:

    def test_is_model_loaded_false(self, heuristic_scorer):
        assert heuristic_scorer.is_model_loaded is False

    def test_model_version_is_heuristic_string(self, heuristic_scorer, zero_features):
        result = heuristic_scorer.score(zero_features)
        assert result.model_version == "universal_xgboost_v1_heuristic"

    def test_zero_features_score_is_zero(self, heuristic_scorer, zero_features):
        result = heuristic_scorer.score(zero_features)
        assert result.score == 0.0

    def test_zero_features_risk_level_is_low(self, heuristic_scorer, zero_features):
        result = heuristic_scorer.score(zero_features)
        assert result.risk_level == "LOW"

    def test_sanctions_flag_increases_score(self, heuristic_scorer, zero_features):
        base = heuristic_scorer.score(zero_features)
        features_with_flag = dataclasses.replace(zero_features, flag_sanctions=1)
        flagged_result = heuristic_scorer.score(features_with_flag)
        assert flagged_result.score > base.score

    def test_high_tx_per_day_increases_score(self, heuristic_scorer, zero_features):
        base = heuristic_scorer.score(zero_features)
        features_high_freq = dataclasses.replace(zero_features, tx_per_day=110.0)
        high_freq_result = heuristic_scorer.score(features_high_freq)
        assert high_freq_result.score > base.score

    def test_close_flagged_neighbor_increases_score(self, heuristic_scorer, zero_features):
        base = heuristic_scorer.score(zero_features)
        features_close = dataclasses.replace(zero_features, min_dist_to_flagged=1)
        close_result = heuristic_scorer.score(features_close)
        assert close_result.score > base.score

    def test_score_is_deterministic(self, heuristic_scorer, zero_features):
        features = dataclasses.replace(zero_features, flag_mixer=1, tx_per_day=55.0)
        r1 = heuristic_scorer.score(features)
        r2 = heuristic_scorer.score(features)
        assert r1.score == r2.score
        assert r1.risk_level == r2.risk_level

    def test_score_capped_at_100(self, heuristic_scorer, zero_features):
        # Max out every flag and proximity signal
        extreme = dataclasses.replace(
            zero_features,
            min_dist_to_flagged=1,
            flag_sanctions=10, flag_mixer=10, flag_darknet_market=10,
            flag_ransomware=10, flag_scam=10, flag_phishing=10,
            flag_suspicious=10, flag_gambling=10,
            flagged_neighbors_ratio=1.0,
            tx_per_day=200.0,
        )
        result = heuristic_scorer.score(extreme)
        assert result.score <= 100.0

    def test_result_has_valid_risk_level(self, heuristic_scorer, zero_features):
        features = dataclasses.replace(zero_features, flag_ransomware=1)
        result = heuristic_scorer.score(features)
        assert result.risk_level in {"LOW", "MEDIUM", "HIGH"}

    def test_raw_probability_consistent_with_score(self, heuristic_scorer, zero_features):
        features = dataclasses.replace(zero_features, flag_scam=1)
        result = heuristic_scorer.score(features)
        assert result.raw_probability == pytest.approx(result.score / 100.0, abs=1e-3)


# ── Group C: smoke tests (skip-guarded when model artifacts are absent) ───────

_MODEL_PATH = Path("models/btc_xgboost.json")

pytestmark_smoke = pytest.mark.skipif(
    not _MODEL_PATH.exists(),
    reason="Model artifacts not present (run: cd analytics && python -m training.train_btc)",
)


@pytest.mark.skipif(
    not _MODEL_PATH.exists(),
    reason="Model artifacts not present (run: cd analytics && python -m training.train_btc)",
)
class TestLoadedScorerSmoke:

    def test_is_model_loaded_true(self, loaded_scorer):
        assert loaded_scorer.is_model_loaded is True

    def test_score_returns_valid_score_result(self, loaded_scorer, zero_features):
        from app.scoring.base import ScoreResult
        result = loaded_scorer.score(zero_features)
        assert isinstance(result, ScoreResult)
        assert 0.0 <= result.score <= 100.0
        assert result.risk_level in {"LOW", "MEDIUM", "HIGH"}
        assert result.model_version == "universal_xgboost_v1"

    def test_score_raw_probability_in_range(self, loaded_scorer, zero_features):
        result = loaded_scorer.score(zero_features)
        assert 0.0 <= result.raw_probability <= 1.0
