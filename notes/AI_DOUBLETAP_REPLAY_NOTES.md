# DoubleTap AI Replay Notes

Last updated: 2026-07-20.

This file keeps internal notes for `ai-train` replay windows and DoubleTap AI gate analysis.

## Post-Refactor Gate Rebuild (`2026-07-20`)

Latest logical export:

```bash
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part1.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part2.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part3.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part4.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part5.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part6.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784540416971-part7.jsonl
```

Research artifacts:

```bash
data/ai/output/ai-pocket-search-doubletap-merged-1784540416971-all-2026-07-20T09-40-37Z.md
data/ai/output/doubletap-ai-train-1784540416971-current.json
data/ai/output/doubletap-evals-1784540416971-current.jsonl
data/ai/output/doubletap-gate-commit-comparison-1784540416971.json
data/ai/output/doubletap-ablation-1784540416971-current-filters.md
data/ai/output/doubletap-ablation-1784540416971-long-filters.md
data/ai/output/doubletap-ai-train-1784540416971-final.json
data/ai/output/doubletap-evals-1784540416971-final.jsonl
data/ai/output/doubletap-ablation-1784540416971-final.md
```

Replay mode:

```bash
yarn ai-train --file data/ai/export/ai-dataset-doubletap-merged-1784540416971-part1.jsonl --localOnly --json -n 0 --minQuality 4 --terminalWindows=180,90,30,7 --dumpEvaluations data/ai/output/doubletap-evals-1784540416971-final.jsonl --dumpFeatures baseContext
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --file data/ai/export/ai-dataset-doubletap-merged-1784540416971-part1.jsonl --minQuality 4 --terminalWindows=365,180,90,30,7 --includeGateContext --featurePattern 'approvalPocket|q4DerivativesPocket|q4DerivativesCmcRiskOk|q4DerivativesDirectionSessionOk|signalDirection|primarySession|roc1d|btcVsAltReturn24h|cmc20ToCmc100RatioChange24hPct|solFundingZScore15m|ethCrowdingPersistenceBars|targetVsEth|targetVsBtc|marketBreadth|btcAltRegime.regime' --output data/ai/output/doubletap-ablation-1784540416971-final.md
```

Interpretation:

- deterministic `AI_MODE=gate` research only; this does not measure provider/LLM behavior
- `MIN_AI_QUALITY=4`
- export period: `2025-07-19T20:30:00.000Z` -> `2026-07-19T12:00:00.000Z`
- rows: `5953`; shards: `7`; duplicates: `0`; span: `364.65d`
- raw candidate stream is still losing: all-row average PNL `-0.78` per row in the final run
- final gate keeps q5 high precision unchanged and narrows only q4 derivatives LONG approvals

Previous gate/commit audit:

- current cleanup before this change was profitable full-history but had a bad fresh tail: last 7d `10` approvals, WR `30.0%`, PF `0.71`, PNL `-17.77`, maxDD `44.90`, max loss streak `4`
- commit `0ea7449b` had higher full PNL (`+787.33`) but worse tail and risk: last 7d `12` approvals, WR `25.0%`, PF `0.52`, PNL `-39.12`, maxDD `66.25`, loss streak `6`
- older stricter gates (`6de18017`, `bb656e19`, `caa1e029`, `9bbaa719`, `f64d45bd`) either had very low cadence or negative 90d/30d/7d windows on this export
- simple rollback was rejected; the stable fix was LONG-side cleanup on the current derivatives pocket

Implemented gate decision:

- keep q5 high-precision CMC pocket unchanged
- keep q4 derivatives SHORT approvals unchanged
- keep q4 derivatives CMC/BTC loss blocker unchanged
- add `q4DerivativesDirectionSessionOk`
- approve q4 derivatives LONG only when `primarySession === 'europe'`
- block q4 derivatives LONG outside Europe with `long_q4_derivatives_outside_europe_session`

Before/after on merge `1784540416971`, q4+:

| Window | Before N | Before WR | Before PF | Before PNL | Before DD | Before LS | Before Trades/Day | After N | After WR | After PF | After PNL | After DD | After LS | After Trades/Day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full / ~365d | 151 | 57.0% | 1.93 | +628.38 | 95.57 | 6 | 0.414 | 98 | 64.3% | 2.61 | +577.63 | 32.18 | 3 | 0.269 |
| 180d | 143 | 55.9% | 1.87 | +564.74 | 95.57 | 6 | 0.796 | 90 | 63.3% | 2.52 | +513.99 | 32.18 | 3 | 0.501 |
| 90d | 127 | 53.5% | 1.70 | +422.74 | 95.57 | 6 | 1.411 | 84 | 61.9% | 2.37 | +448.11 | 32.18 | 3 | 0.933 |
| 30d | 64 | 56.3% | 1.86 | +246.38 | 66.98 | 6 | 2.137 | 45 | 60.0% | 2.21 | +214.11 | 22.78 | 2 | 1.503 |
| 7d | 10 | 30.0% | 0.71 | -17.77 | 44.90 | 4 | 1.477 | 5 | 60.0% | 8.07 | +37.52 | 5.31 | 2 | 0.739 |

