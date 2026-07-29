# RelativeRotation AI Replay Notes

Last updated: 2026-07-29.

This file tracks deterministic `AI_MODE=gate` / `yarn ai-train --localOnly`
research for RelativeRotation.

## Post-Refactor Gate Rebuild (`2026-07-21`)

### Source export and lineage

The supplied pre-fix export was:

```text
data/ai/export/ai-dataset-relativerotation-merged-1784622260529-part1.jsonl
...
data/ai/export/ai-dataset-relativerotation-merged-1784622260529-part7.jsonl
```

It contained `156,282` rows over
`2025-07-20T17:00:00.000Z .. 2026-07-19T15:00:00.000Z`. The old local gate
had no deterministic `postProcessAnalysis`, so q4+ and q5+ both approved zero
rows. The all-candidate stream lost `805,154.02`.

After fixing the detector and selecting a less noisy strategy configuration, a
new cache-only year export was generated from all `512` symbols:

```text
data/ai/export/ai-dataset-relativerotation-merged-1784639149857-part1.jsonl
...
data/ai/export/ai-dataset-relativerotation-merged-1784639149857-part7.jsonl
```

- rows: `22,101`
- timestamp range: `2025-07-21T12:00:00.000Z .. 2026-07-19T14:30:00.000Z`
- span: `363.10d`
- data lag at final replay: about `1.95d`
- duplicate groups: `0`
- backtest run id: `202607211459-1b4cf539`
- config id: `q7r9bb`
- git SHA at replay time: `40f51410f78c25e498f893b6827ee8a4d96645cc`
- dirty: `true` (gate and detector changes under test, plus unrelated concurrent
  worktree changes)
- final gate fingerprint: `54b554f95fae45ab`
- context fingerprint: `4186a11d2ef809af`
- derivatives context: enabled, target context disabled, lookback `48h`, extra
  references `BNB,SOL,TRX,XRP`, source interval `15m`, derived interval `1h`

Authoritative replay:

```bash
yarn ai-train --strategy RelativeRotation \
  --file data/ai/export/ai-dataset-relativerotation-merged-1784639149857-part1.jsonl \
  --localOnly --json -n 0 --terminalWindows=180,90,30,7
```

### Historical gate audit

RelativeRotation was introduced in `80d9cb65` and subsequently touched by the
StrategyAPI refactors in `118d9fc6`, `7dcae9b0`, and `a4442f92`. The AI adapter
hash is identical at all four commits and before this rebuild:

```text
c5bbffed2314c638be22b2d60cb4fc2f8ae2f0fddc8ce4db3b84da97b92d9e50
```

None of those revisions had a deterministic approval gate or quality mapping.
Reverting to a previous RelativeRotation gate is therefore not possible: the
previous revisions all represent the same no-approval gate.

The detector bug also existed from the initial commit. It compared
`RR_MIN_RELATIVE_STRENGTH_1H` with
`baseContext.relative.benchmark.relativeStrength1h`, a ratio that explodes when
BTC's denominator return is near zero. The supplied export had values up to
roughly `+/-38,964`, so its `0.15` threshold did not represent target-vs-BTC
relative strength. The detector now uses the causal
`baseContext.relative.targetVsBtc.ratioReturn1h` field.

### Detector and risk research

Thirty-day full-universe baseline before the detector fix:

- average PnL per symbol: `-162.40`
- win rate: `30.3%`
- tests: `512`

Changing opposite-rotation exit, inverting directions, and sweeping stop/target
values did not make the old detector profitable. After the causal metric fix, a
signal/risk sweep selected:

```text
RR_MIN_ALPHA_24H=4
RR_MIN_RATIO_RETURN_24H=1
RR_MIN_RELATIVE_STRENGTH_1H=4
RR_STOP_ATR_MULT=2.4
RR_TARGET_R_MULT=1.5
RR_EXIT_ON_OPPOSITE_ROTATION=false
LONG.minRiskRatio=1.2
SHORT.minRiskRatio=1.2
```

On the full universe this configuration produced trades but remained negative
without an AI filter:

- last30d: average `-4.72` per symbol, `1,721` orders
- full year: average `-47.83` per symbol

The deterministic gate is therefore required. The result must not be described
as an unfiltered core-strategy edge.

### Rejected gate hypotheses

The supplied pocket-search report and new depth-2/depth-3 searches over the old
export did not yield a valid production pocket. The only small positive old-data
candidate had `79` trades and failed terminal validation: last30d `-30.06`,
last7d `-35.51`.

The first post-fix gate draft used ETH alignment plus at most one context
conflict. It was positive over the whole year (`791` approvals, PnL `+1,710.38`,
PF `1.41`) but was driven by October and failed every recent window:

| window | approvals | PnL | PF |
| --- | ---: | ---: | ---: |
| last180d | 248 | -305.30 | 0.82 |
| last90d | 102 | -99.83 | 0.85 |
| last30d | 32 | -101.33 | 0.58 |
| last7d | 5 | -29.54 | 0.32 |

LONG remained negative and was excluded from the final gate. Data-shape fields
such as `volumeStructure.rowCount` were used only as negative controls and never
as approval evidence.

### Validated pocket and sensitivity

The fresh compact pocket search reserved the trailing `25%` (`5,525` rows) for
time-ordered validation and excluded outcome, symbol, and current gate fields.
It identified a causal SHORT breakdown pocket based on current local-range
distance and ADX directional strength.

Sensitivity around the chosen rule:

| distance to low | DI- max | trades | PnL | PF | train PnL | validation PnL | 180d | 90d | 30d | 7d |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| -2.50 ATR | 45 | 393 | 375.30 | 1.17 | 216.46 | 158.84 | 146.20 | 178.43 | 45.58 | 20.57 |
| -2.75 ATR | 45 | 269 | 501.71 | 1.35 | 289.86 | 211.85 | 294.74 | 214.59 | 60.96 | 30.40 |
| **-2.75 ATR** | **50** | **582** | **823.53** | **1.25** | **589.93** | **233.60** | **139.78** | **225.10** | **52.34** | **21.24** |
| -3.00 ATR | 45 | 170 | 326.00 | 1.36 | 192.52 | 133.48 | 158.24 | 147.59 | 72.07 | 26.85 |
| -3.00 ATR | 50 | 415 | 555.10 | 1.24 | 421.86 | 133.24 | 50.89 | 136.11 | 32.44 | 3.77 |
| -3.25 ATR | 45 | 91 | 204.79 | 1.43 | 107.59 | 97.20 | 146.16 | 97.20 | 74.98 | 26.85 |

The selected thresholds sit inside a profitable neighbourhood instead of on an
isolated exact cut. No symbol allowlist is used. The largest symbol contributes
only `10` of `582` approvals.

### Implemented gate

At q4+, approval requires all of:

```ts
signalDirection === 'SHORT' &&
distanceToLowLevelAtr <= -2.75 &&
adxDiMinus <= 50
```

Missing canonical target-vs-BTC, local-range, or ADX context is a hard block.
LONG and all rows outside the validated pocket remain q3/rejected. The adapter
pins approved direction to the strategy signal, so an LLM cannot reverse it.

### Metrics after implementation

q4+:

- approvals: `582`
- win rate: `50.3%`
- PF: `1.25`
- PnL: `+823.53`
- maxDD: `190.37`
- maxDD / gross profit: `4.7%`
- max loss: `-12.60`
- max loss streak: `7`
- approvals/day: `1.60`
- losing months: `4` of `13`

q5+ intentionally has `0` approvals; the validated pocket is assigned q4.

Terminal windows:

| window | approvals | approvals/day | WR | PF | PnL |
| --- | ---: | ---: | ---: | ---: | ---: |
| full | 582 | 1.60 | 50.3% | 1.25 | 823.53 |
| last180d | 294 | 1.63 | 46.6% | 1.08 | 139.78 |
| last90d | 152 | 1.69 | 50.7% | 1.27 | 225.10 |
| last30d | 51 | 1.70 | 49.0% | 1.18 | 52.34 |
| last7d | 7 | 1.00 | 57.1% | 1.63 | 21.24 |

Direction split:

- LONG: `0` approvals
- SHORT: `582` approvals, PnL `+823.53`, PF `1.25`

### Config and rollout state

Package defaults now match the exported detector configuration and set
`MIN_AI_QUALITY=4`. The local Redis backtest key
`users:root:backtests:configs:RelativeRotation:ai` was promoted from
`RelativeRotation:research-candidate`. The previous value is recoverable at:

```text
users:root:backtests:configs:RelativeRotation:ai-backup-1784639149857
```

Both LONG and SHORT remain enabled in the strategy config; the deterministic
gate disables LONG. This research validates local deterministic
`AI_MODE=gate`, not `AI_MODE=llm`, and does not claim live-runtime parity until
the same SHA, gate fingerprint, config id, context fingerprint, and
`MIN_AI_QUALITY=4` are deployed together.

## Immediate q4 Momentum And Sentiment Filter (`2026-07-21`)

The user explicitly selected immediate enforcement instead of the preferred
passive q5 rollout. The existing SHORT breakdown pocket remains the base rule,
but q4 approval now additionally requires:

```ts
additionalIndicators.baseContext.raw.price.price1hPct <= -5 &&
additionalIndicators.baseContext.relative.cmcFearGreed.valueChange7d >= -12 &&
additionalIndicators.baseContext.relative.cmcFearGreed.stale === false
```

The raw pocket-search boundary for the hourly price move was approximately
`-4.80752%`; implementation rounds it in the stricter direction to `-5%`.
Fear & Greed uses the already discrete `-12` point boundary. Both rounded
conditions were rerun over the complete export and through a trailing 25%
validation split. Missing hourly price, missing CMC context, missing freshness,
or stale CMC context now hard-block q4 approval.

Export: `1784639149857` (`7` parts), rows `22,101`, window
`2025-07-21T12:00:00.000Z .. 2026-07-19T14:30:00.000Z`, lag `2.13d`.
Lineage: git `1cb91ea7a83adb1d146c38dd583c1df3e7415ba6` (dirty gate change plus unrelated worktree changes), gate
`24d94c8c46eae0a5`, config `6587d6b2e6300a8e`, context
`4186a11d2ef809af`, `MIN_AI_QUALITY=4`, `AI_MODE=local-deterministic`.

| Period | Gate | N | WR | PF | Sharpe | Sortino | Calmar | PnL | MaxDD | Loss Streak | Trades/Day |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | before | 582 | 50.3% | 1.25 | 2.73 | 4.33 | 4.35 | 823.53 | 190.37 | 7 | 1.603 |
| full | after | 387 | 56.8% | 1.67 | 5.06 | 8.63 | 15.21 | 1,228.63 | 81.19 | 6 | 1.066 |
| 180d | before | 294 | 46.6% | 1.08 | 0.93 | 1.42 | 1.49 | 139.78 | 190.37 | 7 | 1.633 |
| 180d | after | 186 | 53.8% | 1.47 | 3.76 | 6.25 | 11.22 | 449.05 | 81.19 | 6 | 1.033 |
| 90d | before | 152 | 50.7% | 1.27 | 2.93 | 4.66 | 9.42 | 225.10 | 96.96 | 7 | 1.689 |
| 90d | after | 103 | 57.3% | 1.70 | 5.42 | 9.28 | 33.17 | 338.07 | 41.34 | 3 | 1.144 |
| 30d | before | 51 | 49.0% | 1.18 | 2.04 | 3.19 | 6.57 | 52.34 | 96.96 | 4 | 1.700 |
| 30d | after | 36 | 52.8% | 1.41 | 3.60 | 5.93 | 22.72 | 77.19 | 41.34 | 3 | 1.200 |
| 7d | before | 7 | 57.1% | 1.63 | 4.68 | 7.87 | 92.14 | 21.24 | 12.02 | 1 | 1.000 |
| 7d | after | 5 | 60.0% | 1.93 | 5.35 | 9.46 | 48.35 | 20.10 | 21.71 | 2 | 0.714 |

