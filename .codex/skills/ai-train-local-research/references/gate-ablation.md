# AI Gate Ablation Tool

Use `scripts/ai-gate-ablation.mjs` for repeatable deterministic gate hypothesis
checks. It streams every shard in a merged export, reconstructs the current AI
payload and local gate, and evaluates causal feature expressions without using
trade outcome fields as inputs.

## Prerequisite

Keep three roots explicit:

- `PROJECT_CWD` owns datasets and reports.
- `TRADEJS_SOURCE_REPOSITORY_ROOT` is the exact Git checkout that owns the
  researched lineage: either the TradeJS framework or one standalone strategy.
- `TRADEJS_FRAMEWORK_REPOSITORY_ROOT` supplies the built `@tradejs/node` and
  `@tradejs/cli` research runtime. It is optional only when the source root is
  itself the framework checkout.

After adapter or gate changes, build the owning standalone strategy in its
source checkout. Build framework packages only in the framework checkout when
their sources changed:

```bash
cd "$TRADEJS_SOURCE_REPOSITORY_ROOT" && yarn build
cd "$TRADEJS_FRAMEWORK_REPOSITORY_ROOT" && \
  yarn workspace @tradejs/node build && \
  yarn workspace @tradejs/cli build
```

The ablation tool imports `strategyEntries` from the standalone strategy build
when the source root is a strategy. It never substitutes the Project's
published strategy package for that source lineage. `--list` is inventory-only
and does not require either source root.

`yarn ai-train --localOnly --json -n 0` remains the baseline authority. Before
interpreting a candidate, compare the tool's baseline qN+ support, PnL, PF,
max drawdown, strict loss, and loss streak with the matching `ai-train` run.

### Explicit frozen runtime and strategy artifact

Use `--runtimeCheckpoint <json>` only with an immutable Project runtime
checkpoint. It verifies each declared installed package's name, version,
package JSON SHA256 and complete dist SHA256, then imports Project AI,
registry and pocket modules. Required framework packages share the declared
generation. Source roots still name their exact Git checkouts; canonical dist
freshness is not the authority in this explicit mode. Cross-strategy mode can
use the same runtime resolver but cannot use a strategy artifact authority.
When the checkpoint declares `projectTracked`, every checksum is mandatory:
only `package.json`, `yarn.lock` and `tradejs.config.ts` are allowed. Paths must
remain inside Project after realpath resolution. Verified hashes are included
in `run.executionRuntime.projectTracked`; a changed declaration blocks execution
before any export read. Generic fixture checkpoints may omit this optional map.

A standalone source requires `--strategyArtifactAuthority <json>` as well:

```json
{
  "schema": "tradejs-strategy-artifact-authority/v1",
  "sourceRepositoryRoot": "/absolute/exact/strategy-worktree",
  "sourceGitSha": "<40-character frozen baseline HEAD>",
  "sourceDiff": { "path": "source.patch", "sha256": "<sha256>" },
  "buildReceipt": {
    "path": "source-dependency-overlay.json",
    "sha256": "<sha256>"
  },
  "packageRoot": "compiled-package",
  "packageJsonSha256": "<sha256>",
  "distSha256": "<sha256>",
  "runtimeCheckpoint": {
    "path": "runtime-checkpoint.json",
    "sha256": "<sha256>"
  }
}
```

Relative paths resolve from their authority/checkpoint JSON. Every evidence
path and compiled package must remain inside Project after realpath resolution;
the source checkout is separately verified as the exact Git root. Source HEAD
must match the frozen baseline. The historical patch checksum is verified,
but the current worktree dirty diff is deliberately not compared with that
historical patch. The target package name must match the baseline source.

The build receipt must use
`tradejs-source-development-dependency-overlay/v1`, identify the exact source
root, have `status=passed` and `restored=true`, and bind the same dist checksum.
Its Core/Types/Kit dependency checks must match the execution checkpoint.
Never fabricate this receipt for an installed baseline; build and freeze the
exact baseline under the fixed dependencies first. Compiled artifacts cannot
be the installed Project strategy package or use worktree/foreign dependencies.
All compiled external imports must resolve to verified Project packages.

Dist hashing uses binary lexical `.sort()` of complete file paths, then SHA256
of concatenated `SHA256(file bytes) + " " + relative path + "\n"` lines.
Symlinks inside dist are rejected. This is the runtime checkpoint's declared
`SHA256 of sorted SHA256(relativefilebytes) space relativepath newline`
algorithm. Runtime and strategy authorities are validated before reading any
export. `run.executionRuntime` and `run.strategyArtifact` separately record
execution packages and historical source/build/compiled identity. These are
execution controls, not candidate rules or permission to open a sealed tail.

## Dataset Discovery

