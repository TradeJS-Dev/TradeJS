# Grid AI Replay Notes

Last updated: 2026-07-22.

This file tracks deterministic `AI_MODE=gate` / `yarn ai-train --localOnly`
research for Grid.

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