Full q4+ risk metrics after enforcement:

- gross profit / loss: `3,072.08 / 1,843.45`
- average approved trade: `3.17`
- average win / loss: `13.96 / 11.04`
- payoff ratio: `1.27`
- largest win / loss: `14.96 / -11.66`
- maxDD / gross profit: `2.64%`
- maxDD / total profit: `6.61%`
- recovery factor: `15.13`
- ulcer index: `25.29`
- maximum win / loss streak: `17 / 6`
- average PnL: `3.38/day`, `102.99/month`
- cadence: `1.07/day`, `7.46/week`
- losing months: `2025-09 -34.72`, `2026-02 -26.56`

Time-ordered split:

| Split | N | WR | PnL | PF | MaxDD |
| --- | ---: | ---: | ---: | ---: | ---: |
| train | 286 | 56.6% | 893.43 | 1.65 | 81.19 |
| validation | 101 | 57.4% | 335.20 | 1.71 | 41.34 |

The largest full-period symbol contributes `9 / 387` approvals and `52.93`
PnL, so the implemented pocket does not depend on a symbol allowlist or one
dominant symbol. The validation support of `101` exceeds the default minimum of
`25`.

Feature provenance and parity:

- `raw.price.price1hPct` is a causal signal-time market-state feature derived
  from the strategy indicator snapshot on the evaluated candle.
- `relative.cmcFearGreed.valueChange7d` is a causal daily CMC market-state
  feature calculated from the latest row at or before signal time and the
  latest row at or before signal time minus seven days.
- `relative.cmcFearGreed.stale` is used only as a data-quality blocker, never as
  positive approval evidence.
- the replay uses strategy interval `15`, local deterministic gate mode,
  `MIN_AI_QUALITY=4`, config id `q7r9bb`, and a complete non-stale CMC context
  on all `22,101` rows. Runtime must keep the same CMC source/freshness behavior;
  otherwise the new hard block intentionally produces no q4 approval.

Sensitivity remained positive around `price1hPct <= -4.5 / -5 / -5.5` and Fear
& Greed boundaries `-15 / -12 / -10`. The stricter implemented `-5 / -12`
variant was preferred over the relaxed `-4.5 / -12` alternative because it
improved PF and preserved the stricter rounding rule.

Negative controls based on absolute token price also improved this one export,
which indicates residual cohort bias. The normalized hourly move and causal CMC
regime features are more defensible, and train/validation plus all terminal
windows stayed profitable, but live performance remains unverified. Immediate
enforcement was chosen explicitly despite that residual risk. The main tail
risk is the small last-7d sample: cadence falls to `0.71/day`, PnL is slightly
lower than before, and maxDD rises from `12.02` to `21.71`.

Post-change authoritative replay completed with `0` errors and exactly matched
the pre-implementation ablation (`387` approvals, PnL `1,228.63`, PF `1.6665`,
maxDD `81.19`). q5+ remains empty; this is an enforced q4 rule, not a watch-only
quality tier.

## Post-refactor q4 Breadth Recovery (`2026-07-22`)

The strategy, node runtime, and CLI packages were rebuilt after the refactor,
then the deterministic gate was replayed over export `1784733615297` (`7`
parts). The export contains `22,047` rows covering
`2025-07-22T10:15:00.000Z .. 2026-07-19T14:30:00.000Z` (`362.18d`) with a
`3.09d` terminal lag at research time.

Lineage of the authoritative post-change run:

- git: `640959ee4d9982cae8419a4ff2dfcfe177857f7d` (`dirty`; this gate change and
  unrelated worktree changes were present)
- gate fingerprint: `3813701afec6daca`
- config fingerprint / id: `6587d6b2e6300a8e` / `q7r9bb`
- context fingerprint: `4186a11d2ef809af`
- mode: `local-deterministic`, `MIN_AI_QUALITY=4`
- result: `22,047` selected, `0` failed rows

The previously enforced primary q4 SHORT pocket remains unchanged. A second,
immediately active recovery pocket was added:

```ts
signalDirection === 'SHORT' &&
marketBreadthDispersion >= 0.0085 &&
price1hPct <= -5 &&
altBasketReturn1h >= -0.015 &&
cmcFearGreedValueChange7d >= -12 &&
cmcFearGreedStale === false
```

The source pocket discovered on the time-ordered train partition used
`dispersion >= 0.00732447`, `price1hPct <= -4.93151`, and
`altBasketReturn1h >= -0.0171107`. The production boundaries are rounded in a
stricter direction and were selected from a small stability grid. The recovery
fields are optional for the primary breakdown pocket, but both must be present
to activate recovery. Existing causal-context, price, Fear & Greed freshness,
distance, and DI data-quality hard blocks remain in force.

### Authoritative q4+ metrics