List all merged groups or only one strategy:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --list
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --list --strategy LiquidityTails
```

`--strategy` selects the latest matching merge. `--file` accepts any shard and
automatically resolves all sibling shards with the same strategy token and
merge id.

## Variants

### Fixed market-regime diagnosis

`--regimeStudy <json>` adds retrospective explanatory cohorts **after** the
named streams have frozen their approvals and capacity. It never reranks a
regime slice or searches thresholds. Use the existing `--spec` for raw-core
pass-through and the exact frozen gate. The study JSON specifies `streams`,
`periods` (`id`, epoch-ms `start`/`end`), and `dimensions` (`id`, causal feature
`path`, `scope`, `units`, plus sorted numeric `edges` or explicit `categories`).
Optional `comparePeriods` pairs decompose expectancy change into market-mix
and within-regime changes. These are descriptive associations, not causal proof.
Numeric bins are half-open; missing/null/invalid inputs get an explicit missing
bucket. Period membership uses decision time; economic cohorts sort completed
outcomes by actual exit. Monthly direction/mix and exit-reason/cost summaries
are included. Gross PnL already contains modeled slippage: fees are subtracted
once and slippage is reported separately. No live fill or prospective claim.
Run `node --test scripts/market-regime-diagnostics.test.mjs` for this contour.

Optional `snapshotAudits` (`id`, original payload `path`) diagnoses saved
numeric setup values separately as missing/null/zero/positive/negative/invalid.
These data-quality cells never enter regime predicates or gate approvals.

Use `scripts/symbol-mix-diagnostics.mjs <frozen-report.json> <regime-spec.json>
<output.json>` for a common-symbol panel from the already saved approval trace.
It retains all common symbols and a separate count-only five-trades-per-period
sensitivity panel, separates later symbols absent from the earlier trace, and
decomposes mean-PnL change into symbol mix and within-symbol effects. Absence
from a trace is not a listing date. Output binds the input/spec SHA256. It
reports economic summaries only, without pretending decision traces establish
exit-ordered risk. Run its adjacent `symbol-mix-diagnostics.test.mjs` tests.

For a formatted completed-trade contract, pass `economicBasis: 'realized'` to
`formatGateComparisonContract`. It uses realized outcome/risk/partitions and
directional economics while preserving decision-time cadence/events/capacity.
Partially overlapping positive q(N+1)+ subsets require their own realized
evidence and fail closed instead of borrowing qN+ risk. Default decision basis
is preserved for existing callers.

Pass each hypothesis as:

```text
name::mode[@quality][LONG|SHORT]::expression
```

Modes:

- `filter`: keep current qN+ approvals that match the expression.
- `exclude`: keep current qN+ approvals that do not match the expression.
- `add`: keep baseline approvals and add matching rejected rows at the optional
  assigned quality.
- `replace`: ignore the current gate and approve only matching rows at the
  optional assigned quality.

Append `[LONG]` or `[SHORT]` to scope a variant to one direction. Rows from the
other direction retain the current gate decision. Use this for release
side-rescue studies instead of encoding direction through an unrelated feature.
Use the literal expression `true` for an explicit direction-scoped pass-through.
For a single replacement policy with different rules per side, use the causal
metadata feature `derived.direction` in the expression.

When `@quality` is omitted, `add` and `replace` use `--minQuality`.

Example:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs \
  --file data/ai/export/ai-dataset-liquiditytails-merged-1784296244106-part1.jsonl \
  --variant 'near-ma-and-zone::filter::additionalIndicators.baseContext.regime.trend.priceDistanceToMaSlowAtr <= 1.2 && additionalIndicators.baseContext.structure.liquidityZones.activeCount >= 1' \
  --featurePattern 'priceDistanceToMaSlowAtr|liquidityZones.activeCount' \
  --validationSplit 0 \
  --testSplit 0.4 \
  --output data/ai/output/liquiditytails-near-ma-and-zone.md
```

Direction-aware repair example:

```text
short-rescue::add@4[SHORT]::additionalIndicators.baseContext.structure.zones.resistance.ageBars <= 42
short-pass-through::add@4[SHORT]::true
direction-aware::replace@4::(derived.direction == LONG && derived.stopDistanceBps <= 465) || (derived.direction == SHORT && structure.pivots.barsSinceSwingHigh <= 47)
```

Repeat `--variant` to compare several rules in one dataset pass. For a reusable
set, pass `--spec path/to/variants.json`:

```json
{
  "variants": [
    {
      "name": "body-065",
      "mode": "filter",
      "expression": "additionalIndicators.baseContext.regime.momentum.bodyStrength >= 0.65"
    },
    {
      "name": "q3-recovery",
      "mode": "add",
      "quality": 4,
      "expression": "additionalIndicators.liquidityTailsContext.oldP2CorrelationDirection == LONG"
    }
  ]
}
```

JSON reports include timestamp-grouped cumulative `equity` arrays for the
current-gate baseline and every variant. Use these checksum-bound arrays for
final-composition charts instead of reconstructing curves by hand.

JSON reports also include `approvedSignals` for the baseline and every variant
at `run.minQuality`. Each entry records the source row `sequence`, `signalId`,
timestamp, symbol, direction, and profit. The trace uses the same selector as
the metrics, after the common half-open window, direction rule, placebo, and
optional capacity limit. Use these identities to join approval decisions to
the frozen export for loss localization and overlapping-position analysis.
Do not reconstruct a second gate or infer individual approvals from equity
points. The trace describes historical gate decisions, not submitted or filled
runtime orders.

