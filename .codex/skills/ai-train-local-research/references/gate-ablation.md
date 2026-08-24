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
  --validationSplit 0.2 \
  --testSplit 0.2 \
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

For direction-specific discovery, use `yarn ai-pocket-search --direction LONG`
or `--direction SHORT`. For release evidence reserve an untouched chronological
tail with `--testSplit ... --sealTest`; the search ranks pockets using only the
preceding train and validation rows and reports only the sealed test bounds.
Plain `--testSplit` exposes test metrics and cannot be called untouched after
the report is read. Open the sealed tail once with the frozen fixed-rule
ablation.

## Cross-Strategy Feasibility

Use `--crossStrategy` to test whether the latest merged export for every
available strategy contains shared LONG or SHORT approval/block pockets:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs \
  --crossStrategy \
  --validationSplit 0.2 \
  --testSplit 0.2 \
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
  --validationSplit 0.2 \
  --testSplit 0.2 \
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

`--crossStrategy` requires positive `--validationSplit` and `--testSplit`.
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
- timestamp-grouped, time-ordered train/tuning/untouched-test splits;
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

Do not create another `/tmp` parser, heredoc ESM replay, or strategy-specific
one-off script for capabilities that belong here. Extend this script and its
`node:test` coverage, then update this reference and `SKILL.md` when the
research contract changes.

Run the tool tests after every change:

```bash
node --test .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.test.mjs
```