Final q4+ metrics:

- approved: `98`
- WR: `64.3%`
- PNL: `+577.63`
- PF: `2.61`
- max DD: `32.18`
- max DD / gross profit: `3.4%`
- max DD / total profit: `5.6%`
- max loss streak: `3`
- approved trades/day: `0.269` full, `1.503` last 30d, `0.739` last 7d
- losing approved months: `0`

Final direction split:

- LONG: `15` approved, WR `53.3%`, PF `1.66`, PNL `+49.47`, maxDD `46.78`, maxLS `4`, trades/day `0.041`
- SHORT: `83` approved, WR `66.3%`, PF `2.86`, PNL `+528.16`, maxDD `39.93`, maxLS `3`, trades/day `0.228`
- SHORT remains the main edge; LONG is now a small positive contributor rather than the drawdown source

Final feature inventory highlights:

- `q4DerivativesPocket`: `196` true rows
- `q4DerivativesDirectionSessionOk`: `124` true, `72` false, `5757` null
- `approvalPocket`: `q4_derivatives:88`, `q4_derivatives_blocked:106`, `high_precision:15`, `high_precision_blocked:40`, `q4_blocked:179`, `watch:5525`
- SOL 15m funding remains sparse: `2396` numeric rows, `3557` null rows
- ETH crowding persistence is present in `2628` rows
- `additionalIndicators.marketContext.relative.*` is present and mirrors the causal relative fields available through `baseContext`

Rejected follow-ups from this pass:

- `short-only` was safer than the old cleanup but lost useful LONG Europe rows: full `83` approvals, WR `66.3%`, PF `2.86`, PNL `+528.16`, last 30d PNL `+137.32`
- `short-or-long-high-precision` was close to short-only: full `84` approvals, PNL `+544.00`, last 30d PNL `+137.32`
- `short-or-long-offhours` made the 7d tail positive but had weaker full/30d metrics than Europe-only LONG q4 derivatives
- absolute OI/liquidation pockets from the pocket report were not promoted because they are market-size-level sensitive and did not beat the final tail/risk tradeoff

Code and tests:

- adapter: `packages/strategies/src/DoubleTap/adapters/ai.ts`
- tests: `packages/strategies/src/DoubleTap/__tests__/ai.test.ts`
- targeted verification:
  - `yarn workspace @tradejs/strategies build`
  - `yarn workspace @tradejs/node build`
  - `yarn workspace @tradejs/cli build`
  - `yarn jest packages/strategies/src/DoubleTap/__tests__/ai.test.ts --runInBand`

Remaining concerns / next tuning:

- last 7d is profitable but only `5` approvals; cadence is acceptable for 30d but thin for the newest week
- if we need more approved trades later, research should focus on normalized LONG recovery pockets, not absolute open-interest/liquidation thresholds
- keep monitoring SOL reference funding coverage because missing SOL blocks the derivatives pocket by design

## Post-Refactor Gate Cleanup (`2026-07-18`)

Latest logical export:

```bash
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part1.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part2.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part3.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part4.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part5.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part6.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784373494652-part7.jsonl
```

Research artifacts:

```bash
data/ai/output/ai-pocket-search-doubletap-merged-1784373494652-all-2026-07-18T11-19-12Z.md
data/ai/output/doubletap-ablation-1784373494652-cleanup-v2.md
data/ai/output/doubletap-ai-train-1784373494652-cleanup-v2.json
data/ai/output/doubletap-evals-1784373494652-cleanup-v2.jsonl
```

Replay mode:

```bash
yarn ai-train --file data/ai/export/ai-dataset-doubletap-merged-1784373494652-part1.jsonl --localOnly --json -n 0 --minQuality 4 --terminalWindows=180,90,30,7 --dumpEvaluations data/ai/output/doubletap-evals-1784373494652-cleanup-v2.jsonl --dumpFeatures baseContext
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --file data/ai/export/ai-dataset-doubletap-merged-1784373494652-part1.jsonl --minQuality 4 --terminalWindows=365,180,90,30,7 --includeGateContext --featurePattern 'approvalPocket|q4DerivativesPocket|q4DerivativesCmcRiskOk|q4AltDispersionOk|strictMomentumRoc1dOk|signalDirection|roc1d|btcVsAltReturn24h|cmc20ToCmc100RatioChange24hPct|solFundingZScore15m|marketBreadth.pctAboveMa20|targetVsBtc.ratioReturn24h|btcAltRegime.regime' --output data/ai/output/doubletap-ablation-1784373494652-cleanup-v2.md
```

Interpretation:

- deterministic `AI_MODE=gate` research only; this does not measure provider/LLM behavior
- `MIN_AI_QUALITY=4`
- export period: `2025-07-17T20:15:00.000Z` -> `2026-07-16T00:30:00.000Z`
- rows: `5949`; shards: `7`; span: `363.18d`
- `365d` terminal report is effectively the full export window because the export is shorter than 365 calendar days
- `additionalIndicators.marketContext.relative.*` is present in this export and matches the baseContext relative fields used in the gate
- `approvalPocket` after cleanup: `watch:5564`, `q4_blocked:182`, `q4_derivatives:117`, `q4_derivatives_blocked:31`, `high_precision_blocked:40`, `high_precision:15`
- SOL 15m reference funding is still sparse: `1805` numeric rows, `4144` null rows; missing SOL blocks only the derivatives pocket

Decision:

- keep q5 high-precision CMC pocket as the only structural approval path
- keep q4 derivatives reference pocket
- demote the legacy structural q4 CMC pocket to observation/block context; it no longer gives `quality=4` or local approval
- reject the new report's absolute OI/liquidation candidates for now: XRP/BNB adds full-history PNL but worsens 30d/7d; TRX liquidation adds too few rows and is overfit to absolute market-size levels

Before/after on merge `1784373494652`, q4+:

| Window | Before N | Before WR | Before PF | Before PNL | Before DD | Before LS | After N | After WR | After PF | After PNL | After DD | After LS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full / ~365d | 149 | 61.1% | 2.30 | +782.76 | 79.37 | 5 | 127 | 59.8% | 2.14 | +613.45 | 95.57 | 5 |
| 180d | 130 | 58.5% | 2.08 | +602.07 | 79.37 | 5 | 119 | 58.8% | 2.07 | +549.81 | 95.57 | 5 |
| 90d | 109 | 55.0% | 1.81 | +407.29 | 79.37 | 5 | 103 | 56.3% | 1.87 | +407.81 | 95.57 | 5 |
| 30d | 57 | 56.1% | 1.83 | +215.82 | 44.43 | 5 | 53 | 60.4% | 2.09 | +248.12 | 33.48 | 3 |
| 7d | 13 | 53.8% | 1.69 | +45.46 | 43.43 | 4 | 11 | 63.6% | 2.51 | +66.81 | 22.08 | 2 |

Post-cleanup q4+ metrics:

- approved: `127`
- WR: `59.8%`
- PNL: `+613.45`
- PF: `2.14`
- max DD: `95.57`
- max DD / gross profit: `8.3%`
- max DD / total profit: `15.6%`
- max loss streak: `5`
- approved trades/day: `0.35` full, `1.77` last 30d, `1.57` last 7d
- losing approved months: `0`

Direction split after cleanup:

- LONG: `48` approved, WR `52.1%`, PF `1.67`, PNL `+157.14`, maxDD `125.23`, maxLS `8`
- SHORT: `79` approved, WR `64.6%`, PF `2.52`, PNL `+456.31`, maxDD `39.93`, maxLS `3`
- SHORT remains much cleaner; LONG still contributes positive PNL but remains the main drawdown source

Rejected candidate checks:

| Variant | Full N | Full WR | Full PF | Full PNL | 30d PNL | 7d PNL | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| current before cleanup | 149 | 61.1% | 2.30 | +782.76 | +215.82 | +45.46 | profitable but weaker terminal 30d/7d |
| no legacy q4 | 127 | 59.8% | 2.14 | +613.45 | +248.12 | +66.81 | implemented |
| add XRP/BNB/ROC pocket | 231 | 60.2% | 2.18 | +1140.47 | +193.61 | +13.17 | rejected: hurts fresh terminal and adds loss streak |
| replace with XRP/BNB/ROC pocket | 95 | 61.1% | 2.16 | +470.24 | -35.65 | -32.29 | rejected |
| no legacy q4 plus XRP/BNB/ROC | 214 | 59.3% | 2.07 | +989.75 | +225.91 | +34.52 | rejected: worse than simple cleanup in 30d/7d |
| no legacy q4 plus TRX liquidation | 132 | 59.8% | 2.14 | +632.04 | +248.12 | +66.81 | rejected: only 5 added rows, absolute liquidation threshold |

