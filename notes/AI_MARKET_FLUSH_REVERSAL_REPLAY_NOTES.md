# MarketFlushReversal AI Gate Research

## Strategy intent

MarketFlushReversal looks for local flush-reversal structure. The core currently
keeps only the previously calibrated LONG rebound universe and leaves SHORT
candidates available for later gate validation. This research changes only the
deterministic AI gate; it does not remove or retune the core LONG prefilter.

## 2026-07-20 - post-refactor gate rebuild

Export: `1784544406184` (7 parts), 61,200 rows, window
`2025-07-20T06:15:00Z` .. `2026-07-19T16:00:00Z`, lag `0.81d`.

Lineage: git `b25ae3ef0295396bc9121b8d044eecd8d81f1f0e` (dirty research
diff), gate `a128514d131d38f5`, config `1dd4a1bffe33975f` (`1lkz4j`),
context `4186a11d2ef809af`, `MIN_AI_QUALITY=4`, `AI_MODE=gate`.

Change: replace the old AI approval pocket with a LONG-only causal pocket using
`baseContext.gateFeatures.setup.stopDistanceAtr >= 24`,
`baseContext.relative.cmcIndexes.indexRegime == risk_off`, non-stale CMC index
context, and `baseContext.regime.momentum.rsiState == oversold`.

Replay mode: `yarn ai-train --localOnly --json -n 0`; this matches
`AI_MODE=gate`, not `AI_MODE=llm`. The permanent ablation baseline matched the
authoritative replay exactly before candidate interpretation.

Redis config `users:root:backtests:configs:MarketFlushReversal:ai` has both
LONG and SHORT enabled, `AI_ENABLED=true`, `AI_MODE=gate`,
`MIN_AI_QUALITY=4`, `MAX_LOSS_VALUE=10`, and config grid risk ratio `1.2`.
The strategy default interval is 15 minutes.

### Before vs after, q4+

All approved rows are quality 5, so q3+, q4+, and q5+ are identical.

| Period | Gate | N | WR | PF | Sharpe | Sortino | Calmar | PnL | MaxDD | Loss streak | Losing months | Trades/day |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | before | 1,133 | 57.5% | 0.71 | -2.43 | -2.96 | -0.99 | -341.06 | 343.90 | 15 | 7 | 3.109 |
| full | after | 846 | 70.7% | 2.21 | 7.94 | 12.86 | 10.95 | 238.76 | 21.84 | 6 | 0 | 2.322 |
| 180d | before | 825 | 56.8% | 0.67 | -3.49 | -4.21 | -1.90 | -292.98 | 312.07 | 15 | 6 | 4.583 |
| 180d | after | 396 | 63.9% | 1.68 | 5.05 | 7.70 | 7.79 | 74.02 | 19.26 | 6 | 0 | 2.200 |
| 90d | before | 402 | 56.7% | 0.64 | -3.84 | -4.62 | -3.14 | -172.92 | 223.19 | 7 | 3 | 4.467 |
| 90d | after | 193 | 64.2% | 1.96 | 6.59 | 11.84 | 10.18 | 48.34 | 19.26 | 6 | 0 | 2.144 |
| 30d | before | 95 | 51.6% | 0.44 | -5.67 | -6.23 | -12.17 | -71.09 | 71.09 | 5 | 2 | 3.167 |
| 30d | after | 38 | 50.0% | 1.26 | 1.65 | 2.90 | 5.14 | 4.21 | 9.97 | 5 | 1 | 1.267 |
| 7d | before | 19 | 47.4% | 0.37 | -6.78 | -7.26 | -35.99 | -22.94 | 33.24 | 4 | 1 | 2.714 |
| 7d | after | 5 | 60.0% | 4.34 | 7.25 | 29.01 | 174.32 | 4.58 | 1.37 | 2 | 0 | 0.714 |

Full-window after metrics: max drawdown is 5.0% of gross profit and 9.1% of
total profit; average approved PnL is 0.66/day and 19.94/month; cadence is
16.25 trades/week. The only losing partial month in terminal windows is
`2026-06: -7.77` inside the trailing 30-day cut. Full calendar-month stability
is 13/13 profitable months.

Risk-adjusted quality improved together with PF and drawdown; this is not only
a trade-count reduction. The seven-day sample is positive and still trades,
but its `0.71/day` cadence is below the usual one-trade/day lower bound and
must be watched in live observation.

### Previous commit gate audit

| Version | Behavior on this export | Classification |
| --- | --- | --- |
| `80d9cb65`, `2eb9d9b6` | No deterministic post-process gate. Local replay defaults to q3, so `MIN_AI_QUALITY=4` approves 0 trades. Raising all 61,200 rows to q5 is a negative control: PnL -329,487.59, PF 0.39. | replace |
| `52acef79` | Introduced the old LONG calibrated pocket and broad-market hard blocks. Current-export result is 1,133 trades, PnL -341.06, PF 0.71. | replace |
| `a830d5fd` .. pre-change HEAD | Moved the same thresholds into `pockets.ts` and added the same LONG pocket to core; AI-gate semantics stayed unchanged. | replace in AI gate; needs new export before changing core |

Existing rule groups:

- Local structure and participation confirmation: keep. They are causal core
  invariants and all exported candidates already passed the detector path.
