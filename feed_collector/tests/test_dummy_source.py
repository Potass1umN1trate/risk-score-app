import pytest

from app.sources.dummy import DummySource


@pytest.mark.asyncio
async def test_source_code():
    source = DummySource()
    assert source.source_code == "dummy"


@pytest.mark.asyncio
async def test_check_availability_returns_true():
    source = DummySource()
    result = await source.check_availability()
    assert result is True


@pytest.mark.asyncio
async def test_check_availability_does_not_raise():
    source = DummySource()
    try:
        await source.check_availability()
    except Exception as exc:
        pytest.fail(f"check_availability raised unexpectedly: {exc}")


def test_supports_time_filter_is_false():
    source = DummySource()
    assert source.supports_time_filter is False


@pytest.mark.asyncio
async def test_fetch_initial_returns_three_records():
    source = DummySource()
    records = await source.fetch_initial(limit=10)
    assert len(records) == 3


@pytest.mark.asyncio
async def test_fetch_initial_respects_limit():
    source = DummySource()
    records = await source.fetch_initial(limit=1)
    assert len(records) == 1


@pytest.mark.asyncio
async def test_fetch_initial_contains_btc_record():
    source = DummySource()
    records = await source.fetch_initial(limit=10)
    btc_records = [r for r in records if r.network_code == "BTC"]
    assert len(btc_records) == 1
    assert btc_records[0].address == "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"


@pytest.mark.asyncio
async def test_fetch_initial_contains_eth_record():
    source = DummySource()
    records = await source.fetch_initial(limit=10)
    eth_records = [r for r in records if r.network_code == "ETH"]
    assert len(eth_records) == 1
    assert "742d35" in eth_records[0].address.lower()


@pytest.mark.asyncio
async def test_fetch_initial_contains_unsupported_network_record():
    source = DummySource()
    records = await source.fetch_initial(limit=10)
    fake_records = [r for r in records if r.network_code == "FAKECHAIN"]
    assert len(fake_records) == 1


@pytest.mark.asyncio
async def test_fetch_initial_all_have_risk_category_code():
    source = DummySource()
    records = await source.fetch_initial(limit=10)
    for rec in records:
        assert rec.risk_category_code, f"Missing risk_category_code on record {rec}"


@pytest.mark.asyncio
async def test_fetch_since_returns_empty_list(dummy_source):
    from datetime import datetime, timezone
    since = datetime(2026, 1, 1, tzinfo=timezone.utc)
    records = await dummy_source.fetch_since(since=since, limit=10)
    assert records == []
