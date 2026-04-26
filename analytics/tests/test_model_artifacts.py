"""
Model artifact verification tests for analytics-service scoring.

Real-artifact checks are skip-guarded so a clean checkout without model files
still passes the normal suite. Fallback and corrupted-scaler tests use tmp_path
only and never mutate analytics/models/.
"""

import json
import math
from pathlib import Path

import pytest

import app.scoring.xgboost_scorer as scorer_module
from app.graph.features import OUR_FEATURE_NAMES
from app.scoring.xgboost_scorer import (
    ScoringValidationError,
    UniversalXGBoostScorer,
    _FALLBACK_RAW_STATS,
    _LOG_FEATURES,
)


_ANALYTICS_DIR = Path(__file__).resolve().parents[1]
_MODEL_PATH = _ANALYTICS_DIR / "models" / "btc_xgboost.json"
_SCALER_PATH = _ANALYTICS_DIR / "models" / "btc_scaler.json"
_ARTIFACTS_PRESENT = _MODEL_PATH.exists() and _SCALER_PATH.exists()
_ARTIFACT_SKIP_REASON = (
    "Model artifacts not present (expected analytics/models/btc_xgboost.json "
    "and analytics/models/btc_scaler.json)"
)


def _load_scaler() -> dict:
    return json.loads(_SCALER_PATH.read_text(encoding="utf-8"))


@pytest.mark.skipif(not _ARTIFACTS_PRESENT, reason=_ARTIFACT_SKIP_REASON)
class TestRealModelArtifacts:

    def test_artifact_files_are_present(self):
        assert _MODEL_PATH.is_file()
        assert _SCALER_PATH.is_file()

    def test_scaler_keys_match_log_features(self):
        scaler = _load_scaler()
        assert set(scaler.keys()) == _LOG_FEATURES

    def test_scaler_values_are_finite_with_positive_sigma(self):
        scaler = _load_scaler()
        for name, value in scaler.items():
            mu, sigma = value
            assert math.isfinite(float(mu)), name
            assert math.isfinite(float(sigma)), name
            assert float(sigma) > 0.0, name

    def test_booster_feature_names_match_feature_vector(self):
        import xgboost as xgb

        booster = xgb.Booster()
        booster.load_model(str(_MODEL_PATH))
        assert list(booster.feature_names) == OUR_FEATURE_NAMES

    def test_real_scorer_loads_and_scores(self, monkeypatch, zero_features):
        monkeypatch.setattr(scorer_module, "_RAW_STATS", {})
        scorer = UniversalXGBoostScorer("BTC", str(_MODEL_PATH))

        assert scorer.is_model_loaded is True

        result = scorer.score(zero_features)
        assert 0.0 <= result.score <= 100.0
        assert result.risk_level in {"LOW", "MEDIUM", "HIGH"}
        assert result.model_version == "universal_xgboost_v1"


def test_missing_model_uses_heuristic_fallback(monkeypatch, tmp_path, zero_features):
    monkeypatch.setattr(scorer_module, "_RAW_STATS", {})
    scorer = UniversalXGBoostScorer("BTC", str(tmp_path / "missing_model.json"))

    assert scorer.is_model_loaded is False

    result = scorer.score(zero_features)
    assert result.model_version == "universal_xgboost_v1_heuristic"
    assert 0.0 <= result.score <= 100.0
    assert result.risk_level in {"LOW", "MEDIUM", "HIGH"}


def test_corrupted_scaler_fails_at_scorer_validation(monkeypatch, tmp_path, zero_features):
    bad_stats = {name: list(values) for name, values in _FALLBACK_RAW_STATS.items()}
    bad_stats["tx_in_count"] = [0.7, 0.0]
    (tmp_path / "btc_scaler.json").write_text(json.dumps(bad_stats), encoding="utf-8")

    monkeypatch.setattr(scorer_module, "_RAW_STATS", {})
    scorer = UniversalXGBoostScorer("BTC", str(tmp_path / "missing_model.json"))

    with pytest.raises(ScoringValidationError, match="Invalid scaler stats"):
        scorer.score(zero_features)