For a deterministic timestamp-local portfolio limit, a JSON spec variant may
also define `selection`. The tool first evaluates the gate, then keeps the
highest-ranked rows independently inside each decision timestamp. Missing rank
values sort last; symbol and source sequence are stable tie-breakers.

```json
{
  "name": "capacity-five",
  "mode": "replace",
  "quality": 4,
  "expression": "derived.direction == SHORT && feature.margin >= 0",
  "selection": {
    "capacity": 5,
    "rankBy": [
      { "path": "feature.margin", "order": "desc" },
      {
        "path": "additionalIndicators.volumeDivergenceSetup.reclaimPct",
        "order": "desc"
      }
    ]
  }
}
```

Treat every rank path like an approval feature: it must be causal, available at
decision time, stationary enough for the intended use, and documented with its
scope and environment dependencies. Capacity ranking is not permission to use
outcome, current-gate output, or data-availability fields.

A JSON spec can also define an event-count-preserving timestamp-rotation
placebo. Its own expression defines eligible rows. Inside each train, tuning,
and test partition, the referenced variant's approved event timestamps are
shifted through the eligible timestamp sequence. Trade outcomes are never read
while constructing the shift.

```json
{
  "name": "rotated-placebo",
  "mode": "replace",
  "quality": 4,
  "expression": "derived.direction == SHORT",
  "placebo": {
    "type": "timestamp-rotation",
    "referenceVariant": "frozen-gate",
    "offsetEvents": 37
  }
}
```

## Expression Grammar

Expressions support parentheses, `&&`, `||`, and comparisons:

```text
<=  >=  <  >  ==  !=
```

Values can be numbers, booleans, `null`, quoted strings, or unquoted enum-like
strings such as `LONG`, `high`, and `aligned`. Missing features never match a
predicate, including `!=`; test availability separately through the feature
inventory instead of treating missing data as approval evidence.

The shared pocket feature collector also exposes causal signal-risk distances
computed from the requested signal prices:

- `derived.stopDistanceBps`
- `derived.takeProfitDistanceBps`

Both are absolute distances from `signal.prices.currentPrice` in basis points.
They describe the signal-time order plan and do not use execution or outcome
fields.

Use `--featurePattern '<regex>'` to print matching causal paths, availability,
ranges, and categories. Do not use `--includeGateContext` for discovery; it is
only for auditing current gate output fields.

The default is timestamp-grouped outer 60/40: `--validationSplit 0
--testSplit 0.4`. Discovery seals the last 40% by default. Search uses the whole
first 60%; three consecutive development blocks diagnose stability. Fixed-rule
ablation reports the same three blocks and opens the outer test only after the
candidate expressions are frozen. These internal blocks overlap development;
they are not independent holdouts. Do not adjust rules on the outer test.
Explicit nonzero validationSplit remains a labelled legacy option.

For direction-specific discovery use LONG or SHORT. For multiple core exports,
freeze one UTC `--testSince` boundary once and pass it to every ablation.
With no tuningSince, all earlier rows form development and tuning is empty.
Exact boundaries override ratios; use the parent development timestamp groups
to choose the shared 60/40 calendar boundary, rather than moving it per candidate.

Explicit `--windowStart` / `--windowEnd` bounds also filter original source rows
**before** payload reconstruction, deterministic gate evaluation, feature inventory
and variant matching. The loader uses the source decision timestamp and half-open
`[start, end)` membership, retaining the original cross-shard row sequence for
approval-identity comparisons. With explicit bounds, missing/invalid timestamps
are skipped before evaluation; without bounds they fail. Invalid, incomplete or
nonascending bounds fail before reading rows. JSON `sourceSelection` records read,
pre-window, at/after-end, invalid-timestamp and selected counts. A development-only
window therefore cannot evaluate reserved-tail gates or expose their features,
even though it streams the frozen full export. This does not maturity-seal labels:
selected development decisions can still have completed outcomes after its end.

Use `--windowStart <UTC> --windowEnd <UTC>` to compare candidates over the same
calendar window. The start is inclusive, and the end is exclusive. Full-period
cadence and terminal windows use these bounds instead of each export's first
and last trade. The report includes zero-trade terminal windows. Without these
options, the existing export-based window remains unchanged.

## Cross-Strategy Feasibility

Use `--crossStrategy` to test whether the latest merged export for every
available strategy contains shared LONG or SHORT approval/block pockets:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs \
  --crossStrategy \
  --validationSplit 0 \
  --testSplit 0.4 \
  --portfolioCapacity 5 \
  --output data/ai/output/cross-strategy-shared-pockets.md