Code and tests:

- adapter: `packages/strategies/src/DoubleTap/adapters/ai.ts`
- tests: `packages/strategies/src/DoubleTap/__tests__/ai.test.ts`
- targeted verification: `yarn jest packages/strategies/src/DoubleTap/__tests__/ai.test.ts --runInBand`

Remaining concerns / next tuning:

- full-history PNL and DD are worse than the previous combined gate, but the cleanup better matches the post-refactor fresh windows and keeps terminal cadence above `1.5` approvals/day
- LONG side still has poor drawdown characteristics; the next useful research should be LONG-specific rather than adding broad derivatives reference pockets
- absolute openInterest/liquidation pockets from the search report should not be promoted without a normalized or percentile form

## Derivatives Refactor Gate Rebuild (`2026-07-15`)

Latest logical export:

```bash
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part1.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part2.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part3.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part4.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part5.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part6.jsonl
data/ai/export/ai-dataset-doubletap-merged-1784107002034-part7.jsonl
```

Replay mode:

```bash
yarn ai-train --file data/ai/export/ai-dataset-doubletap-merged-1784107002034-part1.jsonl --localOnly --json -n 0 --minQuality 4 --dumpEvaluations /tmp/doubletap-evals-1784107002034-gate-v2-fixed.jsonl --dumpFeatures baseContext
```

Interpretation:

- deterministic `AI_MODE=gate` research only; this does not measure provider/LLM behavior
- `MIN_AI_QUALITY=4`
- export period: `2025-07-15T07:30:00.000Z` -> `2026-07-14T15:30:00.000Z`
- rows: `5780`; shards: `7`; duplicates: `0`
- data lag at replay time: about `0.76d`
- baseContext, CMC global, CMC indexes, and derivatives referenceContexts are present in all rows
- top-level derivatives interval context is present in `3926 / 5780` rows
- SOL 15m reference funding is present in `1642 / 5780` rows; ETH reference crowding persistence is present in `2402 / 5780`
- `targetContext` and `targetDerived` are absent in the new export, expected with `DERIVATIVES_CONTEXT_TARGET_ENABLED=false`
- `marketContext` root/payload is absent, same as the previous export lineage
- largest timestamp gap is `2026-06-26T20:30:00.000Z` -> `2026-07-03T03:45:00.000Z`; the same gap exists in the previous merge, so it is not a new fast-export regression

Existing gate audit:

- keep q5 high-precision CMC pocket: compact legacy high-precision shape, active session window, execution score `>=35`, lowTouchCount20 `>=1`, volume structure aligned, no benchmark conflict, CMC alt volume change `<=0.5`
- keep q4 structural CMC pocket: compact legacy structural shape, active session window, execution score `>=35`, lowTouchCount20 `>=1`, `-0.3 < btcDominanceChange24hPct <= -0.05`, and `altDispersion24h < 0.06`
- keep strict ROC `>= -5.25` for structural q4/q5 approvals only
- add q4 derivatives reference pocket: `btcVsAltReturn24h <= -0.009`, ETH reference `crowdingPersistenceBars >= 140`, SOL reference 15m `fundingZScore <= 0.2`
- add CMC/BTC loss blocker for that derivatives pocket only: reject when `btcVsAltReturn24h <= -0.014` and `cmc20ToCmc100RatioChange24hPct <= -0.0007`
- do not use derivatives row counts, points, or availability as approval evidence; missing SOL/ETH derivative fields block the derivatives pocket

Feature provenance:

- `btcVsAltReturn24h`: `baseContext.relative.btcAltRegime.btcVsAltReturn24h`, with gateFeatures fallback; causal market-state field from aligned benchmark/alt basket context
- `ethCrowdingPersistenceBars`: `baseContext.derivatives.referenceContexts.ETHUSDT.summary.crowdingPersistenceBars`; causal reference derivatives market-state field
- `solFundingZScore15m`: `baseContext.derivatives.referenceContexts.SOLUSDT.intervals.15m.fundingZScore`; causal reference derivatives market-state field, but env-sensitive to `DERIVATIVES_CONTEXT_INTERVALS=15m,1h` and provider coverage
- `cmc20ToCmc100RatioChange24hPct`: `baseContext.relative.cmcIndexes.cmc20ToCmc100RatioChange24hPct`, with gateFeatures fallback; causal CMC daily index context
- strict null handling was fixed so `null` no longer becomes `0` through numeric coercion

