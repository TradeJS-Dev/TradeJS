# Context and AI feature ownership

This is the internal framework contract and the 2026-11-09 context audit.
Public strategy formulas, existing field names and deterministic approval rules
remain compatible. A context called `trendFollow` or `liquidityTails` is not
proof that it equals the standalone strategy's detector/configuration.

## Audit decisions

| Existing family                                                                                        | Decision and owner                                                                                                  | AI use                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `baseContext.candle`, `prevCandle`, `raw` and indicator histories                                      | Keep canonical measurements in core; raw/history are reproduction inputs, not duplicated calculators                | Normalized explicit projections; arrays require a declared reduction                                             |
| `regime.trend`, momentum, volatility, session and memory                                               | Keep strategy-neutral calculations; preserve warmup, timeframe and existing values                                  | Causal measurements; policy scores distinguished from observations                                               |
| `structure.swing`, pivots, local ranges, acceptance and candle quality                                 | Keep shared geometry; do not turn generic pivots into a specific pattern's confirmed pivots                         | Full search can inspect primitives; compact omissions are reported; registered features bypass compact omissions |
| `structure.zones`, `srZones`, `liquidityZones`, `liquidityTails`, `structureZones`                     | Keep shared algorithms because unrelated strategies use these observations; preserve lazy calculation               | Register array-to-feature geometry in the consuming strategy; never infer absence from a compact export          |
| Pattern legs/necklines, consumed/pending lifecycle, invalidation and strategy-specific gate thresholds | Owned by standalone strategy; do not add to mandatory baseContext                                                   | `StrategyManifest.aiFeatures` exposes setup measurements through the common pipeline                             |
| Participation volume, delta, volume profile and trade flow                                             | Keep common measurements; distinguish exact exchange data from candle estimates                                     | Relative/normalized values; provider freshness is quality metadata                                               |
| Relative BTC/ETH, market breadth and CMC                                                               | Keep target/benchmark/global scopes explicit; reuse one BTC/ETH AI normalization path                               | ETH projection added; coverage is not approval evidence                                                          |
| Derivatives and reference contexts                                                                     | Preserve existing benchmark/target contracts and optional availability                                              | Missing data blocks/marks unknown; never substitutes a neutral market state                                      |
| Multi-timeframe context                                                                                | Keep common timestamp-aligned calculations                                                                          | Closed higher timeframe candles only; no future completed HTF bar                                                |
| `baseContext.gateFeatures` scores and decision hints                                                   | Preserve legacy semantics for existing adapters; new policy decisions belong in strategy adapters, not measurements | Existing heuristic exclusions stay; explicit `policy` role is never a discovery input                            |
| `additionalIndicators.marketContext`                                                                   | An AI presentation of canonical context, not an independent data source                                             | Compact search excludes the duplicate; BTC/ETH presentation uses one shared normalizer                           |
| Indicator plugin values                                                                                | Keep existing scoped plugin registry; add optional `aiFeatures` on enabled entries                                  | Same schema and projection as strategy features                                                                  |
| Monthly ticker profile                                                                                 | Core computes, infra stores, CLI prepares, node attaches                                                            | Values/groups are inputs; provenance and coverage have separate roles                                            |

No field was deleted solely because the current gates do not read it. No common
zone engine was copied into a single strategy. Replacing an established formula
or moving a public path requires a separately versioned migration and frozen-gate
revalidation, not renaming under an old fingerprint.

## Monthly ticker profiles

Prepare from Project using the built/installed CLI:

```sh
tradejs ticker-profiles --provider bybit --universeId usdt-20261109 \
  --symbolsFile symbols-usdt.json \
  --startTime 1790812800000 --endTime 1793491200000
```

`symbolsFile` is an explicit unique JSON array including BTCUSDT and ETHUSDT.
Only USDT contracts are accepted. The command reads cached hourly candles and
never refreshes exchange history. It freezes one monthly snapshot, including
all universe members, unknown values, common tercile thresholds and definition.
The current command labels membership `frozen-list`; it does not claim a
point-in-time historical listing universe or infer listing dates from first data.

Definition `hourly-30d-monthly-terciles/v1`:

- Monthly UTC membership, previous 720 closed hours; minimum 576 hours/returns.
- Daily turnover: exact quote turnover when available, otherwise HLC/3 times
  base volume. Source `quote`/`estimated`/`mixed` is explicit. It is not book depth.
- Daily volatility: sample standard deviation of contiguous hourly log returns
  multiplied by sqrt(24), in percent; gaps never bridge returns.
- BTC/ETH Pearson correlation: at least 576 aligned hourly returns. Constant
  series and insufficient coverage remain unknown.
- Money/volatility groups: common universe terciles. Correlation groups:
  weak <0.3, medium [0.3,0.7), strong >=0.7. Thresholds are not fitted to PnL.

Snapshots live under `data/market/ticker-profiles/<provider>/<universeId>/`.
They are shared market data, not disposable research exports. Atomic publication
and SHA-256 protect them; conflicting writes fail. Use a new universe ID for a
revised membership/history snapshot. Do not silently overwrite research inputs.

Signals carry the profile in `additionalIndicators.tickerProfile`; adding a
profile never manufactures a baseContext for strategies without one. A required
core profile lives in `baseContext.tickerProfile` before the core decision. Both
paths feed the same registered feature projection.

For signal/gate context, set both `TICKER_PROFILES_PROVIDER` and
`TICKER_PROFILES_UNIVERSE`. They identify the explicit measurement venue, not an
inferred execution venue. A strategy requiring the profile before core decisions
instead declares:

```ts
contextRequirements: {
  tickerProfiles: { provider: 'bybit', universeId: 'usdt-20261109' },
}
```

Core requirements fail if the month/symbol is absent. Optional gate enrichment
leaves absent data absent. Prior months are never carried into a new month.
Successful snapshots are immutable and cached by project/provider/universe/month;
misses retry after 60 seconds; the cache is bounded to 24 months. No filesystem
read or profile calculation is performed per candle for existing strategies that
have not requested profiles. Preparing profiles does not enable a trading filter.
For backtest dataset generation, request `--ai` as well as the profile source.
Plain `--fast` without AI/ML export does not run optional signal enrichment;
benchmarking environment variables alone does not measure profile overhead.
A manifest's required core profile is loaded independently of dataset export.

## Explicit AI features

`@tradejs/core/aiFeatures` exports `projectAiFeatures`, validation and the default
profile definitions. `@tradejs/types` owns `AiFeatureDefinition` and the versioned
snapshot. Strategies declare `StrategyManifest.aiFeatures`; indicator plugins
can declare `IndicatorPluginEntry.aiFeatures`. IDs must be unique across both.

```ts
aiFeatures: [
  {
    id: 'myStrategy.confirmedSwingAtr',
    version: 1,
    source: 'signal',
    path: 'additionalIndicators.setup.confirmedSwings',
    reduction: 'max',
    divideBy: 'additionalIndicators.setup.atr',
    role: 'input',
    stationary: true,
    scope: 'setup',
    unit: 'ATR',
    description: 'Largest confirmed swing at the decision, normalized by ATR',
  },
];
```

`source: signal` reads the original signal before prompt array truncation;
`source: payload` (default) reads the adapter's final payload, including its
computed setup features. Reductions are explicit: last, mean, min, max, count.
A count must describe a real market/setup event to be an input; dataset coverage
counts are `data-quality`. Unsupported arrays/missing inputs yield null, not zero.
Ratios with zero/missing denominators also yield null. Do not use post-entry MFE,
MAE, future pivots or realized fills as entry features.

Roles: `input`, `data-quality`, `metadata`, `outcome`, `policy`. Only inputs enter
pocket discovery. The causal-stationary policy additionally requires
`stationary: true`. Raw turnover remains available for explicit nonstationary
research, but monthly groups are the stationary default. Missing/unknown values
are not discovery predicates. Outcome/policy and coverage fields remain auditable.

`AiPayload.featureSnapshot` stores definitions and decision-time values. The
native AI export/reconstruction path preserves this snapshot, including array
reductions that cannot be recovered from a trimmed prompt. A changed definition
requires a fresh decision-time export: replay rejects silent substitution.
A legacy dataset without a feature snapshot is rejected when new definitions are
active; it cannot supply original arrays from the shortened prompt. Legacy gates
without registered definitions continue to accept their existing exports.
Registered discovery names are `registered.<id>`; runtime adapters read
`payload.featureSnapshot.values[id]`. Include schema/definitions and source
snapshot IDs when freezing a gate research lineage.