```

This mode intentionally does not reconstruct current strategy gates. It reads
the causal payload snapshots saved in the exports and classifies every supported
`additionalIndicators.baseContext` primitive by provenance. It runs two
independent searches:

- `universal` — normalized target/setup state such as ATR/BPS distances,
  ratios, ranks, target-relative state, structure events, and directional
  derivatives;
- `benchmarkReference` — normalized BTC/ETH/reference/global state, including
  causal `derivatives.referenceContexts` OI changes, funding z-scores,
  liquidation imbalance/spike ratios, pressure/divergence, breadth, and CMC
  regimes.

Top-level `baseContext.derivatives` is the primary BTC benchmark. Only
`targetContext` / `targetDerived` is target derivatives evidence. Never relabel
a configured `referenceContexts.<symbol>` branch as target evidence merely
because the symbol happens to match a traded target.

The mode:

- selects the latest merge independently for each strategy;
- restricts every strategy to their common chronological overlap;
- keeps each decision timestamp wholly in global train, tuning, or held-out
  historical test;
- determines the eligible feature universe from train only, so tuning/test
  availability cannot select a feature;
- requires a feature to cover at least `--minFeatureStrategies` strategies;
- uses `--minFeatureCoverage` for the universal profile (default `0.5`) and
  `--minBenchmarkFeatureCoverage` for partial benchmark/reference history
  (default `0.1`);
- balances discovery with `--maxRowsPerStrategy` and
  `--maxRowsPerEvent` caps;
- builds each benchmark/reference snapshot by taking within-strategy consensus
  first and then consensus across strategies, so symbol fan-out cannot outvote
  other strategies;
- deduplicates benchmark/reference discovery to one timestamp-direction event,
  scores macro-average normalized LU across strategies, and applies that same
  event snapshot to every signal row during acceptance evaluation;
- searches LONG and SHORT separately for both profitable approval slices and
  losing block slices;
- normalizes search PnL by each strategy's median absolute train loss, so one
  strategy's currency scale cannot dominate;
- reports per-strategy historical-test behavior, strategy/symbol/event
  concentration, temporal stability, benchmark snapshot consistency, and five
  deterministic fixed-pocket circular-shift diagnostics that rotate whole
  strategy/timestamp outcome blocks rather than individual signal rows;
- requires a shared pocket to have support in at least 60% of the configured
  feature-strategy floor (minimum 5, capped by available strategies), with the
  expected sign in at least 60% of those strategies in every partition;
- rejects approval pockets whose maximum simultaneous batch exceeds
  `--portfolioCapacity` (default `5`) in train, tuning, or historical test, and
  applies symbol concentration checks to all three partitions;
- accepts a block hypothesis only when the blocked slice is at most 80% of the
  flow and its kept complement improves LU/event and PF in train, tuning, and
  historical test.

The report does not silently drop the disputed fields. It emits separate audit
buckets:

- `dataQuality` — `stale`, availability, coverage, points, rows, and calculation
  history. These fields can make a market feature ineligible, but never approve
  a trade or act as bearish market evidence by themselves;
- `rawNonstationary` — absolute price/OI/liquidation/volume/market-cap/notional
  levels and raw-unit slopes. They remain visible with the required causal
  transform (return, BPS/ATR distance, pct-change, ratio, share, or z-score),
  but absolute pooled thresholds are not searched;
- `derivedPolicy` — existing gate scores, risks, confirmations/conflicts, and
  decision hints. They are causal but excluded from discovery to avoid merely
  rediscovering the current hard-coded heuristic;
- `metadata` — source, provider, symbol, interval, and universe lineage.

Do not calculate rolling normalizations from the sparse export signal rows.
Such features must be produced at signal time from the full causal market
history and exported, or discovery/inference parity is broken.

## Moving-average grid study

Use the dedicated mode when an export needs a causal SMA/EMA/WMA comparison:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs \
  --strategy LiquidityTails \
  --movingAverageStudy \
  --maPeriods 5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100 \
  --validationSplit 0 \
  --testSplit 0.4 \
  --json \
  --output data/ai/output/liquiditytails-ma-grid.json
```

This mode never rolls over sparse signal rows. It loads closed candles from
Timescale for the export's provider and interval, bounded at each signal
timestamp, and calculates:

- SMA, finite-history EMA, and WMA for every requested period;
- direction-normalized price distance in ATR units;
- direction-normalized five-bar average slope in ATR units;
- current-gate filters for direction-side and direction-side-plus-slope;
- a standalone side-plus-slope negative/control comparison.

`--maLookbackBars` controls the finite EMA history (default `600`). The JSON
report includes the residual decay at the longest requested period and parity
against exported SMA14/49/50. Do not interpret the study when candle coverage
or parity is incomplete. Candidate ranking uses train and tuning only; the
timestamp-grouped test tail is reported after selection and remains exposed
historical evidence after the first run.

`--crossStrategy` requires positive `--testSplit` and non-negative `--validationSplit` (standard: 0 and 0.4).
Opening the historical test tail makes it exposed evidence. Re-running the tool
on the same cutoff does not make it untouched again. Every candidate remains
research-only until the exact frozen rule survives timestamps strictly after
the report cutoff and live-env lineage validation. The five shifts are
fixed-pocket diagnostics, not a family-wise permutation test. Cross-strategy LU
metrics are discovery units, not qN+ gate metrics or production PnL.