Implemented thresholds:

- raw pocket-search threshold `btcVsAltReturn24h <= -0.00848698`; implemented as stricter rounded `<= -0.009`
- raw ETH crowding threshold `>= 138`; implemented as stricter rounded `>= 140`
- raw SOL funding threshold `<= 0.2226`; implemented as stricter rounded `<= 0.2`
- raw CMC loss blocker boundary near `<= -7.058e-4`; implemented as `<= -0.0007`

Post-change q4+ metrics on merge `1784107002034`:

- approved: `147`
- WR: `62.6%`
- PNL: `+816.66`
- PF: `2.46`
- max DD: `83.20`
- max DD / gross profit: `6.0%`
- max DD / total profit: `10.2%`
- max loss streak: `5`
- approved trades/day: `0.40`
- approved trades/week: `2.82`
- approved PNL/day: `+2.24`
- approved PNL/month: `+68.23`
- losing approved months: `0`; no approved trades in `2025-09` and `2026-04`

Terminal windows:

| Window | Approved | WR | PF | PNL | Max DD | Max LS | Trades/Day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 90d | 107 | 57.0% | 1.96 | +442.90 | 83.20 | 5 | 1.19 |
| 30d | 55 | 60.0% | 2.22 | +264.22 | 30.81 | 3 | 1.83 |
| 7d | 12 | 58.3% | 1.98 | +51.87 | 30.81 | 3 | 1.71 |

q5+ remains narrow:

- approved: `9`
- WR: `77.8%`
- PNL: `+81.32`
- PF: `5.08`
- max DD: `10.09`
- trades/day: `0.02`

Ablation on merge `1784107002034`:

| Gate | Approved | WR | PF | PNL | Max DD | Max LS | Losing Months |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| old q4/q5 only | 31 | 74.2% | 4.68 | +272.62 | 20.04 | 3 | 1 |
| q4 derivatives only | 116 | 59.5% | 2.12 | +544.04 | 99.80 | 5 | 0 |
| combined final | 147 | 62.6% | 2.46 | +816.66 | 83.20 | 5 | 0 |

Direction split:

- LONG: `58` approved, WR `55.2%`, PF `1.85`, PNL `+229.23`, maxDD `108.91`, maxLS `8`
- SHORT: `89` approved, WR `67.4%`, PF `3.04`, PNL `+587.43`, maxDD `43.02`, maxLS `4`
- SHORT is much cleaner; LONG keeps the combined gate profitable but is the next area to tune.

Walk-forward split:

- train first 75%: `40` approvals, WR `77.5%`, PF `4.74`, PNL `+373.76`, maxDD `13.14`
- validation last 25%: `107` approvals, WR `57.0%`, PF `1.96`, PNL `+442.90`, maxDD `83.20`
- q4 derivatives validation slice: `101` approvals, WR `57.4%`, PF `1.94`, PNL `+414.94`

Comparison to previous merge `1783545654299` with the same fixed gate:

- previous full: `132` approvals, WR `58.3%`, PF `2.07`, PNL `+611.60`, maxDD `107.71`, maxLS `9`
- previous 30d: `37` approvals, WR `45.9%`, PF `1.30`, PNL `+61.26`, maxDD `93.96`, maxLS `9`
- previous 7d: `23` approvals, WR `43.5%`, PF `1.13`, PNL `+18.46`, maxDD `93.96`, maxLS `9`
- the new refactored export improves full PNL/PF and terminal 30d/7d stability under the same gate

Sensitivity checks on merge `1784107002034`:

| Variant | Approved | WR | PF | PNL | Max DD | Max LS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| implemented | 147 | 62.6% | 2.46 | +816.66 | 83.20 | 5 |
| BTC relaxed `<= -0.0085` | 150 | 62.7% | 2.47 | +837.29 | 83.20 | 5 |
| BTC strict `<= -0.010` | 132 | 61.4% | 2.33 | +685.99 | 87.76 | 4 |
| ETH `>= 120` | 147 | 62.6% | 2.46 | +816.66 | 83.20 | 5 |
| ETH `>= 160` | 146 | 62.3% | 2.43 | +800.34 | 83.20 | 5 |
| SOL `<= 0` | 137 | 62.8% | 2.44 | +755.57 | 64.18 | 5 |
| SOL `<= 0.3` | 156 | 60.3% | 2.21 | +770.77 | 94.13 | 5 |
| no CMC bad-block | 174 | 59.8% | 2.17 | +835.25 | 73.89 | 4 |

Negative control:

- shuffled profit labels 300 times for the final selected rows
- actual selected PNL: `+816.66`
- shuffled mean PNL: `-94.53`
- shuffled p95: `+165.05`
- shuffled max: `+352.37`
- shuffles at or above actual: `0 / 300`

Code and tests:

- adapter: `packages/strategies/src/DoubleTap/adapters/ai.ts`
- tests: `packages/strategies/src/DoubleTap/__tests__/ai.test.ts`
- added q4 derivatives pocket tests for approval, SOL funding above gate, missing SOL funding, and CMC/BTC loss blocker
- verification used:
  - `yarn jest packages/strategies/src/DoubleTap --runInBand`
  - `yarn prettify`
  - `yarn workspace @tradejs/strategies build`
  - `yarn workspace @tradejs/node build`
  - `yarn workspace @tradejs/cli build`

Remaining concerns / next tuning:

- full-history cadence is only `0.40` trades/day, but terminal 30d and 7d cadence is `~1.7-1.8` trades/day; production cadence should be monitored on fresh rolling exports
- LONG side has weak Q2 behavior and larger maxDD than SHORT; next research should tune LONG-specific derivatives/relative filters instead of tightening the whole gate
- `marketContext` is absent from export; do not base live expectations on marketContext fields until export wiring is restored or intentionally removed from the analysis surface
- the repeated `2026-06-26` -> `2026-07-03` gap should be investigated in the data/export pipeline separately if that period matters for live cadence estimates

## Fresh 365d Split Export Local Gate Review (`2026-05-26`)

Current merged export used for this replay is split into 7 part files:

```bash
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part1.jsonl
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part2.jsonl
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part3.jsonl
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part4.jsonl
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part5.jsonl
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part6.jsonl
data/ai/export/ai-dataset-doubletap-merged-1779773352013-part7.jsonl
```

Replay mode:

```bash
yarn ai-train --file data/ai/export/ai-dataset-doubletap-merged-1779773352013-part1.jsonl --localOnly --json -n 0 --minQuality 4
yarn ai-train --file data/ai/export/ai-dataset-doubletap-merged-1779773352013-part1.jsonl --localOnly --json -n 0 --minQuality 5
```

Interpretation:

- deterministic `AI_MODE=gate` research only
- it does not describe `AI_MODE=llm` provider behavior
- `ai-train` auto-selected all 7 part files with the same merge id
- `part1` alone has `867` rows, but the logical export has `9889` rows

Rows and raw candidate stream:

- rows: `9889`
- symbols: `499`
- period: `2025-05-25T22:15:00.000Z` -> `2026-05-25T10:15:00.000Z`
- raw total profit without AI gate: `-3920.37`
- raw winners / losers: `4001 / 5888`
- raw precision: `40.5%`
- raw avg profit: `-0.396`
- `LONG`: `4995` rows, total `-1841.76`, precision `40.2%`, avg `-0.369`
- `SHORT`: `4894` rows, total `-2078.61`, precision `40.7%`, avg `-0.425`

Top raw symbols:

- `1000CATUSDT`: `21` rows, total `+186.69`
- `FLRUSDT`: `29` rows, total `+174.73`
- `POLYXUSDT`: `27` rows, total `+172.48`
- `SOLAYERUSDT`: `24` rows, total `+157.37`
- `RLCUSDT`: `24` rows, total `+156.16`

Worst raw symbols:

- `ASPUSDT`: `30` rows, total `-195.21`
- `BRUSDT`: `15` rows, total `-164.06`
- `HEIUSDT`: `31` rows, total `-161.18`
- `MAGICUSDT`: `26` rows, total `-158.49`
- `AEVOUSDT`: `32` rows, total `-154.10`

### Baseline Gate Before The Soft Downgrade

Baseline `q4+` local gate before commit `600d1c0`:

- approved: `1906`
- `TP / FP / TN / FN = 907 / 999 / 4889 / 3094`
- precision approved: `47.6%`
- recall winners: `22.7%`
- approved profit: `+2695.23`
- avg approved profit: `+1.41`
- approved profit per day: `+7.39`
- approved profit per month: `+225.06`
- approved trades per day: `5.23`
- approved trades per week: `36.60`
- profit factor: `1.24`
- max drawdown: `399.97`
- max drawdown pct of gross profit: `2.9%`
- max drawdown pct of total profit: `14.8%`
- recovery factor: `6.74`
- max losing streak: `18`

By direction:

- `LONG q4+`: `696` approved, total `+1094.07`, precision `47.0%`, PF `1.27`, maxDD `246.84`
- `SHORT q4+`: `1210` approved, total `+1601.16`, precision `47.9%`, PF `1.23`, maxDD `402.63`