Legacy primitive discovery remains available through `--featureProfile all`.
Compact filtering, unprojected arrays, depth limits and operator exclusions are
reported explicitly. Register an explicit projection to make a deep/array field
available in compact searches; do not remove leakage protection globally.
Ticker profile branches use only their registered definitions, preventing their
sample counts/timestamps from leaking through legacy name heuristics.

## Required checks for every new feature

1. Document ownership, unit, scope, source, availability time and version.
2. Prove future candles cannot change the past feature; cover warmup/gaps.
3. Round-trip the signal through export and native gate reconstruction.
4. Assert intended features appear in pocket search; metadata/outcomes do not.
5. Preserve old strategy results and compare matched cache-only backtests when
   touching hot paths. Measure preparation separately from steady-state cost.
6. Update definitions and instructions together. Never use a source rename to
   bypass eligibility policy. Do not treat a successful full-history pocket as
   independent validation.

## Module responsibilities

- `core/tickerProfiles`: deterministic candle-to-profile calculation and schema
  validation, with no storage, environment or registry access.
- `infra/tickerProfiles`: atomic immutable publication and checksum verification;
  the reader returns untrusted data for domain validation.
- `node/strategyHelpers/tickerProfiles`: source resolution, bounded snapshot cache
  and descriptor-preserving attachment for required core context. Signal
  enrichment adds an independent profile without changing baseContext availability. Optional enrichment and required core data have explicit
  missing-data behavior.
- `core/aiFeatures`: pure feature projection and validation, shared by strategy
  and indicator declarations. Export/replay freezes values before prompt trimming.
- CLI preparation coordinates cached history reads and publication; pocket search
  owns eligibility policy. Neither computes a second version of the feature.

Generate the static field inventory with
`node bin/audit-context-schema.mjs --out <report.json>`. It expands public types,
including inherited fields, and marks arrays requiring explicit projections.
This inventory does not establish runtime usage or causal eligibility by itself.

## Portfolio state

`additionalIndicators.portfolioContext` belongs to the shared execution runtime,
not a strategy detector or `baseContext`. See `PORTFOLIO_POLICIES.md` for its
clock, ownership and fixed-R semantics. Register only pre-admission measurements
as input features. Preserve missing values, frozen snapshots and metadata roles
through export/reconstruction; never derive context from completed outcomes.
Portfolio-dependent gate changes require chronological shared replay because
admission changes the later portfolio state.

## Bybit reference markets

`signal.additionalIndicators.referenceMarkets` contains closed 15m, 1h and 4h
measurements from the Bybit mainnet USDT reference contracts. These are
benchmarks independent of the strategy's traded symbols or execution venue.

- The fixed v1 universe contains 15 stock contracts, WTI (`CLUSDT`), gold
  (`XAUUSDT`), silver (`XAGUSDT`), and BTC, ETH and SOL USDT perps.
- `frames.m15`, `frames.h1` and `frames.h4` use the expected UTC close at or
  before the signal timestamp. `returnsPct` stores per-symbol log returns
  multiplied by 100. A return requires two adjacent candles. Missing bars,
  including periods before listing, yield no return. The baskets require every
  member and are equally weighted. The growth minus defensive and gold minus
  growth spreads require both legs.
- `nyCashHoursGrowthPct` also requires each stock to have positive volume in
  both candles and the newer candle to fit entirely inside 09:30–16:00 New
  York weekday time. This applies DST and uses those clock hours as a proxy
  for the cash session. It does not model holidays or early-close schedules.
- Signals and replay warm the standard candle cache automatically when refresh
  is allowed. Backtest dataset runs (`--ai`) warm the same reference history.
  `--cacheOnly` only reads Timescale. When some reference data is available,
  absent values are null in the feature snapshot. With no reference data, the
  signal has no reference context. Set
  `TRADEJS_REFERENCE_MARKETS=false` to disable new loading and enrichment.
- Runtime gates and entry hooks can read the named signal fields; for example,
  `signal.additionalIndicators?.referenceMarkets?.frames.h1?.growthPct`.
  The native export freezes `registered.referenceMarkets.h1.growthPct` and
  the corresponding per-contract, basket and spread features for all three
  intervals. `closedAt` stays provenance. The default LLM prompt keeps its
  existing inputs. A gate that wants the new features needs a fresh export.
