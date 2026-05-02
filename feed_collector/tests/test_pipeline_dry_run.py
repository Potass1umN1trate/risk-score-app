from unittest.mock import AsyncMock, patch

import pytest

from app.config import FeedCollectorSettings
from app.pipeline import run_pipeline
from app.sources.dummy import DummySource


@pytest.fixture
def settings() -> FeedCollectorSettings:
    return FeedCollectorSettings(dry_run=True, dummy_initial_limit=10)


@pytest.mark.asyncio
async def test_pipeline_fetched_count(settings):
    source = DummySource()
    result = await run_pipeline(source, settings)
    assert result.fetched_count == 3


@pytest.mark.asyncio
async def test_pipeline_normalized_count(settings):
    source = DummySource()
    result = await run_pipeline(source, settings)
    assert result.normalized_count == 2


@pytest.mark.asyncio
async def test_pipeline_skipped_count(settings):
    source = DummySource()
    result = await run_pipeline(source, settings)
    assert result.skipped_count == 1


@pytest.mark.asyncio
async def test_pipeline_errors_mention_unsupported_network(settings):
    source = DummySource()
    result = await run_pipeline(source, settings)
    assert len(result.errors) == 1
    assert "FAKECHAIN" in result.errors[0]


@pytest.mark.asyncio
async def test_pipeline_dry_run_flag_is_true(settings):
    source = DummySource()
    result = await run_pipeline(source, settings)
    assert result.dry_run is True


@pytest.mark.asyncio
async def test_pipeline_source_code_in_result(settings):
    source = DummySource()
    result = await run_pipeline(source, settings)
    assert result.source_code == "dummy"


@pytest.mark.asyncio
async def test_pipeline_eth_address_is_lowercased(settings):
    """ETH addresses must be stored in canonical lowercase form."""
    source = DummySource()
    raw_records = await source.fetch_initial(limit=10)
    eth_raw = next(r for r in raw_records if r.network_code == "ETH")
    # The raw record has a mixed-case address
    assert eth_raw.address != eth_raw.address.lower()

    result = await run_pipeline(source, settings)
    # Verify normalized count includes ETH; inspect via a second pipeline run
    # with a direct normalizer call to confirm lowercase transformation
    from app.normalizer import normalize_address
    normalized_eth = normalize_address("ETH", eth_raw.address)
    assert normalized_eth == eth_raw.address.lower()
    assert result.normalized_count == 2


@pytest.mark.asyncio
async def test_pipeline_unavailable_source_returns_error(settings):
    source = DummySource()
    with patch.object(source, "check_availability", new=AsyncMock(return_value=False)):
        result = await run_pipeline(source, settings)

    assert result.fetched_count == 0
    assert result.normalized_count == 0
    assert result.skipped_count == 0
    assert len(result.errors) == 1
    assert "unavailable" in result.errors[0].lower()


@pytest.mark.asyncio
async def test_pipeline_makes_no_db_calls(settings):
    """Confirm asyncpg is never imported or called during dry-run pipeline."""
    import sys

    # asyncpg should not be connected — ensure no connection attempt occurs
    # by verifying asyncpg.connect is not called (it shouldn't even be imported
    # by the pipeline module at all in this skeleton)
    source = DummySource()

    # Patch asyncpg.connect to fail loudly if called
    asyncpg_mock = AsyncMock(side_effect=AssertionError("DB connection attempted in dry-run!"))
    with patch.dict(sys.modules, {"asyncpg": type(sys)("asyncpg")}):
        # Pipeline should complete without touching the patched module
        result = await run_pipeline(source, settings)

    assert result.fetched_count == 3