## Report Contract

Every report contains:

- baseline and candidate tables for full history, `180d`, `90d`, `30d`, `7d`;
- q3+/q4+/q5+ summaries, configurable with `--qualityThresholds`;
- timestamp-grouped outer development/test split (60/40 by default), with three temporal stability blocks inside development;
- direction and monthly stability;
- matched, removed, and added slices;
- PnL, winrate, PF, Sharpe, Sortino, Calmar, max drawdown, DD ratios, strict
  loss, max loss streak, losing months, cadence, and symbol concentration.
- decision-event cadence, active-day share, trades per event, p95/max batch,
  top-event concentration, and capacity stress at caps `1,3,5`.

The JSON report also carries average trade, payoff ratio, recovery factor,
ulcer index, profit per day/month, cadence per week, and risk-adjusted ratios.
Use `--json` or an `.json` output path when downstream analysis needs those
fields.

Use `--maxLossValue` to turn batch capacity into maximum simultaneous stop-risk
only after resolving the historical effective `MAX_LOSS_VALUE` for the
backtest that produced the export. Prefer a config snapshot embedded in the
export or the archived checkpoint addressed by `backtestRunId` and
`backtestTestKey`. The current named Redis config, current strategy default,
and current production value are not valid substitutes without matching
lineage. Omit `--maxLossValue` and report stop-risk as `n/a` when the historical
value is unavailable. Set `--capacities` when the intended portfolio cap is
known; otherwise keep the default `1,3,5` stress grid. Timestamp groups are
never split between train/tuning/test.

## Maintenance Rule

### Calendar equity stability diagnostics

Use `scripts/equity-stability.mjs --input <ablation.json> --output <new.json>`
for calendar-weighted diagnostics from checksum-bound `realized.equity`.
It does not reconstruct approvals or recompute trade outcomes. It holds the
recorded closed-trade equity constant between observations, including inactive
time, and reports calendar ulcer index, underwater share, maximum continuous
underwater duration and maximum peak-to-recovery duration. Unrecovered terminal
episodes are included and explicitly right-censored. These are closed-trade
diagnostics, not intratrade or capital-return measures. Full-period diagnostics
must not be used to tune rules on a previously reserved historical tail.
The existing `ulcerIndex` remains trade-observation weighted and unchanged.
Run `node --test scripts/equity-stability.test.mjs` after changes.

### Optional monthly funnel and named-policy comparison

Use `--monthlyCohorts --cohortPath <payload.path>` with explicit comparison
window bounds to retain a generic UTC calendar-month funnel. Each month has
source-export and selected-gate summaries for ALL, LONG, SHORT and observed
payload cohorts, including zero-row months. Month cadence uses its actual
clipped calendar bounds. This diagnostic describes opportunities in the
completed-trade export, not every detector setup, attempted order or runtime
fill. Missing cache candles can suppress that source flow. Coverage remains a
diagnostic and must never unlock approval.

Use `--compareTo <variant-name>` (or `baseline` for the compiled gate) for exact
approval-set differences against a named policy. `comparisons` contains added
and removed identities and existing full/terminal, development/test, direction,
cost-stress and optional completed-trade summaries. The existing variant
`added`/`removed` fields still compare with the compiled baseline; do not rename
them as differences against a custom control. These options add no policy,
change no approvals and leave existing metrics unchanged.

The exported `formatGateComparisonContract` presentation API renders the fixed
AI reporting tables directly from two structured ablation reports and named
policies. It supports a frozen old control versus the same gate on a new core
export without recomputing metrics or silently using the new compiled baseline.
It rejects mismatched explicit calendar windows, outer test boundaries or
quality thresholds. Pass lineage/header, acceptance checks and conclusion
explicitly; unknown execution and reject-reason evidence stays `n/a`.

### Optional data-quality and adverse-cost diagnostics

Use `--featurePattern '<regex>' --cohortPath '<payload.path>'` to add
`featureAvailabilityAudit` to JSON reports. The cohort path is relative to the
rebuilt payload; for example,
`additionalIndicators.tradingPatternsContext.selectedPattern`. Audit groups
use UTC calendar year, direction, and cohort. Each observed matching primitive
path reports available, null, missing, invalid, present-approved, and
present-rejected counts. False and zero are present values. Arrays are not
expanded. Paths absent from every payload cannot be inferred from a regex and
are not fabricated. These snapshots stay separate from approval features:
presence and cohort membership never change a gate decision.

Use `--costStressBps 2,5,10` to add per-gate `costStress` JSON diagnostics.
Each number is additional adverse slippage in basis points on **each** entry
and exit. The tool selects original approvals once, then subtracts
`closedQty * (entryPrice + exitPrice) * bps / 10000` from their net PnL.
It uses `qty` only when `closedQty` is absent, and accepts actual execution
prices only from the original export's `tradeResult`; requested signal prices
are not substitutes. Historical quantity, risk and approval identities remain
unchanged. This is arithmetic cost stress, not a new execution simulation.