| Period | N | WR | PF | Sharpe | Sortino | Calmar | PnL | MaxDD | Loss Streak | Trades/Day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | 490 | 57.3% | 1.71 | 6.01 | 10.36 | 17.26 | 1,640.98 | 95.82 | 6 | 1.353 |
| 180d | 278 | 55.4% | 1.59 | 5.52 | 9.37 | 20.08 | 804.16 | 81.19 | 6 | 1.544 |
| 90d | 190 | 57.4% | 1.73 | 7.64 | 13.22 | 39.14 | 647.56 | 67.11 | 5 | 2.111 |
| 30d | 76 | 61.8% | 2.10 | 11.42 | 20.59 | 62.77 | 346.22 | 67.11 | 5 | 2.533 |
| 7d | 13 | 76.9% | 4.34 | 20.67 | 41.75 | 257.95 | 107.24 | 21.71 | 2 | 1.857 |

Full-period risk and cadence details:

- approved wins / losses: `281 / 209`
- gross profit / loss: `3,939.74 / 2,298.76`
- average trade: `3.35`
- average win / loss: `14.02 / 11.00`
- payoff ratio: `1.27`
- largest win / loss: `14.96 / -12.28`
- maxDD / gross profit: `2.43%`
- maxDD / total profit: `5.84%`
- recovery factor: `17.13`
- ulcer index: `27.05`
- maximum win / loss streak: `17 / 6`
- average PnL: `4.53/day`, `137.91/month`
- cadence: `1.35/day`, `9.47/week`
- losing months: `2025-09 -54.37`, `2026-02 -11.94`

### Time split and incremental slice

| Slice | N | WR | PnL | PF | MaxDD | Loss Streak | Losing Months |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| train candidate | 308 | 57.1% | 1,007.45 | 1.69 | 95.82 | 6 | 2 |
| validation candidate | 182 | 57.7% | 633.53 | 1.75 | 67.11 | 5 | 0 |
| recovery-only additions | 104 | 58.7% | 401.28 | 1.86 | 57.66 | 4 | 2 |

Compared with the primary pocket alone, full q4+ changes from `386` to `490`
trades, PnL from `1,239.70` to `1,640.98`, PF from `1.68` to `1.71`, and
cadence from `1.07/day` to `1.35/day`. Absolute full maxDD rises from `81.19`
to `95.82`, while maxDD/PnL improves from `6.55%` to `5.84%` and the maximum
full-period loss streak remains `6`. All terminal windows remain profitable;
the largest relative evidence gain is in the last `30d` and `7d`, so live
behavior still needs lineage-matched monitoring.

The broad absolute-token-price negative control was rejected. Although it was
profitable in-sample, its validation result was `-39.50`, PF `0.99`, maxDD
`469.20`; the last `90d` and `7d` were also negative (`-82.09` and `-40.99`).
This confirms that simply widening SHORT approvals does not survive the holdout.

`marketBreadth.dispersion`, `btcAltRegime.altBasketReturn1h`, `price1hPct`, and
CMC Fear & Greed are normalized market-state features resolved at or before the
signal candle. No execution, delayed-fill, exit, or outcome field participates
in approval. The authoritative replay exactly matched the chosen pre-change
ablation (`490` approvals, PnL `1,640.98`, PF `1.7139`, maxDD `95.82`). This is
an active q4 gate change, not watch mode. It validates `AI_MODE=gate` only and
does not establish `AI_MODE=llm` or live-runtime parity.

## Post-refactor BTC Leadership Filter (`2026-07-26`)

The strategy, Node runtime, and CLI packages were rebuilt before and after the
gate change. The authoritative replay used all seven parts of export
`1785011628197`:

```text
data/ai/export/ai-dataset-relativerotation-merged-1785011628197-part1.jsonl
...
data/ai/export/ai-dataset-relativerotation-merged-1785011628197-part7.jsonl
```

- rows: `21,983`
- timestamp range:
  `2025-07-25T18:15:00.000Z .. 2026-07-24T13:45:00.000Z`
- span: `363.81d`
- data lag at final replay: `1.34d`
- config fingerprint / id: `6587d6b2e6300a8e` / `q7r9bb`
- context fingerprint: `4186a11d2ef809af`
- git SHA: `67ab05ba0df329af277341664258c30c0de01cbd`
- dirty: `true` because the new gate was under test
- final gate fingerprint: `f44bda9a4742cb61`
- mode: `local-deterministic`, `MIN_AI_QUALITY=4`
- selected / failed: `21,983 / 0`

### Existing-gate audit

The pre-change combined gate still made trades and was profitable over the full
export, but its terminal regime had deteriorated:

| Period | N | WR | PF | PnL | MaxDD | Loss Streak | Trades/Day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | 509 | 53.4% | 1.46 | 1,205.62 | 91.06 | 7 | 1.399 |
| 180d | 295 | 49.5% | 1.25 | 414.66 | 91.06 | 7 | 1.639 |
| 90d | 191 | 50.3% | 1.30 | 310.96 | 91.06 | 7 | 2.122 |
| 30d | 78 | 48.7% | 1.22 | 95.20 | 91.06 | 7 | 2.600 |
| 7d | 28 | 39.3% | 0.82 | -34.32 | 91.06 | 7 | 4.000 |

The primary breakdown pocket alone remained profitable (`383` trades,
PnL `1,121.41`, PF `1.60`) but had only four last-7d trades and lost `19.28`.
The unfiltered breadth-recovery pocket was materially weaker (`137` trades,
PnL `86.30`, PF `1.11`, maxDD `103.79`) and also lost `26.37` in the last 7d.
The recovery pocket was therefore retained only behind the new common market
filter; it is no longer able to bypass that filter.

### Research and implemented rule

Pocket discovery was used only to generate hypotheses. Threshold selection was
then rerun with the reusable ablation tool using a trailing `25%` time-ordered
holdout, terminal windows, threshold sensitivity, pocket decomposition, symbol
concentration, and negative controls. Artifacts:

```text
data/ai/output/ai-pocket-search-relativerotation-merged-1785011628197-approved-2026-07-25T21-36-51Z.md
data/ai/output/ai-pocket-search-relativerotation-merged-1785011628197-all-2026-07-25T21-38-08Z.md
data/ai/output/relative-rotation-post-refactor-filter-ablation-1785011628197.json
data/ai/output/relative-rotation-post-refactor-stability-ablation-1785011628197.json
```

Both existing SHORT pockets now additionally require:

```ts
baseContext.relative.btcAltRegime.btcVsAltReturn1h >= -0.001 &&
baseContext.relative.btcAltRegime.btcTurnoverShare24h >= 0.25
```

Missing or null inputs hard-block approval. Values below either boundary
produce q3. The exact rounded boundaries remain q4. LONG remains disabled.

Sensitivity stayed profitable around the selected rule:

| BTC-vs-alt 1h min | BTC turnover share min | N | PnL | PF | Validation PnL | Validation PF | Last-7d PnL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| -0.0012 | 0.25 | 382 | 1,472.43 | 1.86 | 428.79 | 1.69 | 12.87 |
| **-0.0010** | **0.25** | **377** | **1,478.83** | **1.89** | **440.31** | **1.72** | **24.39** |
| -0.0008 | 0.25 | 372 | 1,458.98 | 1.89 | 426.48 | 1.70 | 24.39 |
| -0.0005 | 0.25 | 355 | 1,395.54 | 1.89 | 429.78 | 1.76 | 24.39 |
| -0.0010 | 0.24 | 383 | 1,460.38 | 1.85 | 429.06 | 1.69 | 24.39 |
| -0.0010 | 0.26 | 374 | 1,511.75 | 1.92 | 440.31 | 1.72 | 24.39 |

The `0.25` turnover boundary was preferred over the marginally better
full-sample `0.26` result because it preserves more trades and the holdout and
terminal results are identical. The rounded BTC-vs-alt boundary is inside a
profitable neighbourhood rather than at an isolated optimum.

Feature provenance:

- `btcVsAltReturn1h` is BTC's causal 1h return minus the aligned mean 1h return
  of the alt basket.
- `btcTurnoverShare24h` is BTC 24h turnover divided by BTC-plus-alt-basket 24h
  turnover.
- both are normalized signal-time market-state fields produced by the shared
  Binance market context and were numeric on all `21,983` rows.
- no execution, delayed-fill, exit, outcome, symbol allowlist, or current gate
  output participates in the rule.

The inverse BTC-relative condition was a strong negative control: `104` trades,
PnL `-237.30`, PF `0.68`, validation PnL `-118.10`, and last-7d PnL `-58.71`.
The inverse turnover condition was also negative (`22` trades, PnL `-46.12`,
PF `0.71`). An absolute-token-price control did not repair the last-7d loss and
was rejected as cohort-sensitive.

### Authoritative q4+ metrics after implementation

| Period | N | WR | PF | Sharpe | Sortino | Calmar | PnL | MaxDD | Loss Streak | Trades/Day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | 377 | 59.7% | 1.89 | 6.22 | 10.93 | 27.52 | 1,478.83 | 53.92 | 5 | 1.036 |
| 180d | 210 | 56.7% | 1.67 | 5.31 | 9.11 | 25.20 | 670.14 | 53.92 | 5 | 1.167 |
| 90d | 131 | 57.3% | 1.72 | 6.26 | 10.82 | 33.12 | 440.31 | 53.92 | 5 | 1.456 |
| 30d | 49 | 57.1% | 1.72 | 6.61 | 11.42 | 45.34 | 164.94 | 44.26 | 4 | 1.633 |
| 7d | 16 | 50.0% | 1.27 | 3.49 | 5.61 | 28.73 | 24.39 | 44.26 | 4 | 2.286 |

Full-period risk and cadence details:

- wins / losses: `225 / 152`
- gross profit / loss: `3,149.52 / 1,670.69`
- average trade: `3.92`
- average win / loss: `14.00 / 10.99`
- payoff ratio: `1.27`
- largest win / loss: `14.96 / -11.91`
- maxDD / gross profit: `1.71%`
- maxDD / total profit: `3.65%`
- recovery factor: `27.43`
- ulcer index: `17.36`
- maximum win / loss streak: `17 / 5`
- average PnL: `4.06/day`, `123.72/month`
- cadence: `1.04/day`, `7.25/week`
- active losing months: `0`
- direction split: `377 SHORT`, `0 LONG`

Time-ordered split:

| Split | N | WR | PnL | PF | MaxDD | Loss Streak | Losing Months |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| train | 246 | 61.0% | 1,038.52 | 1.98 | 52.38 | 4 | 0 |
| validation | 131 | 57.3% | 440.31 | 1.72 | 53.92 | 5 | 0 |

Every active calendar month is profitable; the weakest is April 2026 at
`+18.08`. The largest symbol contributes only `7 / 377` approvals, so no
single-symbol concentration explains the result. Compared with the pre-change
gate, full PnL rises from `1,205.62` to `1,478.83`, PF from `1.46` to `1.89`,
maxDD falls from `91.06` to `53.92`, the loss streak falls from `7` to `5`, and
the last 7d changes from `-34.32` to `+24.39` while preserving
`2.29 trades/day`.

This is an immediately enforced q4 gate change, not watch mode. It validates
the local deterministic `AI_MODE=gate` replay only; live profitability remains
unverified until the same SHA, gate fingerprint, config id, context
fingerprint, market-context environment, and `MIN_AI_QUALITY=4` are deployed
together.

## RelativeRotation — AI gate report (`q4+`) (`2026-07-29`)

Decision: `observe` — keep the already-active profitable gate unchanged, but do
not add another enforced filter until a fresh untouched export and live
portfolio capacity are available.

