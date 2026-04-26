"""
Rule-based human-readable factors for analysis results.

These factors explain visible DB and feature signals. They do not inspect
XGBoost internals and are not SHAP/model-attribution explanations.
"""

from __future__ import annotations

from app.graph.features import AddressFeatures, FLAG_CATEGORIES
from app.scoring.base import ScoreResult


Factor = dict[str, object]

_CATEGORY_LABELS = {
    "sanctions": "Sanctions exposure",
    "mixer": "Mixer exposure",
    "scam": "Scam exposure",
    "darknet_market": "Darknet market exposure",
    "ransomware": "Ransomware exposure",
    "gambling": "Gambling exposure",
    "phishing": "Phishing exposure",
    "suspicious": "Suspicious-address exposure",
}

_CATEGORY_SEVERITY = {
    "sanctions": "HIGH",
    "darknet_market": "HIGH",
    "ransomware": "HIGH",
    "mixer": "MEDIUM",
    "scam": "MEDIUM",
    "phishing": "MEDIUM",
    "gambling": "LOW",
    "suspicious": "LOW",
}


def _factor(
    key: str,
    label: str,
    value: object,
    severity: str,
    description: str,
) -> Factor:
    return {
        "key": key,
        "label": label,
        "value": value,
        "severity": severity,
        "description": description,
    }


def _severity_for_ratio(ratio: float) -> str:
    if ratio >= 0.25:
        return "HIGH"
    if ratio >= 0.10:
        return "MEDIUM"
    return "LOW"


def _severity_for_distance(distance: int) -> str:
    if distance <= 1:
        return "HIGH"
    if distance == 2:
        return "MEDIUM"
    return "LOW"


def _severity_for_tx_frequency(tx_per_day: float) -> str:
    if tx_per_day > 100:
        return "HIGH"
    if tx_per_day > 50:
        return "MEDIUM"
    return "LOW"


def _severity_for_counterparties(count: int) -> str:
    if count >= 100:
        return "HIGH"
    if count >= 50:
        return "MEDIUM"
    return "LOW"


def _severity_for_volume(amount: float) -> str:
    if amount >= 1000:
        return "HIGH"
    if amount >= 100:
        return "MEDIUM"
    return "LOW"


def build_factors(
    features: AddressFeatures | None,
    flagged: dict[str, list[str]],
    root_flag: dict | None,
    score_result: ScoreResult,
) -> list[Factor]:
    """
    Build structured human-readable factors from DB flags and computed features.

    The output is intentionally rule-based and deterministic. It is suitable for
    API responses and storage in analysis_results.factors_json["factors"].
    """
    factors: list[Factor] = []

    if root_flag is not None:
        flag_type = root_flag["flag_type"]
        factors.append(_factor(
            key="root_address_flagged",
            label="Root address is flagged",
            value=flag_type,
            severity=score_result.risk_level,
            description=(
                "The analyzed address is directly present in the flagged-address "
                f"database with category '{flag_type}'."
            ),
        ))

    if features is None:
        return factors

    if features.flagged_neighbors_count > 0:
        factors.append(_factor(
            key="flagged_neighbors_present",
            label="Flagged neighbors found",
            value={
                "count": features.flagged_neighbors_count,
                "addresses": sorted(flagged.keys())[:10],
            },
            severity="HIGH" if features.flagged_neighbors_count >= 3 else "MEDIUM",
            description=(
                "One or more addresses in the transaction graph are present in "
                "the flagged-address database."
            ),
        ))

    if 1 <= features.min_dist_to_flagged <= 3:
        factors.append(_factor(
            key="low_distance_to_flagged_address",
            label="Near flagged address",
            value=features.min_dist_to_flagged,
            severity=_severity_for_distance(features.min_dist_to_flagged),
            description=(
                "The transaction graph contains a flagged address within a short "
                "path distance from the analyzed address."
            ),
        ))

    if features.flagged_neighbors_ratio >= 0.10:
        factors.append(_factor(
            key="elevated_flagged_neighbor_ratio",
            label="Elevated flagged-neighbor ratio",
            value=features.flagged_neighbors_ratio,
            severity=_severity_for_ratio(features.flagged_neighbors_ratio),
            description=(
                "A notable share of addresses in the graph are flagged, which "
                "increases the environmental risk signal."
            ),
        ))

    for category in FLAG_CATEGORIES:
        count = getattr(features, f"flag_{category}")
        if count > 0:
            factors.append(_factor(
                key=f"category_{category}_present",
                label=_CATEGORY_LABELS[category],
                value=count,
                severity=_CATEGORY_SEVERITY[category],
                description=(
                    f"The graph contains {count} address(es) flagged as "
                    f"'{category}'."
                ),
            ))

    if features.tx_per_day > 20:
        factors.append(_factor(
            key="high_transaction_frequency",
            label="High transaction frequency",
            value=features.tx_per_day,
            severity=_severity_for_tx_frequency(features.tx_per_day),
            description=(
                "The analyzed address shows an elevated average number of "
                "transactions per active day."
            ),
        ))

    if features.unique_counterparties >= 20:
        factors.append(_factor(
            key="high_unique_counterparties",
            label="Many unique counterparties",
            value=features.unique_counterparties,
            severity=_severity_for_counterparties(features.unique_counterparties),
            description=(
                "The analyzed address interacted with many distinct counterparties "
                "within the analyzed graph."
            ),
        ))

    if features.total_received >= 10:
        factors.append(_factor(
            key="high_total_received",
            label="High received volume",
            value=features.total_received,
            severity=_severity_for_volume(features.total_received),
            description="The analyzed address received a high total transaction volume.",
        ))

    if features.total_sent >= 10:
        factors.append(_factor(
            key="high_total_sent",
            label="High sent volume",
            value=features.total_sent,
            severity=_severity_for_volume(features.total_sent),
            description="The analyzed address sent a high total transaction volume.",
        ))

    return factors