Quality buckets:

- `q3`: `7983` rows, `3094` winners, total `-6615.60`
- `q4`: `1460` approved, `677` winners, total `+1489.60`
- `q5`: `446` approved, `230` winners, total `+1205.63`

Baseline `q5+` only:

- approved: `446`
- `TP / FP / TN / FN = 230 / 216 / 5672 / 3771`
- precision approved: `51.6%`
- recall winners: `5.7%`
- approved profit: `+1205.63`
- avg approved profit: `+2.70`
- approved profit per day: `+3.31`
- approved profit per month: `+100.68`
- approved trades per day: `1.22`
- approved trades per week: `8.57`
- profit factor: `1.51`
- max drawdown: `267.83`
- max drawdown pct of gross profit: `7.5%`
- max drawdown pct of total profit: `22.2%`
- recovery factor: `4.50`
- max losing streak: `24`

By direction:

- `LONG q5+`: `214` approved, total `+592.92`, precision `50.5%`, PF `1.51`, maxDD `128.18`
- `SHORT q5+`: `232` approved, total `+612.71`, precision `52.6%`, PF `1.52`, maxDD `230.83`

### Baseline Monthly Stability

Baseline `q4+` was positive in every month, but April 2026 was weak:

- `2025-05`: `37` approved, total `+127.94`, PF `1.69`
- `2025-06`: `157` approved, total `+102.77`, PF `1.10`
- `2025-07`: `150` approved, total `+227.87`, PF `1.27`
- `2025-08`: `198` approved, total `+209.69`, PF `1.18`
- `2025-09`: `167` approved, total `+185.66`, PF `1.19`
- `2025-10`: `231` approved, total `+411.22`, PF `1.31`
- `2025-11`: `180` approved, total `+267.04`, PF `1.25`
- `2025-12`: `159` approved, total `+117.28`, PF `1.12`
- `2026-01`: `160` approved, total `+424.59`, PF `1.50`
- `2026-02`: `145` approved, total `+243.73`, PF `1.31`
- `2026-03`: `91` approved, total `+173.90`, PF `1.34`
- `2026-04`: `121` approved, total `+49.84`, PF `1.07`
- `2026-05`: `110` approved, total `+153.70`, PF `1.24`

Baseline `q5+` was cleaner, but lower cadence and had a negative November:

- `2025-11`: `36` approved, total `-73.81`, PF `0.72`
- `2025-09`: `47` approved, total `+0.81`, PF `1.00`
- all other months were positive

### Tested Gate Hypotheses

Weak baseline `q4` pockets:

- `q4` with `venueSpreadZScore` in `(-1, 1)`: `338` rows, total `-187.13`, precision `40.5%`, PF `0.92`
- `q4` with `bodyStrength < 0.35`: `29` rows, total `-66.68`, precision `31.0%`, PF `0.65`
- `q4` with `oi_not_confirming`: `22` rows, total `-45.04`, precision `36.4%`, PF `0.73`
- `q4` with `crowded_long|long_liquidation_spike`: `69` rows, total `-88.14`, precision `39.1%`, PF `0.81`
- `q4` with `crowded_long|oi_falling|long_liquidation_spike`: `32` rows, total `-34.61`, precision `43.8%`, PF `0.83`
- `q4` with `crowded_long|oi_not_confirming|long_liquidation_spike`: `27` rows, total `-60.07`, precision `33.3%`, PF `0.71`

Useful but more aggressive q3 promotion candidate:

- `q3 SHORT` in `europe/off_hours`, `volumeRel20 >= 1.2`, aligned downside breakout, `breakoutDistancePct <= 0.8`
- isolated pocket: `363` rows, total `+460.48`, precision `44.9%`, PF `1.20`
- adding it to baseline q4+ raised total profit to `+3155.71`, but also raised maxDD to `565.24`
- this is not production-ready because it gives up too much drawdown stability

Candidate comparisons:

- baseline `q4+`: `1906` trades, total `+2695.23`, precision `47.6%`, PF `1.24`, maxDD `399.97`
- block neutral-spread `q4`: `1568` trades, total `+2882.36`, precision `49.1%`, PF `1.33`, maxDD `392.00`
- block weak-body `q4`: `1877` trades, total `+2761.91`, precision `47.8%`, PF `1.26`, maxDD `399.97`
- block bad liquidation flags `q4`: `1756` trades, total `+2923.09`, precision `48.3%`, PF `1.29`, maxDD `399.97`
- block neutral-spread and weak-body `q4`: `1548` trades, total `+2903.38`, precision `49.3%`, PF `1.34`, maxDD `392.00`
- block neutral-spread and weak-body, plus q3 short promotion: `1790` trades, total `+3346.39`, precision `48.8%`, PF `1.33`, maxDD `525.48`