Dataset: `1785011628197` (`7` parts), rows `21,983`,
`2025-07-25T18:15:00.000Z .. 2026-07-24T13:45:00.000Z`, lag `4.81d`.
Lineage: git `9f27c152b61bf8e096c0d5be592c406c5c8e21ca dirty`, gate
`f44bda9a4742cb61`, config `6587d6b2e6300a8e`, context
`4186a11d2ef809af`, `AI_MODE=gate`, `MIN_AI_QUALITY=4`.
Runtime comparison: `not checked` — local Redis has matching gate mode and
quality threshold, but remote runtime lineage and execution evidence were not
available.

### Outcome and tail risk

| Window | Gate | N | WR | PF | PnL | MaxDD | Loss streak | Losing months |
| ------ | ---- | --: | --: | --: | --: | ----: | ----------: | ------------- |
| full | current | 377 | 59.7% | 1.89 | 1478.83 | 53.92 | 5 | 0 |
| 180d | current | 210 | 56.7% | 1.67 | 670.14 | 53.92 | 5 | 0 |
| 90d | current | 131 | 57.3% | 1.72 | 440.31 | 53.92 | 5 | 0 |
| 30d | current | 49 | 57.1% | 1.72 | 164.94 | 44.26 | 4 | 0 |
| 7d | current | 16 | 50.0% | 1.27 | 24.39 | 44.26 | 4 | 0 |

### Cadence and fan-out

| Window | Gate | Trades/day | Events/day | Active days | Events | Trades/event | p95 batch | Max batch | Top event count | Top event PnL |
| ------ | ---- | ---------: | ---------: | ----------: | -----: | -----------: | --------: | --------: | --------------: | ------------: |
| full | current | 1.036 | 0.745 | 42.5% | 271 | 1.39 | 3.00 | 29 | 7.7% | 25.5% |
| 180d | current | 1.167 | 0.961 | 53.0% | 173 | 1.21 | 2.00 | 9 | 4.3% | 15.4% |
| 90d | current | 1.456 | 1.178 | 57.1% | 106 | 1.24 | 2.00 | 9 | 6.9% | 23.4% |
| 30d | current | 1.633 | 1.333 | 74.2% | 40 | 1.23 | 1.00 | 9 | 18.4% | 62.5% |
| 7d | current | 2.286 | 2.143 | 100.0% | 15 | 1.07 | 2.00 | 2 | 12.5% | 10.3% |

### Risk-adjusted metrics

| Window | Gate | Sharpe | Sortino | Calmar | DD/gross | DD/PnL | Profit/day | Profit/month | Trades/week |
| ------ | ---- | -----: | ------: | -----: | -------: | -----: | ---------: | -----------: | ----------: |
| full | current | 6.22 | 10.93 | 27.52 | 1.7% | 3.6% | 4.06 | 123.72 | 7.254 |
| 180d | current | 5.31 | 9.11 | 25.20 | 3.2% | 8.0% | 3.72 | 113.32 | 8.167 |
| 90d | current | 6.26 | 10.82 | 33.12 | 5.1% | 12.2% | 4.89 | 148.91 | 10.189 |
| 30d | current | 6.61 | 11.42 | 45.34 | 11.2% | 26.8% | 5.50 | 167.35 | 11.433 |
| 7d | current | 3.49 | 5.61 | 28.73 | 39.1% | 181.5% | 3.48 | 106.05 | 16.000 |

### Quality and direction

| Slice | Gate | N | Events | WR | PF | PnL | MaxDD | Max batch |
| ----- | ---- | --: | -----: | --: | --: | --: | ----: | --------: |
| q4+ total | current | 377 | 271 | 59.7% | 1.89 | 1478.83 | 53.92 | 29 |
| q5+ | current | 0 | 0 | n/a | n/a | 0.00 | 0.00 | 0 |
| LONG q4+ | current | 0 | 0 | n/a | n/a | 0.00 | 0.00 | 0 |
| SHORT q4+ | current | 377 | 271 | 59.7% | 1.89 | 1478.83 | 53.92 | 29 |

### Runtime execution bridge

| Scope | Window | Approved | Attempts | Filled | Balance rejects | Other rejects | Requested notional | Max simultaneous stop-risk |
| ----- | ------ | -------: | -------: | -----: | --------------: | ------------: | -----------------: | -------------------------: |
| runtime | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

### Validation

| Partition | Rows | Events | Approved N | WR | PF | PnL | MaxDD | Max batch |
| -------------- | ---: | -----: | ---------: | --: | --: | --: | ----: | --------: |
| train | 13634 | 132 | 213 | 62.9% | 2.15 | 1001.81 | 52.38 | 29 |
| tuning | 4087 | 52 | 58 | 53.4% | 1.46 | 135.39 | 37.93 | 6 |
| untouched test | 4262 | 87 | 106 | 56.6% | 1.68 | 341.63 | 53.92 | 9 |

The timestamp-grouped partition mechanically contains `87` approved events in
the final split. It is not genuinely untouched evidence because this exact
merge was already used to select the BTC leadership rule on 2026-07-26.

### Acceptance checks

| Check | Status | Evidence |
| ------------------------- | ------ | -------- |
| Freshness | FAIL | Export tail is 4.81d behind research time. |
| Runtime lineage parity | UNKNOWN | Remote runtime SHA, gate/config/context fingerprints, and fills were not checked. |
| Independent-event support | PASS | 132 approved train events and 87 chronological final-split events. |
| Event concentration | FAIL | One 30d event contributes 62.5% of approved PnL, above the one-third limit. |
| Portfolio capacity | UNKNOWN | Live cap is undeclared; cap=5 stress overflows 44 full-history approvals and max batch is 29. |
| Symbol concentration | PASS | Largest symbol has 7/377 approvals (1.9%); no symbol can approach one-third of PnL at the observed trade count. |
| Temporal stability | PASS | All active months and all required terminal windows are profitable. |
| Untouched test | FAIL | The full merge was already used during prior gate selection. |