Reports retain full/terminal, development/test, three development blocks and
ALL/LONG/SHORT summaries through the existing metric functions. If any approved
row in a cohort lacks valid economics, that cohort's `metrics` and
`additionalCost` are null (render as `n/a`), with explicit complete/missing row
counts. Complete directional cohorts remain measurable even when aggregate
economics are unavailable. The summaries keep the existing decision-time metric
ordering; they are not a substitute for exit-time realized portfolio drawdown
or occupancy-sensitive backtests. Both diagnostic options are opt-in, leave
original report fields unchanged, and do not create additional gate candidates.

Use `--roundTripCostStressBps 20 --realizedMetrics` when the frozen acceptance
contract specifies extra bps on the entire round trip using entry notional.
This is distinct from `--costStressBps`, which applies the supplied bps to each
entry and exit. The round-trip calculation subtracts
`closedQty * actual entryPrice * roundTripBps / 10000`, using `qty` only when
`closedQty` is absent. It never uses a requested signal price. Historical
approvals, quantity and risk are frozen before the adjustment, including
timestamp-local capacity selection.

Each baseline, variant and named-policy comparison receives
`roundTripCostStress[]`. An entry contains `basisPointsRoundTrip`, the exact
formula, total extra cost, and `realized` with full/terminal, development/test,
three development blocks, LONG/SHORT and exit-ordered equity. Its `byDirection`
retains independently measurable LONG/SHORT reports when another direction has
missing economics. Missing entry notional or inconsistent original completed
PnL makes the affected realized evidence unavailable, not zero. The option
requires `--realizedMetrics` and explicit common window bounds; use its
`realized.test` for completed-trade acceptance criteria, not decision-order DD.
This arithmetic stress does not simulate changed fills or approval decisions.

The displayed execution-price calculation remains the default. Use the optional
`--entryNotionalAuthority <json>` only when a frozen execution model preserves
an unrounded `tradeResult.openFee` but rounds its displayed `entryPrice`. The
option is supported only with single-core `--runtimeCheckpoint`, positive
`--roundTripCostStressBps`, `--realizedMetrics`, and explicit common window
bounds. Cross-strategy, moving-average, and raw-materialization modes reject it.

The authority uses this closed contract:

```json
{
  "schema": "tradejs-entry-notional-authority/v1",
  "method": "fee-derived-full-closed",
  "runtimeCheckpoint": {
    "path": "runtime-checkpoint.json",
    "sha256": "<sha256>"
  },
  "semanticsReceipt": {
    "path": "entry-notional-semantics.json",
    "sha256": "<reviewed-sha256>"
  },
  "executionModule": {
    "packageName": "@tradejs/node",
    "relativePath": "dist/backtest.mjs",
    "sha256": "<reviewed-module-sha256>"
  },
  "resolvedExecutionConfig": {
    "path": "resolved-execution.json",
    "sha256": "<sha256>",
    "executionCostsJsonPointer": "/execution/costs",
    "executionCostsCanonicalSha256": "<sha256>",
    "fees": { "makerRate": 0.001, "takerRate": 0.001 }
  },
  "sourceExports": [{ "path": "part1.jsonl", "sha256": "<sha256>" }],
  "displayPriceDecimals": 8,
  "roundingPolicy": {
    "id": "decimal-half-unit-plus-binary64-interval-v1"
  }
}
```

Every path must remain inside Project after realpath resolution. The checkpoint
must equal the already verified execution runtime. The module must live at the
declared path inside that runtime's verified `@tradejs/node` package. Authority
text cannot declare its own fee semantics: the permanent tool has an explicit
allowlist of reviewed semantics-receipt bytes, semantics id, module path and
module SHA256. The initial supported combination is receipt SHA256
`2734c38558d7318106e8ed729c7b403468c9cf06e7b4ff011ddb6cd958ecb0c0`
and module SHA256
`2b6f586211b9057a73758909cc2816e0df90028f66f6b293362ba8661f24221f`.
A different runtime module requires a new reviewed receipt and a tested tool
change; it fails closed until then.

The resolved config file, exact JSON pointer, and canonical execution-cost
object must agree. Canonical JSON recursively sorts object keys, preserves
array order, serializes with `JSON.stringify`, and hashes its UTF-8 bytes. Both
maker and taker rates must be numeric, finite, positive, exactly equal, and
equal to the declared rate. Ordered source paths and complete file SHA256 values
must match before row evaluation. The same ordered path, byte-size, and SHA256
list is verified again after evaluation; a changed input prevents a report.

In this mode a row is complete only when `qty`, `closedQty`, `openFee`, and
`entryPrice` are finite positive numbers and `closedQty === qty` exactly. Its
entry notional is `openFee / entryFeeRate`. Missing `closedQty`, partial or
over-closure, invalid/zero fee, invalid price, or a failed precision check makes
the row unavailable. It never falls back to displayed/requested prices, `qty`
substitution, another row, or zero.

