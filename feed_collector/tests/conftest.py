import pytest

from app.config import FeedCollectorSettings
from app.sources.dummy import DummySource


@pytest.fixture
def dummy_source() -> DummySource:
    return DummySource()


@pytest.fixture
def dry_run_settings() -> FeedCollectorSettings:
    return FeedCollectorSettings(dry_run=True, dummy_initial_limit=10)