### Implemented Gate Change

Implemented in commit `600d1c0` (`Tune DoubleTap AI gate`):

- adapter now reads `baseContext.regime.momentum.bodyStrength`
- adapter now reads `baseContext.relative.execution.venueSpreadZScore`
- non-high-precision q4 approval pockets are downgraded to q3 when:
  - `venueSpreadZScore` is neutral, `-1 < venueSpreadZScore < 1`
  - or `bodyStrength < 0.35`
- q5 high-precision pockets are not downgraded by these soft filters
- `doubleTapContext` now includes `bodyStrength`, `venueSpreadZScore`, and `softBlockReasons`

Post-change `q4+` result on the same 7-shard export:

- approved: `1548`
- `TP / FP / TN / FN = 763 / 785 / 5103 / 3238`
- precision approved: `49.3%`
- recall winners: `19.1%`
- approved profit: `+2903.38`
- avg approved profit: `+1.88`
- approved profit per day: `+7.97`
- approved profit per month: `+242.45`
- approved trades per day: `4.25`
- approved trades per week: `29.73`
- profit factor: `1.34`
- max drawdown: `392.00`
- max drawdown pct of gross profit: `3.4%`
- max drawdown pct of total profit: `13.5%`
- recovery factor: `7.41`
- max losing streak: `28`

By direction after the change:

- `LONG q4+`: `566` approved, total `+1071.70`, precision `48.1%`, PF `1.33`, maxDD `232.06`
- `SHORT q4+`: `982` approved, total `+1831.68`, precision `50.0%`, PF `1.34`, maxDD `344.45`

Quality buckets after the change:

- `q3`: `8341` rows, `3238` winners, total `-6823.75`
- `q4`: `1102` approved, `533` winners, total `+1697.75`
- `q5`: `446` approved, `230` winners, total `+1205.63`

Monthly stability after the change:

- `2025-05`: `32` approved, total `+183.19`, PF `2.41`
- `2025-06`: `138` approved, total `+157.82`, PF `1.19`
- `2025-07`: `109` approved, total `+183.70`, PF `1.29`
- `2025-08`: `165` approved, total `+174.96`, PF `1.18`
- `2025-09`: `134` approved, total `+27.58`, PF `1.03`
- `2025-10`: `180` approved, total `+419.14`, PF `1.43`
- `2025-11`: `151` approved, total `+345.07`, PF `1.41`
- `2025-12`: `130` approved, total `+234.34`, PF `1.33`
- `2026-01`: `132` approved, total `+441.72`, PF `1.67`
- `2026-02`: `118` approved, total `+241.89`, PF `1.38`
- `2026-03`: `67` approved, total `+126.59`, PF `1.34`
- `2026-04`: `106` approved, total `+108.43`, PF `1.17`
- `2026-05`: `86` approved, total `+258.95`, PF `1.61`

Comparison to baseline q4+:

- approved: `1906 -> 1548`
- precision: `47.6% -> 49.3%`
- approved profit: `+2695.23 -> +2903.38`
- avg approved profit: `+1.41 -> +1.88`
- approved profit per day: `+7.39 -> +7.97`
- approved profit per month: `+225.06 -> +242.45`
- approved trades per day: `5.23 -> 4.25`
- profit factor: `1.24 -> 1.34`
- max drawdown: `399.97 -> 392.00`
- recovery factor: `6.74 -> 7.41`

Validation commands run:

```bash
yarn prettify
yarn jest packages/strategies/src/DoubleTap --runInBand
yarn ai-train --file data/ai/export/ai-dataset-doubletap-merged-1779773352013-part1.jsonl --localOnly --json -n 0 --minQuality 4
```

Full `yarn checks` was not run for this commit because the working tree already had unrelated changes in `cli`, `TrendShift`, and related tests.

### Current Conclusion

- the raw DoubleTap candidate stream is broad and negative
- the deterministic gate extracts a positive stream
- q5+ is cleaner by PF and precision, but too sparse for the main live stream
- q4+ remains the practical production-like `AI_MODE=gate` stream
- the `neutral_venue_spread` and `weak_signal_body` soft downgrade improves profit, PF, average trade, and drawdown without relying on new q3 promotions
- the q3 short promotion pocket is promising but too drawdown-heavy; do not implement it without additional stabilizers
- April and September remain the months to watch for regime weakness even after the improvement