- Old `targetVsBtc.ratioReturn24h <= -3.3` plus ETH/BTC volume or H1 range
  branch: replace for AI approval. Keep only as the current core universe until
  a fresh export can measure removing it.
- Broad-market flush confirmation/mismatch and missing/stale BTC benchmark
  derivatives: move from approval blocks to risk annotations. Intersecting the
  new pocket with the old broad-flush gate gives only 169 trades, 30d PnL
  `-4.64`, and zero 7d trades.
- SHORT block: keep. The selected pocket produced only LONG approvals and the
  unfiltered SHORT universe loses `-326,734.47` at PF `0.39`.
- No data-count or availability-count field promotes approval.

### Validation evidence

Acceptance gates used: validation support at least 25, no symbol above one
third of count or profit, no new losing-month cluster, no worse loss streak,
PF above 1.2 with lower drawdown, and useful cadence in terminal windows.

| Split | N | WR | PF | PnL | MaxDD | Loss streak | Losing months | Trades/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| train | 653 | 72.6% | 2.30 | 190.42 | 21.84 | 6 | 0 | 2.339 |
| trailing validation | 193 | 64.2% | 1.96 | 48.34 | 19.26 | 6 | 0 | 2.264 |

The top-count symbol is `HUSDT` with 8/846 approvals (under 1% of count) and
PnL `2.86`; no symbol approaches one third of approved count or PnL. Monthly
results remain positive across the full 13-month export.

Ablation:

| Variant | N | PF | PnL | MaxDD | 30d PnL | 7d PnL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| old gate baseline | 1,133 | 0.71 | -341.06 | 343.90 | -71.09 | -22.94 |
| raw pocket, `stopDistanceAtr >= 23.5796` | 848 | 2.25 | 247.32 | 21.84 | 4.21 | 4.58 |
| implemented rounded pocket, `>= 24` | 846 | 2.21 | 238.76 | 21.84 | 4.21 | 4.58 |
| old gate AND implemented pocket | 169 | 1.34 | 15.45 | 9.84 | -4.64 | 0.00 |

Negative control: invert the distance side to `stopDistanceAtr <= 23` while
keeping risk-off CMC and oversold RSI. It yields 68 trades, PnL `-130.21`, PF
`0.67`, and eight losing months. This rejects the hypothesis that any nearby
three-feature slice looks profitable.

Threshold sensitivity is stable at 22, 23, 24, and 25 ATR. The raw optimizer
cutoff was `23.5796`; the implemented cutoff is the stricter rounded value
`24`. At 26 ATR, PnL falls to `230.28`, PF to `2.17`, and one losing month
appears, so 24 is the defensible boundary.

### Live-env parity and feature provenance

| Field | Source and causality | Type | Env sensitivity |
| --- | --- | --- | --- |
| `gateFeatures.setup.stopDistanceAtr` | Signal-time `(currentPrice - stopLossPrice) / ATR` for LONG, rebuilt from the signal order plan | setup market state | Depends on stop construction, ATR, strategy config, and signal-builder semantics |
| `relative.cmcIndexes.indexRegime` | CMC20/CMC100 daily snapshot resolved at or before the signal | market state | Depends on CMC provider/backfill, max-age, and index-regime construction |
| `relative.cmcIndexes.stale` | CMC index freshness check | data-quality guard only | Depends on CMC max-age/runtime ingestion |
| `regime.momentum.rsiState` | RSI from the closed-candle base context; `oversold` is RSI <= 30 | market state | Depends on indicator warmup and RSI construction |
| top-level `derivatives.*` | BTC benchmark Coinalyze context, not target-symbol derivatives | annotation only after change | 48h lookback, source 15m, derived 1h, target mode false |

Recorded context: derivatives enabled, target context disabled, 48h lookback,
extra references `BNB,SOL,TRX,XRP`, 15m source with derived 1h context, data
model v2. CMC env overrides were unset in the replay, while every row carried
non-stale CMC index context. Production requires the same CMC index availability.
The actual remote runtime env is not available locally, so production parity
is not proven until its gate/config/context fingerprints are compared.

### Implementation and rollout

- Implemented immediate deterministic enforcement because the request was to
  rebuild the gate and restore profitable trading; this is not a passive-only
  candidate.
- Added boundary coverage at 24 ATR, just below 24, missing/null values, stale
  CMC, non-risk-off CMC, neutral/missing RSI, SHORT rejection, and derivative
  outage annotations.
- Added `pockets.ts` to gate fingerprint inputs so future threshold changes
  receive a new lineage.
- Core and backtest config were not changed. Removing the old core LONG pocket,
  validating SHORT, or changing stop construction requires a fresh AI export.
- Monitor 7d cadence and compare remote runtime lineage before claiming live
  production parity.

Research artifacts:

- `data/ai/output/ai-pocket-search-marketflushreversal-merged-1784544406184-all-2026-07-20T10-49-56Z.md`
- `data/ai/output/marketflushreversal-gate-ablation-1784544406184-v1.json`
- `data/ai/output/marketflushreversal-gate-ablation-1784544406184-v2.json`
- `data/ai/output/marketflushreversal-gate-ablation-1784544406184-v3.json`
