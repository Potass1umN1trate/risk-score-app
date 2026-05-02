# Feed Collector

`feed_collector` is the standalone Python worker for collecting external flagged-address feeds, normalizing source-native records, and eventually writing safe evidence rows to PostgreSQL. The default local path is a dummy dry-run that makes no external API calls and performs no database writes.

## Default Dummy Dry-Run

From the repository root:

```bash
python3 feed_collector/main.py --dry-run
```

From `feed_collector/`:

```bash
python3 main.py --dry-run
```

## Local Environment Setup

Create a local developer env file from the placeholder template:

```bash
cp feed_collector/.env.example feed_collector/.env
```

Never commit `feed_collector/.env`, API keys, database URLs, or other secrets. Real `.env` files are ignored by `.gitignore`; `.env.example` is intentionally allowed so only placeholders are tracked.

The feed collector loads `feed_collector/.env` regardless of whether the CLI is started from the repository root or from `feed_collector/`. Process environment variables still override values from the file.

## Fetch Modes

The collector reports one fetch mode per source run:

- `initial`: used by dry-run and by the first non-dry-run DB run when `feed_sources.last_success_at` is `NULL`.
- `incremental`: used by repeat non-dry-run DB runs when `feed_sources.last_success_at` is set and the source supports time filtering.
- `repeat_full`: used by repeat non-dry-run DB runs when `feed_sources.last_success_at` is set but the source does not support time filtering.

Dry-run mode has no database sync state, so it always calls `fetch_initial` and reports `fetch_mode=initial`. Non-dry-run mode reads `feed_sources.last_success_at`; successful runs update that timestamp only after fetch, normalization, and database persistence complete.

Chainabuse supports incremental `fetch_since(last_success_at)` in non-dry-run repeat runs. ScamSniffer and OFAC are static/full refresh sources for now, so repeat DB runs continue to call `fetch_initial` with `fetch_mode=repeat_full`. Failed incremental fetches do not fallback to an initial fetch.

## Chainabuse Smoke Run With `.env`

To run a safe manual smoke check against Chainabuse `GET /v0/reports`:

1. Copy the example env file if needed:

   ```bash
   cp feed_collector/.env.example feed_collector/.env
   ```

2. Edit `feed_collector/.env` locally:

   ```bash
   DRY_RUN=true
   ENABLED_SOURCES=chainabuse
   DUMMY_INITIAL_LIMIT=1
   CHAINABUSE_API_KEY=<your local key>
   CHAINABUSE_PER_PAGE=1
   CHAINABUSE_INITIAL_MAX_PAGES=1
   ```

3. Run from the repository root:

   ```bash
   python3 feed_collector/main.py --dry-run
   ```

Chainabuse dry-run performs real API calls to `/v0/reports`, but it does not connect to PostgreSQL and does not write to the database.

In non-dry-run mode, Chainabuse uses `fetch_initial` for the first successful DB-backed run and `fetch_since(feed_sources.last_success_at)` for repeat runs.

Expected safe output shape:

```text
source=chainabuse fetched=<n> normalized=<n> skipped=<n> dry_run=True
```

`fetched=0` can be valid depending on the API response and configured filters.

## ScamSniffer Address Blacklist

ScamSniffer can be selected as a source without an API key:

```bash
export ENABLED_SOURCES=scamsniffer
python3 feed_collector/main.py --dry-run
```

The source reads the public GitHub raw address blacklist:

```text
https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json
```

The address blacklist does not provide reliable per-address chain metadata. The collector treats strings matching `0x` plus 40 hexadecimal characters as EVM account identifiers and intentionally expands each address to the configured project EVM networks, currently `ETH` and `BNB`.

This expansion represents wallet-owner risk across supported EVM networks. It is not proof that ScamSniffer observed malicious activity on each expanded chain. Evidence rows preserve this with `chain_scope=EVM_UNSPECIFIED_EXPANDED` and `expanded_to_network=ETH` or `BNB` in the raw payload. ScamSniffer domains are not imported by this source.

