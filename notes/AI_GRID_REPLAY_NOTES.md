# Grid AI Replay Notes

Last updated: 2026-07-26.

This file tracks deterministic `AI_MODE=gate` / `yarn ai-train --localOnly`
research for Grid.

## Geometry-filtered gate rebuild (`2026-07-26`)

### Source export and lineage

The supplied post-refactor export consists of seven shards:

```text
data/ai/export/ai-dataset-grid-merged-1785011594102-part1.jsonl
...
data/ai/export/ai-dataset-grid-merged-1785011594102-part7.jsonl
```

- rows: `1,337`
- timestamp range: `2025-07-26T02:00:00.000Z .. 2026-07-24T01:45:00.000Z`
- span: `362.99d`
- data lag at the final replay: `1.83d`
- duplicate groups: `0`
- config id: `1r99w6`
- config fingerprint: `0fca5594623cb1ef`
- final gate fingerprint: `01eb7cbbbe136a06`
- q4+ context fingerprint: `37ff63212158a1a1`
- git SHA: `67ab05ba0df329af277341664258c30c0de01cbd`
- dirty: `true` (the rebuilt Grid gate and concurrent unrelated worktree
  changes were uncommitted)
- derivatives context: enabled, target context disabled, lookback `48h`, extra
  references `BNB,SOL,TRX,XRP`, source interval `15m`, derived interval `1h`

The export is much smaller than the previous `6,412`-row dataset because it was
produced after enabling the Grid geometry filter. Every exported row is an
`open` action; there are no `increase` rows. The replay therefore validates
initial entries, while scale-in market-pocket performance remains unknown.
Structural scale-in invariants are still covered by unit tests.

The Redis config was inspected but not changed. It keeps
`MAX_LOSS_VALUE=10`, `LONG.enable=true`, `SHORT.enable=true`, the `15m`
interval, and the selected geometry-filtered Grid detector parameters.

Authoritative replays:

```bash
AI_MODE=gate MIN_AI_QUALITY=4 yarn ai-train --strategy Grid \
  --file data/ai/export/ai-dataset-grid-merged-1785011594102-part1.jsonl \
  --localOnly --json -n 0 --terminalWindows=180,90,30,7 \
  --dumpEvaluations data/ai/output/grid-1785011594102-final-evaluations.jsonl \
  --dumpFeatures gateFeatures

AI_MODE=gate yarn ai-train --strategy Grid \
  --file data/ai/export/ai-dataset-grid-merged-1785011594102-part1.jsonl \
  --localOnly --json -n 0 --minQuality 5 \
  --terminalWindows=180,90,30,7
```

### Previous gate audit

Without a gate, all `1,337` geometry-filtered signals lose `441.86`.
The previous liquidation-dislocation gate still made `13.36` over `50`
approvals, but it no longer passed a time-ordered stability check:

| slice | approvals | PnL | PF | max DD | loss streak |
| --- | ---: | ---: | ---: | ---: | ---: |
| train 75% | 21 | -3.43 | 0.86 | 12.32 | 5 |
| validation 25% | 29 | 16.79 | 1.58 | 10.36 | 3 |
| full | 50 | 13.36 | 1.25 | 12.45 | 5 |

The old SHORT branch was rejected: `43` approvals made only `4.51` with
PF `1.09`. The old LONG branch was retained as a q5 compatibility pocket:
`7` approvals made `8.85` with PF `3.10` on this export, while the prior
larger export also had a positive LONG slice. Its current support is small, so
it must not be generalized or loosened without another export.

### Discovery, controls, and threshold stability

Pocket discovery reserved the trailing `25%` (`334` rows) for validation.
Absolute-price pockets were rejected as scale-dependent. Resistance-age rules
were rejected because their terminal window lost money and they accumulated
losing months. The opposite SOL OI direction was a useful negative control:
`78` SHORT approvals lost `30.92`, PF `0.70`. Applying the positive SOL OI
condition to LONG also failed: `31` approvals lost `20.06`, PF `0.57`.

The selected causal SHORT evidence is:

```ts
fresh SOLUSDT 15m oiChangePct1h >= 0.30
// or
fresh BNBUSDT 15m summary.directionAligned === true
```

The SOL threshold is inside a profitable rounded neighbourhood:

| SOL OI 1h min | approvals | PnL | PF | max DD | last7d PnL |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.20 | 88 | 56.10 | 1.96 | 11.33 | -2.98 |
| 0.25 | 80 | 67.11 | 2.65 | 7.93 | 3.96 |
| **0.30** | **71** | **73.87** | **3.53** | **5.59** | **2.94** |
| 0.35 | 60 | 57.07 | 3.17 | 5.59 | 2.94 |
| 0.40 | 47 | 54.61 | 5.07 | 3.54 | 2.94 |

