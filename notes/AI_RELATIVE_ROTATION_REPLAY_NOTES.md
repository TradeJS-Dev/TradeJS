# RelativeRotation AI Replay Notes

Last updated: 2026-07-21.

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