ScamSniffer does not support time filtering. Dry-run and first DB runs use `fetch_initial`; repeat DB runs use `fetch_initial` again with `fetch_mode=repeat_full`.

Optional settings:

```bash
SCAMSNIFFER_ADDRESS_BLACKLIST_URL=https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json
SCAMSNIFFER_TIMEOUT_SECONDS=10
SCAMSNIFFER_EVM_NETWORKS=ETH,BNB
```

Unknown EVM networks in `SCAMSNIFFER_EVM_NETWORKS` are ignored. For this project iteration only `ETH` and `BNB` are supported.

## OFAC SDN Digital Currency Addresses

OFAC can be selected as a source without an API key:

```bash
export ENABLED_SOURCES=ofac
export DRY_RUN=true
export DUMMY_INITIAL_LIMIT=10
python3 feed_collector/main.py --dry-run
```

The source uses the official OFAC Sanctions List Service file download API, not website HTML scraping:

```text
https://sanctionslistservice.ofac.treas.gov/api/download/SDN_ADVANCED.XML
```

The default file is `SDN_ADVANCED.XML`. The adapter extracts digital currency address identifiers only; it does not perform OFAC name, person, or entity screening. Every imported OFAC crypto address maps to the internal `sanctions` risk category. OFAC program tags such as `CYBER2`, `DPRK3`, or `RUSSIA-EO14024` are preserved in source evidence and `raw_payload`, not converted into internal risk categories.

OFAC digital currency address listings are official sanctions evidence but are not exhaustive. Dry-run mode still downloads the public XML file before parsing up to `DUMMY_INITIAL_LIMIT` records, so an OFAC smoke run may download a large file even when the requested limit is small.

OFAC does not support time filtering in the current adapter. Dry-run and first DB runs use `fetch_initial`; repeat DB runs use `fetch_initial` again with `fetch_mode=repeat_full`. OFAC `/changes/latest` and `/changes/history` incremental diff support is not implemented yet.

Optional settings:

```bash
OFAC_BASE_URL=https://sanctionslistservice.ofac.treas.gov
OFAC_SDN_FILENAME=SDN_ADVANCED.XML
OFAC_TIMEOUT_SECONDS=20
OFAC_USE_ALIVE_CHECK=true
```

For an intentional local live-DB smoke run, set a developer database URL explicitly:

```bash
ENABLED_SOURCES=ofac DRY_RUN=false DATABASE_URL=<dev-db-url> python3 feed_collector/main.py --no-dry-run
```

Automated tests must not use a live OFAC call or a live database. Unit tests use mocked OFAC responses only; DB integration tests use `TEST_DATABASE_URL` and skip when it is absent.

## Shell-Only Chainabuse Smoke Run

For a safer smoke check that does not store the API key in a file:

```bash
set +x
read -rsp "CHAINABUSE_API_KEY: " CHAINABUSE_API_KEY; echo
export CHAINABUSE_API_KEY
export ENABLED_SOURCES=chainabuse
export DUMMY_INITIAL_LIMIT=1
export CHAINABUSE_PER_PAGE=1
export CHAINABUSE_INITIAL_MAX_PAGES=1
python3 feed_collector/main.py --dry-run
unset CHAINABUSE_API_KEY
```

Do not enable shell tracing while handling secrets. The collector does not print `CHAINABUSE_API_KEY`, Authorization headers, or `DATABASE_URL`.

## Tests

Automated tests use mocks for Chainabuse, ScamSniffer, and OFAC and do not verify live Chainabuse, GitHub, or OFAC access. Do not add live API calls or require a real `CHAINABUSE_API_KEY` in tests.

## Source Selection

`ENABLED_SOURCES` currently accepts comma-separated names, but the current runtime executes only the first source in the list. For example, `ENABLED_SOURCES=chainabuse,dummy` runs `chainabuse`; `ENABLED_SOURCES=dummy,chainabuse` runs `dummy`.

`ENABLED_SOURCES=scamsniffer` runs the ScamSniffer adapter.

`ENABLED_SOURCES=ofac` runs the OFAC adapter.