`0.30` was selected over `0.25` because it improves full PnL, PF, drawdown,
loss streak, and month stability while giving up only nine q5 approvals.
The BNB q4 lane independently remained positive on train (`31`, `+17.49`,
PF `1.79`) and validation (`39`, `+32.17`, PF `2.31`).

Both features are signal-time causal. Reference derivative rows are resolved
at or before the last closed `15m` derivatives bar for the signal decision.
SOL `oiChangePct1h` is the raw reference interval feature. BNB
`directionAligned` is computed from the signal direction and fresh BNB
derivatives pressure/OI state. Missing or stale reference context cannot
approve an entry. No outcome, execution-delay, symbol allowlist, availability
count, or sample-count feature is used.

Research artifacts:

```text
data/ai/output/ai-pocket-search-grid-merged-1785011594102-all-2026-07-25T21-37-20Z.md
data/ai/output/ai-pocket-search-grid-merged-1785011594102-approved-2026-07-25T21-37-36Z.md
data/ai/output/grid-gate-ablation-round1-2026-07-26.json
data/ai/output/grid-gate-ablation-round2-2026-07-26.json
data/ai/output/grid-gate-ablation-round3-2026-07-26.json
data/ai/output/grid-gate-final-implemented-2026-07-26.json
data/ai/output/grid-1785011594102-final-evaluations.jsonl
```

### Implemented deterministic gate

- q5 LONG: fresh BTC benchmark liquidation total `>=2` while venue spread is
  `<=-0.0012`.
- q5 SHORT: fresh SOL `15m` OI growth over one hour is `>=0.30`.
- q4 SHORT: fresh BNB reference derivatives are aligned with the SHORT signal.
- q3: structurally valid signal outside the validated market pockets.
- q2: structural hard block.

The adapter pins approval and direction to the deterministic result. Existing
hard blocks still reject missing/mismatched signal and regime direction,
volatility shock, invalid open state, and invalid non-martingale increase
state.

### Final q4+ and q5+ metrics

The q4+ train/validation split is positive on both sides:

| slice | approvals | WR | PnL | PF | max DD | loss streak | losing months |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| train 75% | 51 | 68.6% | 27.69 | 1.82 | 5.35 | 2 | 0 |
| validation 25% | 79 | 72.2% | 76.28 | 2.86 | 7.44 | 3 | 0 |

Terminal metrics:

| stream | window | approvals | approvals/day | WR | PnL | PF | max DD | loss streak | losing months |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| q4+ | full | 130 | 0.36 | 70.8% | 103.97 | 2.39 | 7.44 | 3 | 0 |
| q4+ | 180d | 127 | 0.71 | 70.9% | 105.43 | 2.48 | 7.44 | 3 | 0 |
| q4+ | 90d | 76 | 0.84 | 72.4% | 71.59 | 2.79 | 7.44 | 3 | 0 |
| q4+ | 30d | 25 | 0.83 | 68.0% | 16.97 | 1.99 | 5.95 | 2 | 0 |
| q4+ | 7d | 3 | 0.43 | 66.7% | 1.98 | 3.06 | 0.96 | 1 | 0 |
| q5+ | full | 78 | 0.21 | 75.6% | 82.72 | 3.48 | 5.59 | 2 | 0 |
| q5+ | 180d | 77 | 0.43 | 75.3% | 82.37 | 3.47 | 5.59 | 2 | 0 |
| q5+ | 90d | 53 | 0.59 | 77.4% | 70.27 | 5.11 | 3.47 | 2 | 0 |
| q5+ | 30d | 15 | 0.50 | 66.7% | 14.13 | 2.53 | 3.43 | 2 | 0 |
| q5+ | 7d | 2 | 0.29 | 100.0% | 2.94 | n/a | 0.00 | 0 | 0 |

Direction split for q4+:

- LONG: `7`, PnL `+8.85`, PF `3.10`
- SHORT: `123`, PnL `+95.12`, PF `2.35`

Symbol concentration remains low: the largest symbol has `3` of `130`
approvals (`2.31%`). The q4+ stream is below the ideal `2-3` approvals/day
and slightly below the practical `1/day` target, but relaxing it with
resistance-age or lower SOL thresholds worsened terminal robustness. It now
does trade in the last `7d`, unlike the previous gate. Expected live cadence
remains unknown until a runtime with matching lineage is observed.

### Runtime contract

```text
AI_ENABLED=true
AI_MODE=gate
MIN_AI_QUALITY=4
INTERVAL=15
DERIVATIVES_CONTEXT_ENABLED=true
DERIVATIVES_CONTEXT_TARGET_ENABLED=false
DERIVATIVES_CONTEXT_LOOKBACK_HOURS=48
DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS=BNB,SOL,TRX,XRP
MAX_LOSS_VALUE=10
LONG.enable=true
SHORT.enable=true
```

