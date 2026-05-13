from base64 import b64encode
from datetime import datetime, timezone

import httpx
import pytest
from pydantic import ValidationError

from app.config import FeedCollectorSettings
from app.sources.chainabuse import ChainabuseSource, ChainabuseSourceError


def _settings(**overrides) -> FeedCollectorSettings:
    values = {
        "dry_run": True,
        "chainabuse_api_key": "test-api-key",
        "chainabuse_base_url": "https://api.chainabuse.com/v0",
        "chainabuse_per_page": 50,
        "chainabuse_initial_max_pages": 2,
    }
    values.update(overrides)
    return FeedCollectorSettings(**values)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _report(**overrides) -> dict:
    value = {
        "id": "report-1",
        "trusted": True,
        "checked": False,
        "scamCategory": "PHISHING",
        "createdAt": "2026-01-01T12:00:00Z",
        "addresses": [
            {
                "chain": "ETH",
                "address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                "domain": None,
            }
        ],
    }
    value.update(overrides)
    return value


def test_chainabuse_per_page_must_be_between_1_and_50():
    with pytest.raises(ValidationError):
        _settings(chainabuse_per_page=0)

    with pytest.raises(ValidationError):
        _settings(chainabuse_per_page=51)


def test_chainabuse_initial_max_pages_must_be_at_least_1():
    with pytest.raises(ValidationError):
        _settings(chainabuse_initial_max_pages=0)


@pytest.mark.asyncio
async def test_missing_api_key_makes_check_availability_false():
    source = ChainabuseSource(_settings(chainabuse_api_key=None))

    assert await source.check_availability() is False


@pytest.mark.asyncio
async def test_check_availability_returns_true_for_valid_reports_response():
    source = ChainabuseSource(
        _settings(),
        transport=_transport(
            lambda request: httpx.Response(200, json={"reports": [], "count": 0})
        ),
    )

    assert await source.check_availability() is True


@pytest.mark.asyncio
async def test_basic_auth_uses_api_key_as_username_and_blank_password():
    seen_auth: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_auth.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"reports": [], "count": 0})

    source = ChainabuseSource(_settings(), transport=_transport(handler))

    await source.fetch_initial(limit=1)

    expected = "Basic " + b64encode(b"test-api-key:").decode("ascii")
    assert seen_auth == [expected]


@pytest.mark.asyncio
async def test_fetch_initial_calls_reports_and_never_sanctioned_addresses():
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json={"reports": [], "count": 0})

    source = ChainabuseSource(_settings(), transport=_transport(handler))

    await source.fetch_initial(limit=5)

    assert paths == ["/v0/reports"]


@pytest.mark.asyncio
async def test_per_page_never_exceeds_50():
    seen_per_page: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_per_page.append(int(request.url.params["perPage"]))
        return httpx.Response(200, json={"reports": [], "count": 0})

    source = ChainabuseSource(
        _settings(chainabuse_per_page=50),
        transport=_transport(handler),
    )

    await source.fetch_initial(limit=100)

    assert seen_per_page == [50]


@pytest.mark.asyncio
async def test_pagination_walks_page_one_and_two_then_stops():
    seen_pages: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        seen_pages.append(page)
        if page == 1:
            return httpx.Response(
                200,
                json={
                    "reports": [_report(id="report-1"), _report(id="report-2")],
                    "count": 3,
                },
            )
        return httpx.Response(
            200,
            json={"reports": [_report(id="report-3")], "count": 3},
        )

    source = ChainabuseSource(
        _settings(chainabuse_per_page=2, chainabuse_initial_max_pages=5),
        transport=_transport(handler),
    )

    records = await source.fetch_initial(limit=10)

    assert seen_pages == [1, 2]
    assert [record.external_id for record in records] == [
        "report-1",
        "report-2",
        "report-3",
    ]


@pytest.mark.asyncio
async def test_fetch_initial_respects_limit():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "reports": [_report(id="report-1"), _report(id="report-2")],
                "count": 2,
            },
        )

    source = ChainabuseSource(
        _settings(chainabuse_per_page=2),
        transport=_transport(handler),
    )

    records = await source.fetch_initial(limit=1)

    assert len(records) == 1
    assert records[0].external_id == "report-1"