The displayed-price consistency allowance is analytical and fixed before data
inspection. Let `ulp(x)` be the larger distance from positive finite `x` to its
adjacent IEEE-754 binary64 values found with `nextDown` and `nextUp`. Then:

```text
feeNotional = openFee / entryFeeRate
displayNotional = qty * entryPrice
displayAllowance = qty * 0.5 * 10^-8
binary64Allowance =
  ulp(openFee) / entryFeeRate
  + ulp(feeNotional)
  + abs(entryPrice) * ulp(qty)
  + abs(qty) * ulp(entryPrice)
  + ulp(displayNotional)
allowance = displayAllowance + binary64Allowance
abs(feeNotional - displayNotional) <= allowance
```

There is no fitted epsilon. A larger scale-in accumulation discrepancy remains
missing rather than widening the allowance. The explicit report records the
authority and input before/after hashes, method, complete/missing counts and
stable missing-reason counts. One missing selected row makes only its affected
aggregate/direction/symbol realized stress cohorts unavailable; independently
complete cohorts remain measurable. Without the option, existing formula,
partial-close/quantity fallback behavior, report fields, and metrics are
unchanged.

Use `--realizedMetrics` for additional `baseline.realized` and
`variant.realized` JSON evidence. Original approvals and decision-time metrics
stay unchanged. This option requires explicit `--windowStart` and `--windowEnd`;
the last signal is not a valid completion-window anchor. The tool joins the selected rows to their own original
`tradeResult.netProfit` and `tradeResult.exitTimestamp`, requires finite values
and agreement with exported row profit, and reuses the existing metric and
equity functions after sorting by actual completion time. Full and terminal
windows are half-open, anchored to the common immutable window end; terminal
membership uses exit timestamps. Train/test and three development cohorts are
first assigned by original decision timestamps, then exit-ordered within each
cohort. Development trades may finish after the decision partition boundary;
these are retrospective completed-outcome cohorts, not maturity-sealed training
labels. Cohort cadence uses the full original decision-calendar bounds, including
inactive days, with the same denominator for ALL and each direction. Invalid
signal identities, duplicate approvals and exits preceding signals fail loudly;
out-of-window completed outcomes are counted explicitly. Zero-PnL outcomes are
flat (neither wins nor losses), matching gate metrics, unlike the raw-core
Redis-compatible zero-as-loss convention. The additional section also retains directions and year/direction/cohort
outcomes, with year assigned by decision timestamp. Missing economics produce
null periods/equity, never substitute signal time or guessed outcome. A selector
using `metricBasis=completed-trade` must fail rather than consume incomplete
realized evidence. Approval-event cadence and fan-out remain decision-time
diagnostics; completed-trade cadence is a separate metric.

Do not create another `/tmp` parser, heredoc ESM replay, or strategy-specific
one-off script for capabilities that belong here. Extend this script and its
`node:test` coverage, then update this reference and `SKILL.md` when the
research contract changes.

For development-only gate selection, set `--windowEnd`, `--testSince` and
`--labelEndBefore` to the same frozen outer UTC boundary, with an explicit
`--windowStart` and `--validationSplit 0`. The last option excludes development
decisions whose completed exit is at or after the boundary, or whose exit is
unknown, before payload construction, gate evaluation and feature inventory.
It reports separate crossing/unknown counts in `sourceSelection.labelHorizon`
and marks `run.discoveryOnly`. Exits preceding decisions and invalid numeric
source timestamps fail closed. No test outcomes are evaluated by this mode.
It does not shift the boundary to replace purged support. Omit this option for
the final full-period evaluation only after every gate specification and
development selection has been frozen. Discovery requires UTC ISO ending in
`Z` or epoch milliseconds, and cannot use the cross-strategy contour.

Run the tool tests after every change:

```bash
node --test .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.test.mjs
```

With the standard 60/40 cross-strategy split, the field `tuning` is the last
third of development, overlapping the discovery partition. It is a diagnostic
stability block, not an independent validation set. All three development
blocks are reported separately; the outer test remains distinct.

## Raw discovery export for native local training

Before maturity purging, freeze one common calendar boundary from the parent
export using the metadata-only mode:

```bash
node <checksum-bound-ai-gate-ablation.mjs> --file <parent-full-export.jsonl> \
  --timestampPartitionMetadata <Project-path>/timestamp-partition.json \
  --windowStart <start-ms> --windowEnd <end-ms> \
  --validationSplit 0 --testSplit 0.4
```

This mode hashes ordered complete source files before and after reading, retains
only timestamps, sorts whole timestamp groups, and uses the standard outer
60/40 split. It requires two independent groups, rejects invalid timestamps,
and writes a new exclusive checksum-bound metadata file. It never loads source,
runtime, payload, gate or features, nor reads outcome/label fields. The metadata
contains row/group counts and `testSince`/UTC boundary, not individual trades.
Evaluation/runtime/variant, label-purge and exact-boundary options are forbidden.
Use the same frozen `testSince` for every candidate, before any discovery.

