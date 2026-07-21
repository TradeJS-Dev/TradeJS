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