`MIN_AI_QUALITY=5` selects the stricter q5 stream and excludes the BNB q4
lane. These results describe local deterministic `AI_MODE=gate`, not
`AI_MODE=llm`. Live parity additionally requires matching git SHA, gate
fingerprint, config id/fingerprint, context fingerprint, and environment.

## Post-refactor gate rebuild (`2026-07-22`)

### Source export and lineage

The supplied export consists of seven shards:

```text
data/ai/export/ai-dataset-grid-merged-1784732337555-part1.jsonl
...
data/ai/export/ai-dataset-grid-merged-1784732337555-part7.jsonl
```

- rows: `6,412`
- timestamp range: `2025-07-22T06:15:00.000Z .. 2026-07-19T10:45:00.000Z`
- span: `362.19d`
- data lag at final replay: about `3.25d`
- duplicate groups: `0`
- config id: `1ysqgb`
- config fingerprint: `028833a38c99e6e9`
- context fingerprint: `4186a11d2ef809af`
- final gate fingerprint: `289fe0638ff0a915`
- git SHA recorded by the export replay: `3f75056985e490dd8f96dc757d57a52324731cee`
- dirty: `true` (the Grid work and unrelated concurrent worktree changes were
  uncommitted)
- derivatives context: enabled, target context disabled, lookback `48h`, extra
  references `BNB,SOL,TRX,XRP`, source interval `15m`, derived interval `1h`

The local Redis JSON key `users:root:backtests:configs:Grid:ai` still matches
the exported detector/risk configuration, including `MAX_LOSS_VALUE=10`, both
LONG and SHORT enabled, and the selected Grid parameters. The research did not
mutate Redis.

Authoritative final replay:

```bash
yarn ai-train --strategy Grid \
  --file data/ai/export/ai-dataset-grid-merged-1784732337555-part1.jsonl \
  --localOnly --json -n 0 --terminalWindows=180,90,30,7
```

### Historical gate audit

After the strategy refactor, `packages/strategies/src/Grid/adapters/ai.ts`
only copied `gridContext`, rendered a prompt addon, and mapped runtime flags.
It had no deterministic `postProcessAnalysis` or Grid-specific guardrail
context. Consequently every one of the `6,412` rows was normalized to quality
`3`; q4+ and q5+ both approved zero rows at the research threshold of `4`.

The unfiltered candidate stream was not an acceptable fallback:

- PnL: `-2,342.63`
- LONG: `-825.14`
- SHORT: `-1,517.49`
- last180d: `-864.30`
- last90d: `-350.96`
- last30d: `-29.59`
- last7d: `-29.10`

### Pocket discovery and rejected hypotheses

The supplied report
`ai-pocket-search-grid-merged-1784732337555-all-2026-07-22T14-59-16Z.md`
used only `3-6` validation rows for its top pockets. Those candidates were
treated as exploratory and were not promoted.

A new full-export search reserved the trailing `25%` (`1,603` rows) for
time-ordered validation and required at least `100` train rows and `25`
validation rows. The reusable ablation tool then checked rounded thresholds,
directions, months, symbols, and terminal `180/90/30/7d` windows.

Rejected examples:

- BTC OI-growth rules were positive on the broad train/validation split but
  lost money in the last `30d` and `7d` windows.
- CMC fear/volume rules looked strong in a last90d-only search but were deeply
  negative on the older train regime. Absolute market-volume thresholds were
  not promoted.
- BTC-vs-alt rules were strong in the latest `30d/7d`, but negative across the
  full historical train slice.
- BNB direction-aligned price/OI expansion was positive when evaluated alone,
  but its rows outside the strict liquidation pocket were negative. It remains
  diagnostic context, not approval evidence.
- Adding SOL, ETH/TRX, BNB/OI, or BTC OI branches increased cadence but failed
  to add positive PnL in both train and validation.
- The misaligned BNB control produced `16` trades, PnL `-14.97`, PF `0.37`.
  The opposite-spread control had no matches.

Key research artifacts:

```text
data/ai/output/ai-pocket-search-grid-merged-1784732337555-all-2026-07-22T15-23-19Z.md
data/ai/output/ai-pocket-search-grid-last90d-2026-07-22.md
data/ai/output/ai-pocket-search-grid-last30d-2026-07-22.md
data/ai/output/grid-gate-final-ablation-2026-07-22.json
data/ai/output/grid-gate-incremental-ablation-2026-07-22.json
```

### Validated pocket and sensitivity

The final causal pocket is:

```ts
baseContext.relative.execution.venueSpread <= -0.0012 &&
baseContext.derivatives.intervals['15m'].liqTotal >= 2 &&
baseContext.derivatives.intervals['15m'].stale === false
```

With target derivatives context disabled, the top-level derivatives context is
the BTC benchmark context. The gate therefore uses benchmark liquidations, not
target-symbol derivatives. Both inputs are resolved at the signal timestamp.

The chosen rounded threshold is inside a profitable neighbourhood:

| spread max | liq min | train N | train PnL | train PF | validation N | validation PnL | validation PF | full PnL | full PF | last30d PnL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| -0.0010 | 2.0 | 132 | 75.76 | 1.84 | 207 | 166.99 | 2.07 | 242.75 | 1.99 | 1.88 |
| **-0.0012** | **2.0** | **116** | **55.66** | **1.67** | **158** | **159.26** | **2.59** | **214.92** | **2.18** | **15.21** |
| -0.0014 | 2.0 | 104 | 54.31 | 1.74 | 88 | 48.13 | 1.68 | 102.44 | 1.71 | 10.59 |
| -0.0012 | 1.7 | 128 | 40.81 | 1.39 | 171 | 160.24 | 2.45 | 201.05 | 1.94 | 11.44 |
| -0.0012 | 2.5 | 110 | 55.59 | 1.72 | 137 | 138.58 | 2.60 | 194.17 | 2.19 | 13.37 |

The looser `-0.0010` spread boundary was not selected because its last30d edge
was nearly flat and its last7d slice lost `6.50`. The selected `-0.0012`
boundary preserves materially better terminal robustness without relying on an
exact pocket-search value.

### Implemented gate

The adapter now builds a deterministic guardrail context and pins the final
analysis to it. Approval receives quality `5`; valid Grid signals outside the
pocket receive quality `3`; structurally invalid signals receive quality `2`.
There is deliberately no q4 lane because none added positive PnL in both train
and validation.

Structural hard blocks cover:

- missing or mismatched signal/regime direction;
- volatility shock;
- invalid `open` level state;
- invalid `increase` level state, including a projected quantity that does not
  grow.

The same gate is applied to initial entries and non-martingale scale-ins. The
adapter pins approved direction to the strategy signal, so an LLM cannot reverse
the trade or promote an unvalidated row.

### Metrics after implementation

q4+ and q5+ are currently identical because every approval is assigned q5:

- approvals: `274`
- win rate: `70.1%`
- PnL: `+214.92`
- PF: `2.18`
- max drawdown: `33.97`
- max drawdown / gross profit: `8.5%`
- largest loss: `-3.60`
- max loss streak: `6`
- approvals/day over the full export span: `0.76`
- losing active months: `1`

Terminal windows:

| window | approvals | approvals/calendar day | WR | PF | PnL |
| --- | ---: | ---: | ---: | ---: | ---: |
| full | 274 | 0.76 | 70.1% | 2.18 | 214.92 |
| last180d | 274 | 1.52 | 70.1% | 2.18 | 214.92 |
| last90d | 158 | 1.76 | 70.9% | 2.59 | 159.26 |
| last30d | 61 | 2.03 | 57.4% | 1.31 | 15.21 |
| last7d | 0 | 0.00 | n/a | n/a | 0.00 |

The zero-approval last7d window is intentional and must not be hidden: the `104`
raw signals in that period lost `29.10`, and the tested relaxed branches either
lost money or failed historical stability. The gate still meets the requested
trade objective over the terminal `30d` window with `61` approvals, but current
live cadence is unknown until the same lineage is deployed and observed.

Direction split:

- LONG: `32` approvals, PnL `+18.37`, PF `1.72`
- SHORT: `242` approvals, PnL `+196.55`, PF `2.25`

Symbol concentration is low: the largest symbol contributes `4` of `274`
approvals (`1.46%`). No symbol allowlist or outcome-derived field is used.

### Runtime contract

The validated runtime must preserve:

```text
AI_ENABLED=true
AI_MODE=gate
MIN_AI_QUALITY=4 (or 5; both select the same current q5 stream)
INTERVAL=15
DERIVATIVES_CONTEXT_ENABLED=true
DERIVATIVES_CONTEXT_TARGET_ENABLED=false
DERIVATIVES_CONTEXT_LOOKBACK_HOURS=48
MAX_LOSS_VALUE=10
LONG.enable=true
SHORT.enable=true
```

It must also provide fresh `baseContext.relative.execution.venueSpread` and the
fresh top-level BTC `15m` derivatives interval. Missing or stale inputs reject
the signal. These results validate local deterministic `AI_MODE=gate`, not
external `AI_MODE=llm`, and do not prove live-runtime parity unless git SHA,
gate fingerprint, config id, context fingerprint, and the runtime environment
match.