### Top reject reasons (30d)

| Rank | Reason | N | Share |
| ---: | ------ | --: | ----: |
| 1 | `insufficient_breakdown_distance` | 1563 | 92.4% |
| 2 | `insufficient_hourly_downside_impulse` | 1438 | 85.0% |
| 3 | `long_direction_not_validated` | 1202 | 71.1% |
| 4 | `btc_vs_alt_return_1h_below_stable_range` | 677 | 40.0% |
| 5 | `adx_di_minus_above_stable_range` | 112 | 6.6% |

Reject reasons overlap, so their shares are independently calculated against
the `1,691` rejected rows and do not sum to 100%.

### Conclusion

- Why: the current q4+ stream remains profitable in every required window,
  preserves 377 trades and 271 independent events, and has no losing active
  months.
- Residual risk: the export is stale, the 30d result is event-concentrated,
  live capacity is unknown, and the chronological final split is contaminated
  by prior selection.
- Next check: build a fresh RelativeRotation export containing at least 25 new
  post-2026-07-24 independent approval events, then rerun the same gate
  fingerprint with the real production position cap.

### Strategy-specific findings

#### Strategy intent and causal paths

RelativeRotation enters target symbols that materially rotate against BTC.
The core detector remains unchanged and both LONG and SHORT stay enabled in the
strategy configuration; the deterministic gate currently approves SHORT only.
No delayed execution, exit, order result, or outcome field participates in
approval.

#### Existing Gate Audit

| Pocket / group | Location | Classification | Evidence |
| --- | --- | --- | --- |
| Causal-context and freshness hard blocks | `guardrails.ts:140-171` | `keep` | Missing target/BTC, target structure, price, global leadership, or CMC freshness cannot approve. No row-count field promotes quality. |
| Primary SHORT breakdown | `guardrails.ts:195-204` | `keep` | 306 trades, 217 events, PnL 1272.45, PF 1.96, no losing months. Removing recovery lowers full cadence to 0.841/day and leaves one 7d trade. |
| Breadth recovery additions | `guardrails.ts:205-219` | `needs-more-data` | 71 trades/56 events overall, but only 14 train events and 6 tuning events; tuning PnL -15.43, PF 0.64. Keep unchanged only inside the observed combined gate; do not widen it. |
| BTC leadership filter | `guardrails.ts:220-244` | `keep` | Combined gate has 132 train and 87 final-split approved events with positive PnL, but needs genuinely new untouched evidence. |
| LONG downgrade | `guardrails.ts:173-175` | `keep` | LONG q4+ remains empty; no validated profitable LONG approval pocket was found. |

All implemented cutoffs are already rounded human-scale values. There are no
high-precision optimizer constants or data-availability counts in the current
approval logic.

#### Live-env parity and feature provenance

| Setting | Export/replay | Intended local runtime | Status |
| --- | --- | --- | --- |
| AI mode / quality | local deterministic / 4 | `gate` / 4 | matching approval semantics |
| Interval | 15m | strategy default 15m | matching locally |
| Strategy config | `q7r9bb`, backtest `MAX_LOSS_VALUE=10` | same detector values, `MAX_LOSS_VALUE=0.2` | gate inputs match; PnL/risk sizing differs |
| Derivatives | enabled, 48h, source 15m, derived 1h, target mode off, refs BNB/SOL/TRX/XRP | production server not checked | not used by this gate |
| CMC Fear & Greed | daily, complete/non-stale in all rows; default max age 48h | local env overrides unset | remote provider/cache parity unknown |
| Binance market context | aligned 15m context; BTC/ETH references | local env overrides unset | remote universe/cache parity unknown |

| Field path | Scope | Type | Causal | Environment dependency |
| --- | --- | --- | --- | --- |
| `structure.localRange.distanceToLowLevelAtr` | target | market/setup state | yes | target candles, ATR and level lookback |
| `regime.trend.adx.diMinus` | target | market state | yes | target candles and ADX window |
| `raw.price.price1hPct` | target | market state | yes | aligned target 1h window |
| `relative.marketBreadth.dispersion` | global | market state | yes | Binance breadth universe/provider |
| `relative.btcAltRegime.altBasketReturn1h` | global | market state | yes | aligned alt basket and 1h window |
| `relative.btcAltRegime.btcVsAltReturn1h` | global | market state | yes | BTC/alt universe and aligned 1h window |
| `relative.btcAltRegime.btcTurnoverShare24h` | global | market state | yes | Binance turnover provider and 24h window |
| `relative.cmcFearGreed.valueChange7d` | global | market state | yes | CMC daily provider/cache and 7d window |
| `relative.cmcFearGreed.stale` | global | data-quality guard | yes | CMC max-age policy; never promotes approval |
| `relative.targetVsBtc.*` | target vs benchmark | market state | yes | aligned target/BTC OHLCV |
| `regime.session.minutesToFundingWindow` | global | deterministic session state | yes | UTC timestamp and fixed 8h funding schedule; no provider dependency |

The global BTC/alt and CMC fields are combined with target-specific price,
structure, ADX, and target-vs-BTC evidence. The required fan-out stress was run
at capacities 1, 3, and 5 with runtime `MAX_LOSS_VALUE=0.2`.

#### Walk-forward, concentration, ablation, and negative control