When the installed native pocket CLI lacks `--testSince`, first materialize
each candidate's mature DEV view below using that common boundary, then search
the view with `--validationSplit 0 --testSplit 0 --sealTest`, separately LONG and
SHORT. This searches all of the already isolated outer DEV60% and retains its
three diagnostic blocks; `.4` on this view would incorrectly split DEV again.
Bind the parent partition metadata and view receipt in the report. Never run
the older full-export native search just to find a cutoff: it can evaluate
reserved-tail payloads before sealing the search result.

`--materializeDiscoveryExport <jsonl>` is a raw-only mode, before source,
runtime, plugin, payload and gate loading. It requires explicit `--windowStart`,
`--windowEnd`, `--testSince`, `--labelEndBefore`, with the latter three equal and
`--validationSplit 0`. Evaluation, runtime, artifact, variant and report options
are rejected. Only mature source objects in the half-open window are written:
decision timestamp is inside the window and finite numeric exit timestamp is
at least the decision timestamp and strictly before the cutoff. Unknown or
crossing label horizons are counted and purged before any feature work. A bad
raw timestamp or inverted chronology fails closed.

The output and `<jsonl>.receipt.json` must be new files inside Project and use
exclusive creation. Full input files are hashed before and after streaming;
the output is hashed while writing and again on readback. Zero eligible rows,
changed input or malformed evidence fail without a success receipt; partial
output is retained as failure evidence, never silently reused. The receipt
contains all input/output hashes, byte sizes, exact bounds and scan/purge counts.
Source objects are not evaluated or rewritten apart from JSON serialization.

```bash
node <checksum-bound-ai-gate-ablation.mjs> --strategy LiquidityZones \
  --file <own-full-export.jsonl> --outDir <original-export-directory> \
  --materializeDiscoveryExport <Project-path>/discovery-view.jsonl \
  --windowStart <start-ms> --windowEnd <cutoff-ms> \
  --testSince <cutoff-ms> --labelEndBefore <cutoff-ms> --validationSplit 0
```

Use a non-merged filename such as `discovery-view.jsonl` for native training.
Native `ai-train` recognizes `ai-dataset-*-merged-*` names and may substitute
the original shard group from `--outDir` when its merge ID is reused. Keep the
view's explicit absolute `--file` and a valid original `--outDir`, then use
`--since start-ms --until cutoff-ms-1` (native bounds are inclusive). Native
`research.lineage.sourceSha256s` now identifies the view, not its parents:
bind the materialization receipt and original source/core/config authority
separately. Do not confuse this view with a new backtest export.

Native local reports execute the Project-registered compiled strategy, not
the checkout named by `TRADEJS_SOURCE_REPOSITORY_ROOT`. Freeze the complete
Project package/checkpoint, compiled CJS/ESM artifact and source/build authority
for each composition before running a fresh process. Native `gitSha` describes
Project; `gateFingerprint` hashes selected resolved entry files, not full trees;
`configIdsFingerprint` hashes IDs, not resolved config. None replaces the
explicit source, package, full resolved config and execution checkpoint hashes.
The native current-gate report and a compiled candidate-gate report must use
their own candidate export and separate exact compositions. Run final full
history only after rules are frozen; do not use final cohorts for selection.

Use `--symbolCohorts <Project-owned.json> --realizedMetrics` to report frozen
symbol groups. The input format is:

```json
{
  "schema": "tradejs-symbol-cohorts/v1",
  "groups": [
    { "id": "full-history", "symbols": ["BTCUSDT"] },
    { "id": "expanded", "symbols": ["NEWUSDT"] }
  ]
}
```

Group IDs and symbols must be nonempty and unique. Symbols must be disjoint
across groups, and every evaluated source row must belong to one group. The
input path must resolve inside the Project. Its bytes are checksum-bound in
`run.symbolCohorts` and each realized report. Membership is diagnostic metadata
and is never added to decision features or eligible gate predicates.

`baseline.realized.symbolCohorts.groups[]` and the same section on each variant
contain declared and observed symbol counts, source row counts, and a complete
realized report. The report includes full and requested terminal windows,
ALL/LONG/SHORT, common calendar train/test boundaries, the three development
blocks, zero-activity windows, and equity. Approvals and capacity ranking are
frozen globally before filtering a group. Filtering must not give an overflow
symbol another chance at admission or move a partition boundary. Round-trip
cost stress retains the same group sections and approval identities. Without
the option, existing reports remain unchanged. The option is not supported in
cross-strategy, moving-average, or raw-materialization mode.

The required 120-symbol full-four-year cohort and expanded 456-symbol cohort
are diagnostic reporting slices for both raw and final gated tables. They are
not gate features or selection predicates. Existing monthly/cohort diagnostics
may not supply PF/MaxDD for every common window; report that limitation and use
a separately reviewed generic reporting extension if needed. Never derive a
new rule from the final cohort tables.