@pytest.mark.asyncio
async def test_fetch_since_includes_since_query_param():
    seen_since: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_since.append(request.url.params.get("since"))
        return httpx.Response(200, json={"reports": [], "count": 0})

    source = ChainabuseSource(_settings(), transport=_transport(handler))
    since = datetime(2026, 1, 1, 12, 30, tzinfo=timezone.utc)

    await source.fetch_since(since=since, limit=10)

    assert seen_since == ["2026-01-01T12:30:00Z"]


@pytest.mark.asyncio
async def test_multiple_address_entries_produce_multiple_raw_records():
    report = _report(
        addresses=[
            {"chain": "BTC", "address": "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"},
            {
                "chain": "ETH",
                "address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
            },
        ]
    )

    source = ChainabuseSource(
        _settings(),
        transport=_transport(
            lambda request: httpx.Response(
                200, json={"reports": [report], "count": 1}
            )
        ),
    )

    records = await source.fetch_initial(limit=10)

    assert len(records) == 2
    assert {record.source_chain for record in records} == {"BTC", "ETH"}


@pytest.mark.asyncio
async def test_domain_only_and_missing_address_entries_are_ignored():
    report = _report(
        addresses=[
            {"chain": "ETH", "domain": "example.test"},
            {"chain": "ETH", "address": "   "},
            {"chain": "ETH", "address": "0x742d35cc6634c0532925a3b844bc454e4438f44e"},
        ]
    )

    source = ChainabuseSource(
        _settings(),
        transport=_transport(
            lambda request: httpx.Response(
                200, json={"reports": [report], "count": 1}
            )
        ),
    )

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    assert records[0].address == "0x742d35cc6634c0532925a3b844bc454e4438f44e"


@pytest.mark.asyncio
async def test_report_fields_are_preserved_into_raw_record():
    report = _report()
    source = ChainabuseSource(
        _settings(),
        transport=_transport(
            lambda request: httpx.Response(
                200, json={"reports": [report], "count": 1}
            )
        ),
    )

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    record = records[0]
    assert record.external_id == "report-1"
    assert record.trusted is True
    assert record.checked is False
    assert record.source_category == "PHISHING"
    assert record.first_seen == datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert record.last_seen == datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert record.raw_payload == {
        "report": {
            "id": "report-1",
            "scamCategory": "PHISHING",
            "createdAt": "2026-01-01T12:00:00Z",
            "trusted": True,
            "checked": False,
        },
        "address": {
            "chain": "ETH",
            "address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
            "domain": None,
        },
    }


@pytest.mark.asyncio
async def test_missing_chain_still_creates_raw_record_for_normalizer_to_skip():
    report = _report(
        addresses=[
            {"address": "0x742d35cc6634c0532925a3b844bc454e4438f44e"},
        ]
    )
    source = ChainabuseSource(
        _settings(),
        transport=_transport(
            lambda request: httpx.Response(
                200, json={"reports": [report], "count": 1}
            )
        ),
    )

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    assert records[0].source_chain is None


@pytest.mark.asyncio
async def test_invalid_json_raises_sanitized_chainabuse_source_error():
    source = ChainabuseSource(
        _settings(),
        transport=_transport(lambda request: httpx.Response(200, content=b"nope")),
    )

    with pytest.raises(ChainabuseSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    msg = str(exc_info.value)
    assert "not valid JSON" in msg
    assert "test-api-key" not in msg


@pytest.mark.asyncio
async def test_malformed_response_raises_sanitized_chainabuse_source_error():
    source = ChainabuseSource(
        _settings(),
        transport=_transport(
            lambda request: httpx.Response(
                200, json={"reports": {"not": "a list"}, "count": 0}
            )
        ),
    )

    with pytest.raises(ChainabuseSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    msg = str(exc_info.value)
    assert "reports must be a list" in msg
    assert "test-api-key" not in msg


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [400, 403])
async def test_400_and_403_raise_sanitized_chainabuse_source_error(status_code):
    source = ChainabuseSource(
        _settings(),
        transport=_transport(lambda request: httpx.Response(status_code)),
    )

    with pytest.raises(ChainabuseSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    msg = str(exc_info.value)
    assert str(status_code) in msg
    assert "test-api-key" not in msg
