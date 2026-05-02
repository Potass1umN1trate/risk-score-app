from pathlib import Path

from app.config import FeedCollectorSettings


def test_env_file_path_is_feed_collector_local_env():
    expected = Path(__file__).resolve().parents[1] / ".env"

    assert FeedCollectorSettings.model_config["env_file"] == expected


def test_process_environment_overrides_defaults(monkeypatch):
    monkeypatch.setenv("DUMMY_INITIAL_LIMIT", "7")

    settings = FeedCollectorSettings(dry_run=True)

    assert settings.dummy_initial_limit == 7


def test_process_environment_overrides_env_file_values(monkeypatch):
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    monkeypatch.setenv("DUMMY_INITIAL_LIMIT", "7")

    settings = FeedCollectorSettings(_env_file=env_example)

    assert settings.dummy_initial_limit == 7


def test_env_example_contains_parseable_placeholder_values():
    env_example = Path(__file__).resolve().parents[1] / ".env.example"

    settings = FeedCollectorSettings(_env_file=env_example)

    assert settings.dry_run is True
    assert settings.enabled_sources == "dummy"
    assert settings.dummy_initial_limit == 1
    assert settings.chainabuse_api_key is None
    assert (
        settings.scamsniffer_address_blacklist_url
        == "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json"
    )
    assert settings.scamsniffer_evm_networks == "ETH,BNB"
    assert settings.ofac_base_url == "https://sanctionslistservice.ofac.treas.gov"
    assert settings.ofac_sdn_filename == "SDN_ADVANCED.XML"
    assert settings.ofac_timeout_seconds == 20
    assert settings.ofac_use_alive_check is True


def test_blank_optional_env_values_are_treated_as_unset():
    settings = FeedCollectorSettings(
        dry_run=True,
        chainabuse_api_key="",
        chainabuse_checked="",
        chainabuse_trusted="",
        chainabuse_chain="",
        chainabuse_category="",
        chainabuse_before="",
        database_url="",
    )

    assert settings.chainabuse_api_key is None
    assert settings.chainabuse_checked is None
    assert settings.chainabuse_trusted is None
    assert settings.chainabuse_chain is None
    assert settings.chainabuse_category is None
    assert settings.chainabuse_before is None
    assert settings.database_url is None