- `baseContext.regime.momentum.roc4h`,
  `baseContext.participation.volume.turnoverRel20`, and
  `baseContext.structure.acceptance.failedAcceptanceBars` retain their
  formulas and are available in compact causal pocket searches. Strategy
  thresholds and entry rules remain in the consuming gate or strategy.

## Macro news

Import a versioned JSON archive using `tradejs news:import <archive.json>`.
`NewsArchive` in `@tradejs/types` defines the format. Each event records the
source URL, provider, local event date, precision, revision, and UTC epoch
milliseconds of publication, scheduling and availability. Calendar notices
and final releases are different revisions of the same event. Corrections and
cancellations require new revisions. Importing identical records is idempotent.
Importing conflicting revisions rolls back the batch. Coverage intervals
describe when a provider feed was covered, including days with no events.

For strategy decisions, declare `contextRequirements.core: ['news']` and
read `(await strategyApi.getDecisionBaseContext())?.news`. For signal and
`--ai` dataset enrichment, enable `NEWS_CONTEXT_ENABLED=true`. Both paths
resolve the same archive at the closing time of the evaluated strategy candle.
Archives are imported separately from replay. `news.status` reports full,
partial or unavailable coverage. Context status and document provenance stay
outside pocket discovery. Existing strategies can opt in independently.

Timing fields and reaction use the closest eligible events. Clock-unknown
events remain useful as a local calendar-day marker. The measured reaction
uses the last M15 close at or before release and the first fully post-release
M15 close, after that candle is closed. The benchmark is Bybit BTCUSDT.
Breadth is the positive-return share of Bybit BTC, ETH, SOL, BNB and XRP USDT
contracts, with all five required. Asset-relative reaction is the asset return
minus BTC in percentage points. Typed surprises require the original reported
figure and a consensus known before release. Unknown features are null.

Research exports freeze the versioned `registered.news.*` features for
reconstruction. A historical schedule marked `reconstructed` is approximate.
Keep that distinction when comparing to observed collection. This import
workflow can be fed by a separate collector. Schema preparation never fetches
or fabricates event history.

### Recent publications and trader opinions

`tradejs news:sync` reads official press releases from the Federal Reserve, ECB, Bank of England and BEA, plus Bybit exchange announcements. Pass `--social` to include X timelines and selected Reddit listings. `--official-only`
runs the public feeds. `--preview` prints a short excerpt for human review.
`--dry-run` still calls the feeds and skips writing to Timescale. The command
reports availability for each account or feed. A successful recent-page poll
does not assert historical coverage.

Supply `NEWS_X_BEARER_TOKEN` for an X developer project with user lookup and
timeline reads enabled. For Reddit, supply an existing approved OAuth access
token in `NEWS_REDDIT_ACCESS_TOKEN` and a descriptive
`NEWS_REDDIT_USER_AGENT`. The sync command does not request consent or renew
tokens. Each connector reads recent public posts with its official API.

Use `--watchlist <file.json>` to override the starter list. Example:

```json
{
  "x": ["LynAldenContact", "CryptoHayes", "VitalikButerin"],
  "redditUsers": ["vbuterin"],
  "redditCommunities": ["BitcoinMarkets"]
}
```

The first two entries on X provide macro and crypto trading perspectives.
The third and the matching Reddit username provide Ethereum protocol context.
The community feed is a source of discussion. It does not confer authority on
individual members. Reddit user feeds include authored submissions and comments.
An account on the watchlist is identified by its handle and the platform author
ID when available. Popularity and engagement are not input features.

`BaseContext.news.publications` contains up to 30 of the latest publications
within 24 hours. Timescale preserves platform publication time and the first
time TradeJS collected the item. A later poll does not backdate or duplicate
an item. Social records retain the permalink, author, source, mentioned symbols
and explicitly stated stance when recognized. Social excerpts are transient.
The parser recognizes unambiguous first-person bullish or bearish statements
about BTC, ETH or SOL. Other opinions remain available as attributed links with
an unknown stance. Publication metadata is kept outside macro reaction
features and pocket discovery.