| Gate / slice | N | Events | WR | PF | PnL | MaxDD | Trades/day | Max batch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current combined | 377 | 271 | 59.7% | 1.89 | 1478.83 | 53.92 | 1.036 | 29 |
| primary only | 306 | 217 | 60.8% | 1.96 | 1272.45 | 59.56 | 0.841 | 29 |
| recovery additions only | 71 | 56 | 54.9% | 1.59 | 206.38 | 60.89 | 0.195 | 8 |
| price floor -8 | 296 | 205 | 64.9% | 2.32 | 1520.27 | 57.06 | 0.814 | 28 |
| price -8 / ETH beta <= 2.8 | 273 | 189 | 67.0% | 2.55 | 1550.00 | 57.06 | 0.750 | 28 |
| exclude first 30m after funding | 346 | 243 | 61.6% | 2.04 | 1518.01 | 53.92 | 0.951 | 29 |

The new target filters improve full PF but fail the implementation decision:
they do not solve historical fan-out, reduce cadence below the practical
one-trade/day bound, increase maxDD, and leave last-7d PF at only `1.04` with
PnL `2.52`. They remain research-only.

The smallest promising cadence reduction is the causal session filter
`minutesToFundingWindow <= 435`, which excludes the first two 15-minute
decision slots after each 8-hour funding timestamp. Compared with the current
gate, it lowers full cadence by `8.2%` (`1.036 -> 0.951` trades/day) and raises
WR from `59.7%` to `61.6%`, PF from `1.89` to `2.04`, and PnL from `1478.83` to
`1518.01`. The 30d slice improves from WR `57.1%`, PF `1.72`, PnL `164.94`,
MaxDD `44.26`, and loss streak `4` to WR `64.3%`, PF `2.31`, PnL `215.97`,
MaxDD `32.86`, and loss streak `3`. The 7d slice improves from WR `50.0%` and
PF `1.27` to WR `57.1%` and PF `1.70`.

Timestamp-grouped partitions remain positive: train has 119 events, WR `64.1%`,
PF `2.27`; tuning has 48 events, WR `57.4%`, PF `1.71`; and the mechanically
chronological final split has 76 events, WR `58.5%`, PF `1.82`. The final split
is tuning evidence now because the same export was inspected to choose this
rule; it is not a new untouched test.

The prior inverse BTC-leadership negative control remains strongly negative:
104 trades, PnL `-237.30`, PF `0.68`, final-split PnL `-118.10`, and last-7d
PnL `-58.71`. A newly inspected liquidity-tail filter was also rejected:
although it improved aggregate PF, `nearestSellPressure.touches` is missing on
9,852 rows, so enforcement would conflate context availability with market
state.

The funding-window negative control supports the market interpretation rather
than an arbitrary time filter. The two excluded post-funding slots are weak
separately: `minutesToFundingWindow=465` has 21 trades, WR `42.9%`, PF `0.98`,
PnL `-2.46`; `minutesToFundingWindow=450` has 10 trades, WR `30.0%`, PF `0.53`,
PnL `-36.72`. Control exclusions at 240 and 15 minutes remove profitable
trades and worsen the gate. Excluding the exact funding timestamp improves
aggregate WR but worsens MaxDD and the max loss streak.

The largest full-history event contributes `7.7%` of count and `25.5%` of PnL,
but the largest 30d event contributes `62.5%` of PnL. The largest symbol
contributes `7/377` approvals. Capacity stress at cap `1/3/5` rejects
`106/63/44` full-history overflow approvals, with maximum simultaneous stop
risk `0.20/0.60/1.00`.

#### Thresholds, sensitivity, and boundary tests

| Field | Raw discovery | Implemented | Rounding / status |
| --- | ---: | ---: | --- |
| breakdown distance | around -2.75 ATR | `<= -2.75` | retained and rerun |
| DI- | around 50 | `<= 50` | retained and rerun |
| hourly price impulse | -4.80752% / -4.93151% | `<= -5%` | rounded stricter |
| recovery dispersion | 0.00732447 | `>= 0.0085` | rounded stricter |
| recovery alt return | -0.0171107 | `>= -0.015` | rounded stricter |
| Fear & Greed 7d change | -12 | `>= -12` | discrete boundary |
| BTC-vs-alt 1h | -0.00124625 | `>= -0.001` | rounded stricter |
| BTC turnover share 24h | 0.262606 | `>= 0.25` | explicitly relaxed for cadence; adjacent 0.24/0.25/0.26 stayed profitable |
| minutes to next funding | 435 minutes | not implemented | 420/435/450 sensitivity rerun; 435 best balances cadence and terminal quality |

The existing 16 RelativeRotation AI tests pass and cover exact boundaries,
just-above/below cases, recovery bypass prevention, missing/null inputs, and
stale CMC context. The updated ablation tool also has eight passing tests,
including the UTC-calendar active-day regression.

#### Rollout, cleanup, and blockers

No RelativeRotation gate source was changed in this revalidation: the
post-refactor rebuild reproduced gate fingerprint `f44bda9a4742cb61` and the
authoritative `ai-train` baseline exactly. No dead constants or prompt fields
were introduced.

The gate remains active because it is already profitable and removing the
recovery lane worsens combined risk-adjusted quality and current cadence.
However, all new candidate filters stay observation-only. Production promotion
or further enforcement is blocked on a fresh post-selection export, a declared
portfolio capacity/throttle, and lineage-matched remote runtime evidence.

Research artifacts:

```text
data/ai/output/relative-rotation-updated-skill-baseline-1785011628197.json
data/ai/output/relative-rotation-updated-skill-audit-1785011628197.json
data/ai/output/ai-pocket-search-relativerotation-merged-1785011628197-approved-2026-07-29T09-11-53Z.md
data/ai/output/relative-rotation-cadence-winrate-sweep-1785011628197.json
data/ai/output/relative-rotation-cadence-winrate-sensitivity-1785011628197.json
data/ai/output/relative-rotation-funding-window-sweep-1785011628197.json
data/ai/output/relative-rotation-funding-negative-control-1785011628197.json
```
