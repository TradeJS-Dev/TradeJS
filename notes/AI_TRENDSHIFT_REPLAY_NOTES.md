# AI TrendShift Replay Notes

Last updated: 2026-07-19

### 2026-07-19 - TrendShift BNB 1h OI4h Risk Block

Export: `1784479077281` (`7` parts), rows `2504`, window `2025-07-22T04:30:00.000Z` .. `2026-07-18T06:00:00.000Z`, lag `1.53d`.
Lineage: git `4718ee59a1d457912e3fb7267dae8f595bf7a8cd`, gate `516d10da72adbb08` after / `e2d6b73417827a69` before, config `33cceb0134b5566b`, context `4186a11d2ef809af`, command `MIN_AI_QUALITY=4`, effective approvals q5-only, `AI_MODE=local-deterministic`.
Change: added a defensive watch-mode block when causal BNB reference derivatives show `baseContext.derivatives.referenceContexts.BNBUSDT.intervals["1h"].oiChangePct4h >= 0`; missing BNB data does not block.

| Period | Gate | N | WR | PF | Sharpe | Sortino | Calmar | PnL | MaxDD | Loss Streak | Trades/Day |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | before | 306 | 78.1% | 7.71 | 15.51 | 45.09 | 34.44 | 2199.09 | 64.54 | 10 | 0.847 |
| full | after | 251 | 82.9% | 12.18 | 16.68 | 56.77 | 64.21 | 1961.93 | 30.89 | 4 | 0.695 |
| 180d | before | 162 | 76.5% | 6.46 | 14.27 | 38.16 | 33.22 | 1056.33 | 64.54 | 10 | 0.900 |
| 180d | after | 147 | 82.3% | 11.62 | 17.48 | 56.83 | 73.95 | 1125.34 | 30.89 | 4 | 0.817 |
| 90d | before | 99 | 85.9% | 11.19 | 23.31 | 66.37 | 56.90 | 900.73 | 64.54 | 10 | 1.100 |
| 90d | after | 87 | 96.6% | 83.05 | 37.64 | 185.24 | 376.04 | 973.94 | 10.56 | 1 | 0.967 |
| 30d | before | 14 | 21.4% | 0.43 | -4.98 | -6.08 | -8.10 | -42.91 | 64.54 | 10 | 0.467 |
| 30d | after | 3 | 66.7% | 2.74 | 3.14 | 6.06 | 21.17 | 18.34 | 10.56 | 1 | 0.100 |
| 7d | before | 10 | 10.0% | 0.06 | -31.60 | -18.75 | -49.47 | -56.05 | 59.34 | 9 | 1.429 |
| 7d | after | 0 | n/a | n/a | n/a | n/a | n/a | 0.00 | 0.00 | 0 | 0.000 |

Risk-adjusted read: Sharpe/Sortino/Calmar improved together with PF and maxDD on full/180d/90d/30d, and the 7d loss cluster was removed rather than made smaller.
Decision: implement, because it fixes the bad 30d/7d tail and halves full maxDD (`64.54 -> 30.89`) with q5-only approvals still trading at `0.695/day`.
Residual risk: total full-history PnL drops (`2199.09 -> 1961.93`) and the last `7d` has zero approvals, so the next export must validate that this is a risk block and not a persistent cadence stall.
Next check: rerun `ai-train --localOnly --terminalWindows=180,90,30,7` on the next TrendShift export and inspect direction split, especially SHORT where PF changed `6.45 -> 6.15`.

Verification commands:

```bash
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1784479077281-part1.jsonl --localOnly --json -n 0 --terminalWindows=180,90,30,7
yarn jest packages/strategies/src/TrendShift/__tests__/ai.test.ts packages/cli/src/__tests__/aiTrainMetrics.test.ts --runInBand
node --test .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.test.mjs
yarn workspace @tradejs/strategies build && yarn workspace @tradejs/node build && yarn workspace @tradejs/cli build
```

## Derivatives Data-Quality Repair (`2026-07-18`, export `1784399805532`)

Inputs:

- export: `data/ai/export/ai-dataset-trendshift-merged-1784399805532-part1.jsonl` through `part7`
- pocket report: `data/ai/output/ai-pocket-search-trendshift-merged-1784399805532-all-2026-07-18T18-41-04Z.md`
- previous comparison export: `1784385127089`
- context fingerprint: `c0834eb8e727ac4b`

Diagnosis:

- The new export had no duplicate groups and mostly the same signal-row set as the previous post-refactor export, but approvals changed because derivatives context content changed.
- The main regression was data quality: `missing_derivatives` / `stale_derivatives` were represented downstream as `pressure=neutral` and `priceOiDivergenceType=unknown`, so the gate could treat unavailable derivatives as a neutral confirmation.
- Broadly blocking every missing/stale derivatives row was too destructive because some non-stress historical rows stayed profitable.
- The implemented repair is narrower:
  - demote q5 and block neutral-q4 promotion when benchmark derivatives are missing/stale and CMC FearGreed is in stress mode (`<= 25`)
  - do not let `q4ShortBreadthShockLiquidationRecoveryCandidate` clear already accumulated hard blockers such as `flat_or_mixed_oi`
  - keep missing/stale fields as defensive evidence only, not approval evidence

Metrics with `MIN_AI_QUALITY=5`:

| Export / gate | Approved | WR | PF | PNL | MaxDD | Loss streak | Trades/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `1784399805532` before fix | 352 | 71.0% | 4.79 | +2083.70 | 104.48 | 10 | 0.973 |
| `1784399805532` after fix | 292 | 79.5% | 8.34 | +2171.77 | 46.92 | 4 | 0.807 |
| `1784385127089` before fix | 337 | 75.7% | 6.65 | +2274.63 | 80.04 | 5 | 0.930 |
| `1784385127089` after fix | 321 | 76.3% | 7.26 | +2210.37 | 80.04 | 5 | 0.886 |

Terminal windows on `1784399805532` after the fix:

| Window | Approved | WR | PF | PNL | MaxDD | Loss streak | Trades/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 180d | 172 | 81.4% | 9.38 | +1340.78 | 46.92 | 4 | 0.956 |
| 90d | 87 | 94.3% | 33.06 | +928.15 | 22.50 | 2 | 0.968 |
| 30d | 5 | 40.0% | 1.04 | +1.20 | 22.50 | 2 | 0.167 |
| 7d | 0 | n/a | n/a | +0.00 | 0.00 | 0 | 0.000 |

Notes:

- The fix improves the new export versus the broken baseline on full PNL, PF, winrate, maxDD, loss streak, and last30d PNL.
- It costs `64.26` PNL and `16` approvals on `1784385127089`, but improves PF there from `6.65` to `7.26`; maxDD is unchanged.
- q3+/q4+/q5+ are identical because the deterministic gate approves only effective q5 rows. Recommended runtime threshold remains `MIN_AI_QUALITY=5`.

Verification commands:

```bash
yarn prettier --write packages/strategies/src/TrendShift/guardrails.ts packages/strategies/src/TrendShift/adapters/ai.ts packages/strategies/src/TrendShift/__tests__/ai.test.ts
yarn jest packages/strategies/src/TrendShift/__tests__/ai.test.ts --runInBand
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1784399805532-part1.jsonl --localOnly --json -n 0 --terminalWindows=180,90,30,7
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1784385127089-part1.jsonl --localOnly --json -n 0 --terminalWindows=180,90,30,7
```

## Post-Refactor Gate Rebuild (`2026-07-18`)

Current export:

- merge id: `1784385127089`
- shards: `7`
- rows: `2503`
- window: `2025-07-18 07:30 UTC -> 2026-07-15 14:00 UTC`
- data lag at research time: `3.04d`
- config id: `1gis6b`
- duplicate context groups: `0`
- replay mode: deterministic local gate only (`AI_MODE=gate` equivalent)
- lineage at final research run: git SHA `d9aa69ab5c9bf09419855ad42cfd150ec0b31d85`, gate fingerprint `c44db91220d1ab29`, context fingerprint `9c3f68a679418c5a`

Baseline current gate on this export before the rebuild:

| window | approved | winrate | total | PF | maxDD | max loss streak | cadence/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | `355` | `71.8%` | `+2135.10` | `4.94` | `123.73` | `9` | `0.980` |
| last `180d` | `221` | `70.6%` | `+1305.01` | `4.64` | `123.73` | `9` | `1.228` |
| last `90d` | `106` | `81.1%` | `+863.08` | `6.61` | `123.73` | `9` | `1.178` |
| last `30d` | `20` | `10.0%` | `-123.73` | `0.19` | `123.73` | `9` | `0.667` |
| last `7d` | `8` | `0.0%` | `-54.37` | `0.00` | `54.37` | `8` | `1.143` |

Tested hypotheses:

- the provided pocket report highlighted CMC/relative/derivatives pockets, but many positive candidates had tiny validation support or used data-availability fields such as derivatives `.points`, so they were not suitable for production gate rules
- broad reference-derivatives exclusions around alt-leadership (`ETH oiAcceleration`, `XRP/TRX liqSpikeRatio`, `cmc20ToCmc100Ratio`, `altDispersion24h`) improved some full-history PF values but did not touch the latest `7d` failure cluster
- the latest `7d` failure was a single LONG approval cluster at `2026-07-15 12:45 UTC`: 8 symbols, all losses, in extreme broad-market breadth with BTC leading alts and benchmark derivatives in a short-flush state
- CMC fear/greed fields were useful for the second tail issue: the remaining last-30d SHORT losses concentrated in Asia-session long-flush capitulation when `cmcFearGreed.value <= 18` and market breadth had `advancers <= 2`

Implemented gate changes:

1. Downgrade q5 LONG broad-market squeeze clusters when:
   - direction is `LONG`
   - benchmark derivatives pressure is `short_flush`
   - market breadth advancers `>= 27`
   - market breadth pct above MA20 `>= 0.95`
   - BTC is not underperforming alts on 24h (`btcVsAltReturn24h >= 0`)
2. Downgrade q5 SHORT Asia-session capitulation clusters when:
   - direction is `SHORT`
   - session is `asia`
   - benchmark derivatives pressure is `long_flush`
   - CMC fear/greed value `<= 18`
   - market breadth advancers `<= 2`

Replay after rebuild:

| window | approved | winrate | total | PF | maxDD | max loss streak | cadence/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | `337` | `75.7%` | `+2274.63` | `6.65` | `80.04` | `5` | `0.930` |
| last `180d` | `203` | `76.8%` | `+1444.54` | `7.59` | `80.04` | `5` | `1.128` |
| last `90d` | `91` | `94.5%` | `+988.01` | `35.13` | `22.50` | `2` | `1.012` |
| last `30d` | `5` | `40.0%` | `+1.20` | `1.04` | `22.50` | `2` | `0.167` |
| last `7d` | `0` | `n/a` | `0.00` | `n/a` | `0.00` | `0` | `0.000` |

Directional split after rebuild:

| direction | approved | winrate | total | PF | maxDD | max loss streak | cadence/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LONG | `187` | `77.0%` | `+1429.67` | `7.76` | `59.37` | `5` | `0.534` |
| SHORT | `150` | `74.0%` | `+844.96` | `5.43` | `34.76` | `4` | `0.414` |

Net effect on the same export:

- full: approved `355 -> 337`, winrate `71.8% -> 75.7%`, total `+2135.10 -> +2274.63`, PF `4.94 -> 6.65`, maxDD `123.73 -> 80.04`
- last `180d`: total `+1305.01 -> +1444.54`, PF `4.64 -> 7.59`, maxDD `123.73 -> 80.04`
- last `90d`: total `+863.08 -> +988.01`, PF `6.61 -> 35.13`, maxDD `123.73 -> 22.50`
- last `30d`: total `-123.73 -> +1.20`; still weak but no longer negative on this export
- last `7d`: approved `8 -> 0`, total `-54.37 -> 0.00`

Stability check on previous export `1783871327390` with the rebuilt gate:

| window | approved | winrate | total | PF | maxDD | max loss streak | cadence/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full | `305` | `70.5%` | `+1780.51` | `5.79` | `43.00` | `6` | `0.839` |
| last `180d` | `181` | `68.0%` | `+1051.22` | `5.98` | `43.00` | `6` | `1.006` |
| last `90d` | `83` | `86.7%` | `+736.00` | `19.27` | `17.47` | `2` | `0.925` |
| last `30d` | `58` | `89.7%` | `+550.63` | `22.73` | `17.47` | `2` | `1.957` |
| last `7d` | `2` | `50.0%` | `+10.38` | `3.37` | `4.38` | `1` | `0.300` |

Current conclusion:

- use `MIN_AI_QUALITY=5`; q3+/q4+/q5+ are identical because the deterministic gate now only approves q5 rows
- the rebuilt gate is profitable and still trades (`337` approvals over `362.27d`, about `0.93/day`)
- latest `30d` is only marginally positive, so the next export should specifically revalidate the two cluster cuts before adding any new recovery overlay
- CMC fields helped as a defensive tail filter, not as a broad approval booster

## New Context Export Gate Rebuild (`2026-05-31`)

Current export:

- merge id: `1780255602426`
- shards: `6`
- rows: `1205`
- window: `2025-06-05 12:00 UTC -> 2026-05-30 04:15 UTC`
- `testSuiteId`: `05b38a`
- `configId`: `1npd3n`
- duplicate context groups: `0`
- replay mode: deterministic local gate only (`AI_MODE=gate` equivalent)

Note: this export uses the new normalized profit scale (`min=-0.30`, `max=+0.38`), so absolute totals are not directly comparable to older unnormalized exports. PF, winrate, drawdown percentages, and within-export deltas are comparable.

Baseline current gate on this export:

| window | approved | winrate | avg | total | PF | maxDD | max loss streak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full `1205` | `463` | `71.9%` | `+0.199` | `+92.03` | `4.96` | `3.54` | `9` |
| latest `1000` | `382` | `69.1%` | `+0.182` | `+69.66` | `4.44` | `3.54` | `9` |
| latest `500` | `183` | `55.2%` | `+0.099` | `+18.05` | `2.38` | `3.54` | `9` |

Tested new-context hypotheses:

- `gateFeatures.decisionHints.approveBias=reject` is not useful as a direct hard filter: most current approvals have it, but the bucket remains strongly profitable.
- pure `gateFeatures` gates did not beat the current hybrid policy. A fresh geometry+gateFeatures gate stayed around PF `2.3-2.6` with materially worse drawdown, while broad direct `approveBias`/`primaryIssue` filters either destroyed cadence or removed profitable current approvals.
- broad q4 promotion `relativeStrengthBucket=neutral & conflictCount=2` was positive on this export, but it re-approved too many rows that existing hard downgrades intentionally blocked (`flat_or_mixed`, pressure conflict, US SHORT flush).
- refined q4/q5-downgrade recovery was robust enough to implement: only recover when `gateFeatures.relative.relativeStrengthBucket=neutral`, `gateFeatures.conflicts.count=2`, MTF is not against the trade, and the only recovered veto is `neutral_derivatives_pressure` or `us_short_oi_not_expanding`. This adds `21` rows, `90.5%` winrate, `+6.50` total, PF `20.12`, maxDD `0.30`.
- `baseContext.participation.priceVolumeProfile.nearPointOfControl=true` is a stable defensive signal for SHORT only. Removed SHORT near-POC approvals were weak (`32` rows, `56.3%` winrate, `+2.98` total, PF `1.94`), while LONG near-POC approvals were strong enough to keep.
- q5 defensive cuts reproduced on both this export and the previous `1780121146050` export:
  - `LONG + liquidityTails.currentTail.side=lower + priceOiDivergenceType=price_up_oi_up`
  - `SHORT + below_low_level + long_flush + price_down_oi_down + exactly [oi_falling,long_liquidation_spike] + non-Asia session`

Implemented gate changes:

1. Downgrade q5 LONG when price and OI are already rising but the current candle has a lower liquidity tail.
2. Downgrade q5 SHORT below-low long-liquidation flushes outside Asia when OI is falling and the only derivative flags are `oi_falling` and `long_liquidation_spike`.
3. Add `q4GateFeaturesRecoveryCandidate` as a narrow recovery overlay for otherwise-confirmed q4/q5-downgraded rows where normalized `gateFeatures` shows neutral relative strength, exactly two conflicts, and MTF not against the trade; recovery is limited to neutral derivatives pressure and US SHORT OI non-expansion vetoes.
4. Downgrade q5 SHORT when the entry is near the price-volume point of control; do not apply this to LONG.

Replay after rebuild on `1780255602426`:

| window | approved | winrate | avg | total | PF | maxDD | max loss streak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full `1205` | `408` | `80.9%` | `+0.249` | `+101.67` | `8.45` | `0.93` | `4` |
| latest `1000` | `328` | `79.3%` | `+0.240` | `+78.62` | `8.16` | `0.83` | `4` |
| latest `500` | `133` | `72.2%` | `+0.190` | `+25.30` | `5.76` | `0.56` | `4` |

Net effect on the same export:

- full: approved `463 -> 408`, winrate `71.9% -> 80.9%`, total `+92.03 -> +101.67`, PF `4.96 -> 8.45`, maxDD `3.54 -> 0.93`
- latest `1000`: approved `382 -> 328`, winrate `69.1% -> 79.3%`, total `+69.66 -> +78.62`, PF `4.44 -> 8.16`, maxDD `3.54 -> 0.83`
- latest `500`: approved `183 -> 133`, winrate `55.2% -> 72.2%`, total `+18.05 -> +25.30`, PF `2.38 -> 5.76`, maxDD `3.54 -> 0.56`

Net effect after the narrow `gateFeatures` recovery overlay versus the defensive-cut gate:

- full: approved `419 -> 440`, winrate `78.5% -> 79.1%`, total `+98.15 -> +104.65`, PF `6.96 -> 7.23`, maxDD unchanged at `0.93`
- latest `1000`: approved `338 -> 358`, winrate `76.9% -> 77.7%`, total `+75.78 -> +81.90`, PF `6.61 -> 6.92`, maxDD `0.81 -> 0.75`
- latest `500`: approved `141 -> 148`, winrate `68.8% -> 69.6%`, total `+23.57 -> +25.34`, PF `4.40 -> 4.50`, maxDD `0.61 -> 0.66`

Net effect after the SHORT near-POC cut versus the `gateFeatures` recovery gate:

- full: approved `440 -> 408`, winrate `79.1% -> 80.9%`, total `+104.65 -> +101.67`, PF `7.23 -> 8.45`, maxDD unchanged at `0.93`
- latest `1000`: approved `358 -> 328`, winrate `77.7% -> 79.3%`, total `+81.90 -> +78.62`, PF `6.92 -> 8.16`, maxDD `0.75 -> 0.83`
- latest `500`: approved `148 -> 133`, winrate `69.6% -> 72.2%`, total `+25.34 -> +25.30`, PF `4.50 -> 5.76`, maxDD `0.66 -> 0.56`

Stability checks:

- monthly approved stream is positive in `11 / 12` months; only `2025-07` is slightly negative (`6` approvals, `-0.25` total)
- `2026-05` remains the weakest live-style month, but it is now positive (`30` approvals, `+4.38`, PF `3.28`) instead of a major drawdown pocket
- recovery overlay is not symbol-concentrated: the largest symbol count is `2` approvals; `2026-05` recovery adds `7` approvals, `+1.77`, PF `6.90`
- `1000BTTUSDT` is no longer the dominant failure mode on this export: `3` approvals, `1/2` W/L, `+0.03` total

Replay of the same rebuilt gate on previous export `1780121146050`:

| window | approved | winrate | avg | total | PF | maxDD | max loss streak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full `1203` | `388` | `80.4%` | `+12.925` | `+5015.00` | `8.30` | `47.45` | `4` |
| latest `1000` | `309` | `78.6%` | `+12.427` | `+3839.83` | `7.99` | `45.28` | `4` |
| latest `500` | `126` | `71.4%` | `+9.848` | `+1240.79` | `5.78` | `29.49` | `4` |

Compared with the previous `1780121146050` gate result before these two cuts:

- full total `+4858.65 -> +5015.00`, PF `5.05 -> 8.30`, maxDD `183.78 -> 47.45`
- latest `1000` total `+3698.81 -> +3839.83`, PF `4.53 -> 7.99`, maxDD `183.78 -> 45.28`
- latest `500` total `+958.94 -> +1240.79`, PF `2.41 -> 5.78`, maxDD `183.78 -> 29.49`

Current conclusion:

- keep the two defensive q5 cuts
- keep the narrow `q4GateFeaturesRecoveryCandidate`; it improves all tested windows on `1780255602426` and is a no-op on the previous `1780121146050` export because the older context does not trigger the same normalized feature pocket
- keep the SHORT near-POC cut when the goal is approval quality/PF; it sacrifices a small profitable slice but materially improves PF and latest-window winrate on both exports
- do not broaden the q4 `gateFeatures` pocket yet; the wider version adds profit but also reopens weaker hard-block groups (`flat_or_mixed`, long pressure conflict, US short flush)
- the rebuilt gate remains selective at about `1.14` approvals/day on the normalized export; quality improved more than cadence

## Clean Full-Universe Export Gate Rebuild (`2026-05-26`)

Current export:

- merge id: `1779774927397`
- shards: `7`
- rows: `16388`
- source chunks: `6`
- `testSuiteId`: `e50b13`
- `configId`: `11ppqe`
- replay mode: deterministic local gate only (`AI_MODE=gate` equivalent)

Replay command:

```bash
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779774927397-part1.jsonl --localOnly --json -n 0
```

Duplicate diagnostics:

- duplicate context groups: `0`
- duplicate rows: `0`
- max group size: `0`

This export is clean. The duplicate issue in merge `1779743495657` came from two overlapping suites; this export contains one suite only.

### Baseline On The Clean Export

The previous gate looked good on the smaller duplicated export, but failed on the clean full-universe export:

- approved: `15179`
- rejected: `1209`
- precision approved: `35.5%`
- avg profit approved: `-1.27`
- total approved profit: `-19235.65`
- profit factor: `0.85`
- max drawdown: `24564.18`
- max consecutive losses: `82`

Directional split:

- `LONG`: approved `241`, total `+2700.69`, PF `4.78`, precision `72.2%`
- `SHORT`: approved `14938`, total `-21936.34`, PF `0.83`, precision `34.9%`

Main failure:

- almost all damage came from `SHORT`
- `breakoutState=failed_low_breakout` was massively over-approved:
  - approved `14531`
  - total `-25490.21`
  - PF `0.80`

### Tested Hypotheses

Rejected:

- broad SHORT approval with `failed_low_breakout`: too much volume, weak PF
- allowing `failed_low_breakout` only by `volumeRel20 >= 2`: full PF improves only to `1.09`, latest `2000` remains negative
- allowing `failed_low_breakout` only outside US/Asia: full PF `1.12`, latest `2000` remains negative
- allowing only `long_flush` failed-low: full PF `1.28`, latest `2000` remains negative
- relying on symbol quarantine: useful as an overlay, but it cannot fix a systemic SHORT gate failure

Best robust fixes:

1. Remove `failed_low_breakout` from the selective-neutral q4 SHORT promotion.

   Old behavior allowed:

   - `SHORT`
   - `sessionPrimary in [off_hours, asia]`
   - `derivativesPressure = neutral`
   - `breakoutState in [below_low_level, failed_low_breakout]`

   New behavior allows only:

   - `SHORT`
   - `sessionPrimary in [off_hours, asia]`
   - `derivativesPressure = neutral`
   - `breakoutState = below_low_level`

2. Keep q4 `SHORT + failed_low_breakout` as watch-only.

3. Downgrade q5 `SHORT + failed_low_breakout` when:

   - `priceOiDivergenceType = price_down_oi_down`

Rationale:

- `failed_low_breakout` is not equivalent to a clean continuation breakdown
- neutral-derivatives q4 promotion was admitting thousands of weak Asia/off-hours SHORTs
- falling price with falling OI is not strong continuation confirmation for this failed-low pocket

### Replay After The Rebuild

Full export:

- approved: `749`
- rejected: `15639`
- `TP / FP / TN / FN = 509 / 240 / 10246 / 5393`
- precision approved: `68.0%`
- recall winners: `8.6%`
- avg profit approved: `+10.22`
- total approved profit: `+7654.92`
- profit factor: `4.14`
- max drawdown: `187.62`
- max drawdown pct of gross profit: `1.86%`
- max drawdown pct of total profit: `2.45%`
- max consecutive losses: `12`
- avg profit approved per day: `+20.99`
- avg profit approved per month: `+638.74`
- avg approved trades per day: `2.06`
- avg approved trades per week: `14.38`

Directional split:

- `LONG`: approved `241`, total `+2700.69`, PF `4.78`, precision `72.2%`, maxDD `234.80`
- `SHORT`: approved `508`, total `+4954.23`, PF `3.87`, precision `65.9%`, maxDD `219.65`

Net effect versus baseline on the same clean export:

- approved: `15179 -> 749`
- precision approved: `35.5% -> 68.0%`
- avg profit approved: `-1.27 -> +10.22`
- total approved profit: `-19235.65 -> +7654.92`
- profit factor: `0.85 -> 4.14`
- max drawdown: `24564.18 -> 187.62`
- max consecutive losses: `82 -> 12`

### Tail Stability

Latest `2000` rows:

- old gate: approved `1855`, total `-6588.15`, avg `-3.55`, precision `29.1%`, PF `0.62`, maxDD `7652.62`
- rebuilt gate: approved `106`, total `+487.36`, avg `+4.60`, precision `50.0%`, PF `2.13`, maxDD `179.84`

Latest `1000` rows:

- old gate: approved `928`, total `-850.88`, avg `-0.92`, precision `36.1%`, PF `0.89`, maxDD `2066.07`
- rebuilt gate: approved `33`, total `+112.12`, avg `+3.40`, precision `45.5%`, PF `1.62`, maxDD `57.33`

### Historical Gate Comparison

Compared old committed gate versions by replaying their approval logic on the same clean export.

Full export:

| gate | approved | total | PF | maxDD |
| --- | ---: | ---: | ---: | ---: |
| `95c6b65` | `1050` | `+4155.02` | `1.68` | `632.73` |
| `34897f6` | `1538` | `+4215.75` | `1.41` | `1322.33` |
| `54a0c6d` | `889` | `+4233.00` | `1.88` | `630.84` |
| `ac745d1` / `bcc1579` | `724` | `+3933.71` | `2.08` | `559.11` |
| `e067f0e` | `3248` | `+5411.15` | `1.22` | `3325.37` |
| current rebuilt | `749` | `+7654.92` | `4.14` | `187.62` |

Tail comparison:

| gate | latest 2000 total / PF / maxDD | latest 1000 total / PF / maxDD |
| --- | ---: | ---: |
| `34897f6` | `+650.90 / 1.33 / 430.60` | `+526.69 / 1.47 / 273.54` |
| `ac745d1` / `bcc1579` | `+543.40 / 1.74 / 157.89` | `+95.53 / 1.24 / 128.88` |
| `e067f0e` | `+280.06 / 1.31 / 380.56` | `-141.17 / 0.76 / 215.28` |
| current rebuilt | `+487.36 / 2.13 / 179.84` | `+112.12 / 1.62 / 57.33` |

Interpretation:

- `34897f6` has higher raw latest `1000` profit, but lower PF and much higher drawdown
- `ac745d1` / `bcc1579` are conservative and safer than `e067f0e`, but weaker than the current rebuilt gate on full export
- `e067f0e` is the problematic version: it expanded selective-neutral q4 approval and allowed too much `SHORT + failed_low_breakout`

### Current Conclusion

Use the current rebuilt gate as the baseline for `AI_MODE=gate`.

The gate is now intentionally selective:

- `q4` remains watch-only by default
- `SHORT + below_low_level` can still pass in proven pockets
- `SHORT + failed_low_breakout` requires true q5 geometry and must not show falling OI with falling price

Do not describe these results as `AI_MODE=llm` behavior. These are local deterministic gate results only.

## Fresh Sharded Export Gate Rebuild (`2026-05-26`)

Current export:

- merge id: `1779743495657`
- shards: `7`
- rows: `4830`
- replay mode: deterministic local gate only (`AI_MODE=gate` equivalent)

Replay command:

```bash
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779743495657-part1.jsonl --localOnly --json -n 0
```

### Baseline Before This Rebuild

Current approved stream was effectively `q5+`:

- approved: `1593`
- `TP / FP / TN / FN = 986 / 607 / 1809 / 1428`
- precision approved: `61.9%`
- recall winners: `40.8%`
- avg profit approved: `+8.27`
- total approved profit: `+13181.33`
- profit factor: `3.08`
- max drawdown: `511.09`
- avg profit approved per day: `+36.14`
- avg approved trades per day: `4.37`

Compared with previous export `1779570024238`:

- approved: `474 -> 1593`
- precision approved: `56.3% -> 61.9%`
- avg profit approved: `+4.99 -> +8.27`
- avg profit approved per day: `+6.51 -> +36.14`
- total approved profit: `+2364.78 -> +13181.33`

Meaning:

- the broader fresh export strongly improved versus the last note
- `SHORT` remains slightly stronger than `LONG`, but both sides are now positive
- the remaining weakness was concentrated in a few q5 false-positive pockets, not in the whole q5 stream

### Tested Hypotheses

Rejected ideas:

- reopening broad `q4` is still too risky: `q4` total is positive (`+7041.65`) but PF is only `1.33` and maxDD is `1937.27`
- old selective neutral q4 pockets did not reproduce on this export:
  - `q4 SHORT asia/off_hours neutral selective`: `4` rows, avg `-5.91`
  - `q4 LONG europe neutral selective`: `25` rows, avg `-4.82`
- `q4 LONG` remains too noisy for approval

Useful new `baseContext` fields:

- `relative.benchmark.relativeStrength1h`
- `derivatives.summary.priceOiDivergenceType`
- `regime.session.sessionPhase`
- `derivatives.summary.pressure`
- `structure.localRange.breakoutState`

Best defensive q5 cuts:

- `LONG | price_up_oi_down`: `30` rows, avg `-6.58`, PF `0.37`
- `LONG | relativeStrength1h >= 5`: `136` rows, avg `-1.21`, PF `0.85`
- `SHORT | us | long_flush`: `46` rows, avg `-2.90`, PF `0.61`

Best narrow q4 reopen:

- `SHORT | failed_low_breakout`: `137` rows, total `+933.58`, avg `+6.81`, PF `2.27`, maxDD `109.47`

### Implemented Gate Changes

1. Downgrade q5 LONG when:

- `relativeStrength1h >= 5`
- or `priceOiDivergenceType = price_up_oi_down`

2. Downgrade q5 SHORT when:

- `session = us`
- and `derivativesPressure = long_flush`

3. Promote only one q4 pocket:

- `SHORT`
- `breakoutState = failed_low_breakout`

### Replay After The Rebuild

Full export:

- approved: `1525`
- `TP / FP / TN / FN = 996 / 529 / 1887 / 1418`
- precision approved: `65.3%`
- recall winners: `41.3%`
- avg profit approved: `+9.52`
- total approved profit: `+14511.85`
- profit factor: `3.67`
- max drawdown: `332.91`
- max drawdown pct of gross profit: `1.67%`
- max drawdown pct of total profit: `2.29%`
- avg profit approved per day: `+39.79`
- avg profit approved per month: `+1211.01`
- avg approved trades per day: `4.18`
- avg approved trades per week: `29.27`
- expectancy delta: `+5.33`

Directional split:

- `LONG`: approved `437`, precision `70.7%`, avg `+11.01`, PF `4.75`, maxDD `382.43`
- `SHORT`: approved `1088`, precision `63.1%`, avg `+8.92`, PF `3.34`, maxDD `373.82`

Net effect versus baseline on the same export:

- approved: `1593 -> 1525`
- precision approved: `61.9% -> 65.3%`
- avg profit approved: `+8.27 -> +9.52`
- total approved profit: `+13181.33 -> +14511.85`
- profit factor: `3.08 -> 3.67`
- max drawdown: `511.09 -> 332.91`
- avg profit approved per day: `+36.14 -> +39.79`

### Tail Stability

Latest `2000` rows:

- old gate: approved `709`, total `+4494.61`, avg `+6.34`, precision `56.8%`, PF `2.46`, maxDD `393.96`
- rebuilt gate: approved `678`, total `+4916.37`, avg `+7.25`, precision `59.3%`, PF `2.82`, maxDD `312.38`

Latest `1000` rows:

- old gate: approved `374`, total `+1530.98`, avg `+4.09`, precision `53.5%`, PF `1.95`, maxDD `393.96`
- rebuilt gate: approved `347`, total `+1637.18`, avg `+4.72`, precision `55.0%`, PF `2.20`, maxDD `312.38`

### Stability Risks

Monthly split is mostly positive, but not uniformly:

- strongest months: `2025-10` (`+3158.46`), `2026-01` (`+2897.51`), `2025-06` (`+2038.63`)
- weakest months: `2025-11` (`+36.77`), `2025-07` (`+55.25`), `2026-05` (`-84.66`)

Symbol concentration is acceptable overall, but one weak symbol stands out:

- `1000BTTUSDT`: `14` approvals, total `-116.38`, winrate `0%`

### Current Conclusion

This rebuild is better than the previous gate on the full export and both tail windows. The improvement comes from cleaning specific q5 false positives and reopening only one q4 SHORT failed-breakdown pocket; broad q4 reopening remains rejected.

Do not describe this as `AI_MODE=llm` behavior. These numbers are local deterministic gate results only.

### Symbol Quarantine Overlay (`2026-05-26`)

Implemented a generic `ai-train` quarantine overlay:

```bash
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779743495657-part1.jsonl --localOnly --json -n 0 --symbolQuarantine --symbolQuarantineMinLosses 5 --symbolQuarantineMinProfitFactor 1 --symbolQuarantineDays 14
```

Policy:

- key: `strategy + symbol`
- trigger after `>= 5` approved losses
- only trigger when symbol-level PF is below `1.0`
- quarantine duration: `14` days
- replay is ordered by timestamp before the overlay is applied

Full export effect:

- approved: `1525 -> 1517`
- precision approved: `65.3% -> 65.5%`
- avg profit approved: `+9.52 -> +9.60`
- total approved profit: `+14511.85 -> +14561.51`
- profit factor: `3.67 -> 3.71`
- max drawdown: unchanged at `332.91`
- max losing streak: `26 -> 25`

Tail checks:

- latest `2000`: total `+4916.37 -> +4931.68`, PF `2.82 -> 2.84`, approved `678 -> 675`
- latest `1000`: unchanged; no quarantine events triggered inside that isolated window

Quarantine events on the full export:

- `1000000CHEEMSUSDT`: `2025-11-08 00:45 UTC -> 2025-11-22 00:45 UTC`
- `1000BTTUSDT`: `2025-11-12 16:00 UTC -> 2025-11-26 16:00 UTC`
- `LINKUSDT`: `2026-01-27 16:00 UTC -> 2026-02-10 16:00 UTC`
- `BSVUSDT`: `2026-03-04 08:45 UTC -> 2026-03-18 08:45 UTC`
- `1000BTTUSDT`: `2026-04-27 23:45 UTC -> 2026-05-11 23:45 UTC`
- `ETHUSDT`: `2026-05-04 10:00 UTC -> 2026-05-18 10:00 UTC`

Interpretation:

- this catches the `1000BTTUSDT` issue without hardcoding the symbol
- it is deliberately small-impact: only `8` approvals were blocked on the full export
- it does not solve the full May 2026 regime weakness by itself, because most May damage is a broader `SHORT + long_flush` pocket, not a single symbol

### Duplicate Signal Diagnostics (`2026-05-26`)

The same `ai-train` run now reports duplicate signal groups by compact context:

- duplicate groups: `334`
- duplicate rows: `668`
- max group size: `2`

Worst duplicate groups all have two identical rows and total `-30.88`, for example:

- `1000TAGUSDT SHORT 2026-02-27 05:15 UTC`
- `AAPLUSDT SHORT 2026-04-30 20:30 UTC`
- `AIOUSDT SHORT 2025-11-16 08:45 UTC`
- `ALLOUSDT SHORT 2026-01-16 15:15 UTC`
- `ALPINEUSDT SHORT 2026-02-17 14:30 UTC`

For `1000BTTUSDT`, the apparent `14` approvals are duplicated pairs over roughly `7` unique contexts. The bad symbol is real, but the export currently doubles its impact.

## Core-Safe Backtest Export After Moving Derivatives Filters Back To Gate (`2026-05-24`)

Current export:

- merge id: `1779570024238`
- shards: `7`
- rows: `1560`
- source chunks: `6`
- full window: `2025-05-25 00:30 UTC -> 2026-05-23 07:45 UTC`
- replay mode: deterministic local gate only

Replay command:

```bash
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779570024238-part1.jsonl --localOnly --json -n 0
```

Shard note:

- passing `part1` is intentional
- `ai-train` grouped all matching `part1..part7` shards for merge id `1779570024238`

### Raw Export Before AI Gate

- rows: `1560`
- profitable / unprofitable: `842 / 718`
- avg profit all rows: `+4.40`
- `LONG`
  - rows: `837`
  - profitable: `434`
  - precision: `51.9%`
  - avg profit: `+3.42`
- `SHORT`
  - rows: `723`
  - profitable: `408`
  - precision: `56.4%`
  - avg profit: `+5.53`

Meaning:

- the core no longer produces an empty backtest
- the new backtest/export is much smaller than the previous candidate-style export because it contains actual signal rows
- raw core expectancy is already positive after the core guardrail fix

### Local Gate Metrics

Current approved stream is effectively `q5+`:

- approved: `474`
- rejected: `1086`
- `TP / FP / TN / FN = 267 / 207 / 511 / 575`
- precision approved: `56.3%`
- recall winners: `31.7%`
- avg profit all: `+4.40`
- avg profit approved: `+4.99`
- avg profit approved per day: `+6.51`
- avg profit approved per month: `+198.12`
- avg approved trades per day: `1.30`
- avg approved trades per week: `9.13`
- expectancy delta: `+0.59`

Quality buckets:

- `q4` rejected:
  - count: `1086`
  - profitable: `575`
  - total profit: `+4496.01`
  - avg profit: `+4.14`
- `q5+` approved:
  - count: `474`
  - profitable: `267`
  - total profit: `+2364.78`
  - avg profit: `+4.99`

Directional split:

- `LONG q5+`
  - approved: `163`
  - `TP / FP = 73 / 90`
  - precision: `44.8%`
  - avg profit approved: `+0.94`
  - avg profit approved per day: `+0.42`
  - avg approved trades per week: `3.17`
- `SHORT q5+`
  - approved: `311`
  - `TP / FP = 194 / 117`
  - precision: `62.4%`
  - avg profit approved: `+7.11`
  - avg profit approved per day: `+6.09`
  - avg approved trades per week: `5.99`

### Comparison To Previous 365d Sharded Export

Previous retuned 365d export `1779459438806`:

- rows: `107841`
- approved: `165`
- precision approved: `60.6%`
- avg profit approved: `+8.19`
- avg profit approved per day: `+3.70`

Current export `1779570024238`:

- rows: `1560`
- approved: `474`
- precision approved: `56.3%`
- avg profit approved: `+4.99`
- avg profit approved per day: `+6.51`

Interpretation:

- cadence is much better because the core is no longer empty and the export is now signal-level
- approved quality is weaker than the prior replay, mostly because `LONG q5+` is almost flat
- `SHORT q5+` remains the main edge

### Best Current Approved Pockets

- `SHORT | off_hours`
  - approved: `52`
  - precision: `78.8%`
  - avg profit: `+12.89`
- `SHORT | asia | long_flush`
  - approved: `79`
  - precision: `73.4%`
  - avg profit: `+8.98`
- `SHORT | off_hours | long_flush`
  - approved: `43`
  - precision: `79.1%`
  - avg profit: `+12.75`
- `SHORT | failed_low_breakout`
  - approved: `93`
  - precision: `63.4%`
  - avg profit: `+7.75`

### Weak Current Approved Pockets

- `SHORT | crowded_long`
  - approved: `19`
  - precision: `10.5%`
  - avg profit: `-12.18`
- `SHORT | us | crowded_long`
  - approved: `16`
  - precision: `12.5%`
  - avg profit: `-11.92`
- `LONG | inside_range`
  - approved: `11`
  - precision: `0.0%`
  - avg profit: `-11.20`
- `LONG | derivatives alignment false`
  - approved: `26`
  - precision: `23.1%`
  - avg profit: `-8.23`
- `LONG | us`
  - approved: `97`
  - precision: `41.2%`
  - avg profit: `-0.35`
- `LONG | price_up_oi_down`
  - approved: `59`
  - precision: `40.7%`
  - avg profit: `-1.10`

### Rejected q4 Pockets Worth Reconsidering

The biggest surprise in this export:

- rejected `q4` is positive overall
- `neutral derivatives pressure` is not a bad pocket on this new backtest

Rejected by reason:

- `neutral_derivatives_pressure`
  - rows: `579`
  - precision: `60.6%`
  - avg profit: `+6.86`
- `flat_or_mixed_oi`
  - rows: `209`
  - precision: `42.6%`
  - avg profit: `+0.59`
- `long_crowded_pressure`
  - rows: `110`
  - precision: `49.1%`
  - avg profit: `+2.27`
- `us_short_oi_not_expanding`
  - rows: `43`
  - precision: `39.5%`
  - avg profit: `-0.34`

Promising rejected pockets:

- `LONG | europe | neutral | above_high_level`
  - rows: `89`
  - precision: `71.9%`
  - avg profit: `+10.68`
- `SHORT | off_hours | neutral | below_low_level`
  - rows: `32`
  - precision: `87.5%`
  - avg profit: `+15.27`
- `SHORT | asia | neutral | below_low_level`
  - rows: `34`
  - precision: `70.6%`
  - avg profit: `+9.41`
- `LONG | us | neutral | above_high_level`
  - rows: `52`
  - precision: `63.5%`
  - avg profit: `+7.85`

### Candidate Next Gate Change

Simulated changes on the same export:

1. reject weak approved pockets:
   - `SHORT | crowded_long`
   - `LONG | inside_range`
   - `LONG | us | short_flush | price_up_oi_down`
   - `LONG | asia | short_flush`
2. promote selective neutral q4 pockets:
   - `LONG | europe | neutral | above_high_level`
   - `LONG | europe | neutral | failed_high_breakout`
   - `SHORT | off_hours/asia | neutral | below_low_level`
   - `SHORT | off_hours/asia | neutral | failed_low_breakout`

Simulation result:

- approved: `474 -> 587`
- precision: `56.3% -> 65.8%`
- total approved profit: `+2364.78 -> +4886.52`
- avg profit approved: `+4.99 -> +8.32`

Recommendation:

- do one more gate patch, not a core patch
- keep the strategy core broad enough to export signal candidates
- make `ai-gate` responsible for:
  - rejecting the weak `LONG` q5 pockets
  - selectively reintroducing strong neutral q4 pockets

### Gate Patch Applied After This Research

Patch applied:

- reject `SHORT q5` when derivatives pressure is `crowded_long`
- reject `LONG q5` while price is still `inside_range`
- reject `LONG q5` in `us` when `short_flush` still shows `price_up_oi_down`
- reject `LONG q5` in `asia` when pressure is `short_flush`
- promote selective neutral q4 pockets:
  - `LONG | europe | neutral | above_high_level`
  - `LONG | europe | neutral | failed_high_breakout`
  - `SHORT | off_hours/asia | neutral | below_low_level`
  - `SHORT | off_hours/asia | neutral | failed_low_breakout`

Post-patch replay on the same export:

- approved: `552`
- rejected: `1008`
- `TP / FP / TN / FN = 376 / 176 / 542 / 466`
- precision approved: `68.1%`
- avg profit approved: `+9.08`
- avg profit approved per day: `+13.79`
- avg approved trades per week: `10.64`

Directional split:

- `LONG`
  - approved: `182`
  - `TP / FP = 123 / 59`
  - precision: `67.6%`
  - avg profit approved: `+8.92`
  - avg profit approved per day: `+4.50`
- `SHORT`
  - approved: `370`
  - `TP / FP = 253 / 117`
  - precision: `68.4%`
  - avg profit approved: `+9.15`
  - avg profit approved per day: `+9.32`

Net effect versus pre-patch local gate on the same export:

- approved: `474 -> 552`
- precision: `56.3% -> 68.1%`
- avg profit approved: `+4.99 -> +9.08`
- avg profit approved per day: `+6.51 -> +13.79`
- `LONG` avg profit approved: `+0.94 -> +8.92`
- `SHORT` avg profit approved: `+7.11 -> +9.15`

## 365d Sharded Export Retune (`2026-05-22`)

Current export:

- merge id: `1779459438806`
- shards:
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl`
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part2.jsonl`
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part3.jsonl`
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part4.jsonl`
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part5.jsonl`
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part6.jsonl`
  - `data/ai/export/ai-dataset-trendshift-merged-1779459438806-part7.jsonl`
- rows: `107841`
- full window: `2025-05-22 11:15 UTC -> 2026-05-21 10:25 UTC`
- replay mode: deterministic local gate only
- economics baked into this export:
  - `FEE=0.3`
  - fee is charged on both entry and exit
  - TP/SL were updated before this export was built

Replay command:

```bash
yarn run -T ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl --localOnly --json -n 0
```

Important shard note:

- passing `part1` here is intentional
- current `ai-train` groups all matching `part1..partN` shards with the same merge id automatically

### Baseline Before This Retune

With the pre-change gate on the same 365d shard group:

- `approved = 219`
- `TP / FP / TN / FN = 116 / 103 / 72629 / 34993`
- `precision_approved = 53.0%`
- `avg_profit_all = -1.97`
- `avg_profit_approved = +5.73`
- `avg_profit_approved_per_day = +3.44`
- `avg_profit_approved_per_month = +104.54`
- `avg_approved_trades_per_day = 0.60`
- `avg_approved_trades_per_week = 4.20`

Directional split:

- `LONG`
  - `approved = 100`
  - `precision_approved = 45.0%`
  - `avg_profit_approved = +3.02`
- `SHORT`
  - `approved = 119`
  - `precision_approved = 59.7%`
  - `avg_profit_approved = +8.01`

Main problem:

- this 365d export did not break the strategy completely
- but the widened economics clearly exposed weak live pockets
- the largest damage came from:
  - `LONG` q5 approvals during `crowded_long + anti-aligned` derivatives context
  - `SHORT` US-session `long_flush` approvals where OI was not expanding down with the move

### Gate Change Applied

Two additional live downgrades were added on top of the existing `core q5` + narrow Asia SHORT flush logic:

1. downgrade `LONG q5` to watch-only when:
   - `derivativesPressure === crowded_long`
   - `derivativesDirectionAligned === false`

2. downgrade `SHORT q5` to watch-only in the `us` session when:
   - `derivativesPressure === long_flush`
   - `priceOiDivergenceType` is `unknown` or `price_down_oi_down`

Why these two were chosen:

- they remove specific negative 365d pockets without cutting the healthy Asia / off-hours SHORT core
- they improve both precision and approved expectancy on the full-year window
- they align with a defensible runtime story:
  - a LONG flip should not stay live-approved into explicitly crowded-long anti-aligned derivatives
  - a US-session SHORT flush should still show expanding downside OI, not shrinking / flat confirmation

### Full 365d Metrics After The Retune

- `approved = 165`
- `TP / FP / TN / FN = 100 / 65 / 72667 / 35009`
- `precision_approved = 60.6%`
- `avg_profit_all = -1.97`
- `avg_profit_approved = +8.19`
- `avg_profit_approved_per_day = +3.70`
- `avg_profit_approved_per_month = +112.61`
- `avg_approved_trades_per_day = 0.45`
- `avg_approved_trades_per_week = 3.16`

Directional split after the retune:

- `LONG`
  - `approved = 64`
  - `precision_approved = 50.0%`
  - `avg_profit_approved = +4.68`
- `SHORT`
  - `approved = 101`
  - `precision_approved = 67.3%`
  - `avg_profit_approved = +10.41`

### Net Effect On The Same 365d Export

Compared with the pre-retune gate on the same shard group:

- approvals dropped from `219` to `165`
- `precision_approved` improved from `53.0%` to `60.6%`
- `avg_profit_approved` improved from `+5.73` to `+8.19`
- `avg_profit_approved_per_day` improved from `+3.44` to `+3.70`
- `LONG` approved average profit improved from `+3.02` to `+4.68`
- `SHORT` approved average profit improved from `+8.01` to `+10.41`

### Comparison To The Previous 2026-05-22 Note

Compared with the earlier `Narrow Asia SHORT q4 Re-Introduction` note on the smaller `2025-12-22 -> 2026-05-21` export:

- this new 365d window is materially harder
- cadence is much lower because the newly added older months plus the harsher fee model remove many marginal approvals
- even after the retune, `avg_profit_approved_per_day` stays below the smaller-window result
- but the current full-year gate is still positive and more robust than leaving the new 365d economics unfiltered

Current conclusion:

- the 365d export with `FEE=0.3` on both entry and exit still supports a positive deterministic TrendShift gate
- the old gate was too permissive for `LONG crowded_long` and `US SHORT long_flush without downside OI expansion`
- the new retune improves full-year precision and approved expectancy with an acceptable cadence loss
- if another iteration is needed, the next target should be `LONG` regime cleanup, not Asia/off-hours SHORT where the edge is still strongest

## Core q5-Only Gate Rebuild (`2026-05-22`)

Change applied:

- removed all live promotion paths from `q4` to `q5`
- kept only core `q5` geometry as live-approved
- `q4` breakout and failed-breakout pockets stay research/watch-only until they prove robust on wider history

Why this rebuild was chosen:

- the expanded `2025-12-22 -> 2026-05-21` export showed that core `q5` approvals were healthy
- the real damage came from promoted `q4` traffic, not from the core `q5` stream
- on the newly added pre-`2026-03-18` history, both `q4` breakout and failed-breakout promotions were strongly negative, especially on `SHORT`

Replay commands used after the rebuild:

```bash
yarn run -T ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779376705446.jsonl --localOnly --json -n 0
yarn run -T ai-train --strategy TrendShift --file data/ai/export/tmp-trendshift-pre-20260318.jsonl --localOnly --json -n 0
yarn run -T ai-train --strategy TrendShift --file data/ai/export/tmp-trendshift-post-20260318.jsonl --localOnly --json -n 0
```

### Full Export After The Rebuild

Window:

- `2025-12-22 15:00 UTC -> 2026-05-21 13:30 UTC`
- rows: `47967`

Metrics:

- `approved = 160`
- `TP / FP / TN / FN = 100 / 60 / 29617 / 18190`
- `precision_approved = 62.5%`
- `recall_winners = 0.55%`
- `avg_profit_all = -0.82`
- `avg_profit_approved = +6.22`
- `avg_profit_approved_per_day = +6.64`
- `avg_profit_approved_per_month = +202.05`
- `avg_approved_trades_per_day = 1.07`
- `avg_approved_trades_per_week = 7.47`
- `expectancy_delta = +7.04`

Meaning:

- the full widened export is now clearly positive on approved trades
- this is much more robust than the broader previous gate
- the trade-off is extreme selectivity and very low recall

### Newly Added Historical Period After The Rebuild

Window:

- `2025-12-22 15:00 UTC -> 2026-03-18 12:15 UTC`
- rows: `28595`

Metrics:

- `approved = 88`
- `TP / FP / TN / FN = 53 / 35 / 17654 / 10853`
- `precision_approved = 60.2%`
- `recall_winners = 0.49%`
- `avg_profit_all = -0.85`
- `avg_profit_approved = +5.67`
- `avg_profit_approved_per_day = +5.81`
- `avg_profit_approved_per_month = +176.73`
- `avg_approved_trades_per_day = 1.02`
- `avg_approved_trades_per_week = 7.17`
- `expectancy_delta = +6.52`

Directional split on the previously untested history:

- `LONG`
  - `approved = 46`
  - `precision_approved = 63.0%`
  - `avg_profit_approved = +5.62`
- `SHORT`
  - `approved = 42`
  - `precision_approved = 57.1%`
  - `avg_profit_approved = +5.71`

Meaning:

- this fixes the main failure from the prior expanded export review
- the previously untested history is now positive on both `LONG` and `SHORT`

### Previously Tested Post-March Window After The Rebuild

Window:

- `2026-03-18 12:30 UTC -> 2026-05-21 13:30 UTC`
- rows: `19372`

Metrics:

- `approved = 72`
- `TP / FP / TN / FN = 47 / 25 / 11963 / 7337`
- `precision_approved = 65.3%`
- `recall_winners = 0.64%`
- `avg_profit_all = -0.77`
- `avg_profit_approved = +6.90`
- `avg_profit_approved_per_day = +7.75`
- `avg_profit_approved_per_month = +236.04`
- `avg_approved_trades_per_day = 1.12`
- `avg_approved_trades_per_week = 7.87`
- `expectancy_delta = +7.66`

Meaning:

- the already-good later regime remains positive
- expectancy improved further because only the healthiest core `q5` flips are still live-approved

### Net Effect Versus The Broader Gate

Compared with the earlier broadened gate on the same expanded export:

- approvals dropped from `1835` to `160`
- `precision_approved` improved from `42.0%` to `62.5%`
- `avg_profit_approved` improved from `+0.45` to `+6.22`
- the previously negative pre-`2026-03-18` period flipped from `-1.00` approved average profit to `+5.67`
- full-export `expectancy_delta` improved from `+1.27` to `+7.04`

### Current Conclusion

This rebuilt gate is finally robust on the expanded export, including the previously untested historical period.

The cost is clear:

- TrendShift is no longer a broad participation gate
- it is now a sparse high-conviction `core q5` gate

If later you want more live cadence, the next step should be a very narrow re-introduction of one promoted `q4` pocket at a time, validated first on the pre-`2026-03-18` slice instead of only on the later regime.

## Narrow Asia SHORT q4 Re-Introduction (`2026-05-22`)

Change applied on top of the strict core-`q5` gate:

- keep the strict `core q5` gate as the base
- re-open exactly one `q4 SHORT` pocket:
  - session: `asia`
  - no overlap
  - derivatives pressure: `neutral`
  - explicit `long_liquidation_spike` flush support
  - `distanceAtrRatio < 0.7`
  - `abs(avgSlopePct) >= 0.08`
  - `abs(closeVsAvgPct) >= 0.12`

Why this pocket was chosen:

- it stayed positive on `pre`, `post`, and full widened export
- it improved cadence without re-opening the old weak `q4` breakout flood
- it is still structurally narrow and easy to explain: early SHORT reversal continuation in Asia with a real long-side flush already underway

Replay results after this re-introduction:

### Full Export

- `approved = 177`
- `TP / FP / TN / FN = 115 / 62 / 29615 / 18175`
- `precision_approved = 65.0%`
- `recall_winners = 0.63%`
- `avg_profit_approved = +6.99`
- `avg_profit_approved_per_day = +8.26`
- `avg_profit_approved_per_month = +251.28`
- `avg_approved_trades_per_day = 1.18`
- `avg_approved_trades_per_week = 8.26`
- `expectancy_delta = +7.81`

### Pre-`2026-03-18` Out-of-Sample Slice

- `approved = 102`
- `TP / FP / TN / FN = 66 / 36 / 17653 / 10840`
- `precision_approved = 64.7%`
- `recall_winners = 0.61%`
- `avg_profit_approved = +7.05`
- `avg_profit_approved_per_day = +8.37`
- `avg_profit_approved_per_month = +254.67`
- `avg_approved_trades_per_day = 1.19`
- `avg_approved_trades_per_week = 8.31`
- `expectancy_delta = +7.90`

### Post-`2026-03-18` Known-Good Slice

- `approved = 75`
- `TP / FP / TN / FN = 49 / 26 / 11962 / 7335`
- `precision_approved = 65.3%`
- `recall_winners = 0.66%`
- `avg_profit_approved = +6.92`
- `avg_profit_approved_per_day = +8.11`
- `avg_profit_approved_per_month = +246.78`
- `avg_approved_trades_per_day = 1.17`
- `avg_approved_trades_per_week = 8.20`
- `expectancy_delta = +7.69`

Net effect versus the strict core-`q5` gate:

- approvals increased from `160` to `177`
- full-export `avg_profit_approved` improved from `+6.22` to `+6.99`
- full-export `avg_profit_approved_per_day` improved from `+6.64` to `+8.26`
- pre-history `avg_profit_approved` improved from `+5.67` to `+7.05`
- pre-history `avg_profit_approved_per_day` improved from `+5.81` to `+8.37`

Current conclusion:

- this is a better operating point than pure `core q5` only
- it keeps the widened export robust
- but cadence is still intentionally low, so TrendShift remains a selective high-conviction gate rather than a broad approval stream

## Expanded TP/SL Export Check (`2026-05-22`)

Current export:

- `data/ai/export/ai-dataset-trendshift-merged-1779376705446.jsonl`
- rows: `47967`
- full window: `2025-12-22 15:00 UTC -> 2026-05-21 13:30 UTC`
- replay mode: deterministic local gate only

Redis backtest config `TrendShift:ai` used for this export:

```json
{
  "LONG": [{ "enable": true, "direction": "LONG", "TP": 2.8, "SL": 1.1, "minRiskRatio": 1.6 }],
  "SHORT": [{ "enable": true, "direction": "SHORT", "TP": 2.8, "SL": 1.1, "minRiskRatio": 1.6 }]
}
```

Replay commands used:

```bash
yarn run -T ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779376705446.jsonl --localOnly --json -n 0
yarn run -T ai-train --strategy TrendShift --file data/ai/export/tmp-trendshift-pre-20260318.jsonl --localOnly --json -n 0
yarn run -T ai-train --strategy TrendShift --file data/ai/export/tmp-trendshift-post-20260318.jsonl --localOnly --json -n 0
```

Interpretation:

- this is `AI_MODE=gate` research only
- it does not describe `AI_MODE=llm` provider behavior
- the main question here is whether the wider export with the changed `TP=2.8` / `SL=1.1` still holds on the newly added historical period

### Full Export Metrics

Default approved stream remains effectively `q5+` only:

- `approved = 1835`
- `TP / FP / TN / FN = 771 / 1064 / 28613 / 17519`
- `precision_approved = 42.0%`
- `recall_winners = 4.22%`
- `avg_profit_all = -0.82`
- `avg_profit_approved = +0.45`
- `avg_profit_approved_per_day = +5.52`
- `avg_profit_approved_per_month = +167.87`
- `avg_approved_trades_per_day = 12.24`
- `avg_approved_trades_per_week = 85.67`
- `expectancy_delta = +1.27`

By direction on the full export:

- `LONG`
  - `approved = 893`
  - `precision_approved = 43.3%`
  - `avg_profit_approved = +0.92`
  - `expectancy_delta = +1.78`
- `SHORT`
  - `approved = 942`
  - `precision_approved = 40.8%`
  - `avg_profit_approved = +0.01`
  - `expectancy_delta = +0.78`

Meaning:

- the full widened export is still slightly positive on approved trades
- but the edge is much weaker than in the previously documented March-May runs
- most of the deterioration comes from the new historical segment, not from the already-tested later window

### Previously Tested Coverage Recheck

Slice used as the already-familiar coverage:

- file: `data/ai/export/tmp-trendshift-post-20260318.jsonl`
- rows: `19372`
- window: `2026-03-18 12:30 UTC -> 2026-05-21 13:30 UTC`

Metrics:

- `approved = 724`
- `TP / FP / TN / FN = 358 / 366 / 11622 / 7026`
- `precision_approved = 49.4%`
- `recall_winners = 4.85%`
- `avg_profit_all = -0.77`
- `avg_profit_approved = +2.68`
- `avg_profit_approved_per_day = +30.35`
- `avg_profit_approved_per_month = +923.68`
- `avg_approved_trades_per_day = 11.31`
- `avg_approved_trades_per_week = 79.14`
- `expectancy_delta = +3.45`

Meaning:

- on the post-`2026-03-18` window the strategy still works under local gate replay
- approved trades remain clearly profitable
- this part is weaker than the strongest `2026-05-19` note entries, but it is still a valid positive operating regime

### Newly Added Historical Period Check

This is the part that had not been covered by the earlier notes:

- file: `data/ai/export/tmp-trendshift-pre-20260318.jsonl`
- rows: `28595`
- window: `2025-12-22 15:00 UTC -> 2026-03-18 12:15 UTC`

Metrics:

- `approved = 1111`
- `TP / FP / TN / FN = 413 / 698 / 16991 / 10493`
- `precision_approved = 37.2%`
- `recall_winners = 3.79%`
- `avg_profit_all = -0.85`
- `avg_profit_approved = -1.00`
- `avg_profit_approved_per_day = -13.00`
- `avg_profit_approved_per_month = -395.69`
- `avg_approved_trades_per_day = 12.94`
- `avg_approved_trades_per_week = 90.55`
- `expectancy_delta = -0.15`

By direction on the newly added period:

- `LONG`
  - `approved = 492`
  - `precision_approved = 38.8%`
  - `avg_profit_approved = -0.51`
  - `expectancy_delta = +0.74`
- `SHORT`
  - `approved = 619`
  - `precision_approved = 35.9%`
  - `avg_profit_approved = -1.40`
  - `expectancy_delta = -0.97`

Meaning:

- the strategy does **not** hold on the newly added historical period as a live-approved stream
- `LONG` approvals improve on raw baseline but still lose money in absolute approved PnL
- `SHORT` is the main failure mode: both approved expectancy and approved PnL are negative

### Comparison To The Last Stronger TrendShift Note

Compared with the stronger `2026-05-19` full-export note:

- participation is still high enough to be usable
- but precision and approved expectancy deteriorated sharply once the older history was added
- the widened export changed the conclusion from `broad still-profitable gate` to `barely positive overall, clearly regime-sensitive`

The practical split is:

- `2026-03-18 -> 2026-05-21`: still works
- `2025-12-22 -> 2026-03-18`: does not work

### Main Discoveries

1. The widened export is not uniformly safe.

- full-file profitability survives only because the later March-May regime offsets the weak earlier regime

2. The newly added history is the real regression source.

- approved PnL is negative on the entire pre-`2026-03-18` slice
- this was not just a small edge decay; approved stream went below zero

3. `SHORT` carries most of the damage in the new period.

- approved `SHORT` average profit is almost flat on the full export and strongly negative on the pre-March slice

4. The current gate is still too regime-dependent for a wider deployment claim.

- it can stay profitable on one regime cluster
- but it does not yet generalize across the added older history

### Current Conclusion

For the changed `TP/SL` export:

- yes, TrendShift still works on the already-familiar post-`2026-03-18` coverage
- no, it does not yet work on the newly added `2025-12-22 -> 2026-03-18` period
- overall full-export result is only marginally positive, so this is not strong enough to treat as robust out-of-sample confirmation

The next useful refinement should focus on the failing historical `SHORT` pocket first, not on broadening approvals further.

## BaseContext Gate Rebuild (`2026-05-19`)

Current export:

- `data/ai/export/ai-dataset-trendshift-merged-1779218089165.jsonl`
- rows: `28273`
- replay mode: deterministic local gate only

Replay command used:

```bash
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779218089165.jsonl --localOnly --json -n 0
```

Interpretation:

- this is `AI_MODE=gate` research only
- it does not describe `AI_MODE=llm` provider behavior

### Baseline Before The Rebuild

Full export with the pre-change gate:

- `approved = 236`
- `TP / FP / TN / FN = 181 / 55 / 11483 / 16554`
- `precision_approved = 76.7%`
- `recall_winners = 1.08%`
- `avg_profit_all = -1.47`
- `avg_profit_approved = +3.44`
- `avg_profit_approved_per_day = +9.03`
- `avg_profit_approved_per_month = +274.72`
- `avg_approved_trades_per_day = 2.62`
- `avg_approved_trades_per_week = 18.37`
- `expectancy_delta = +4.91`

Meaning:

- the old gate was still profitable on approved trades
- but it had extremely low recall and almost no participation
- most of the missed opportunity lived in `q4` rows that were no longer uniformly bad once `baseContext` was available

### What The New Indicators Showed

The most useful new `baseContext` fields were:

- `structure.localRange.breakoutState`
  - `LONG above_high_level` and `SHORT below_low_level` were much healthier than `inside_range`
- `participation.volume.volumeRel20`
  - current `q5` with `volumeRel20 < 0.8` was a bad pocket, especially on `LONG`
- `relative.benchmark.relativeStrength1h`
  - avoided promoting `LONG` flips when the coin was already unusually weak and `SHORT` flips when it was already unusually strong
- `regime.volatility.atrPctZScore`
  - promoted breakouts behaved better when the volatility regime was at least normal, not suppressed
- `derivativesContext.summary.directionAligned`
  - approved trades with `directionAligned = true` were much stronger than `null`
- `derivativesContext.summary.pressure`
  - `neutral` pressure was a bad approved pocket; `short_flush` and `long_flush` were much better confirmation states

### Implemented Gate Changes

The rebuilt adapter now does four things:

1. keep ordinary `q4` as watch-only by default
2. downgrade `q5` back to watch-only when participation is too thin:
   - `volumeRel20 < 0.8`
3. downgrade `q5` back to watch-only when derivatives confirmation is too weak:
   - `pressure = neutral` without flush support
   - `directionAligned = null` without flush support
4. promote selective `q4` breakouts to live-approved `q5` when `baseContext` confirms follow-through:
   - `LONG`
     - `breakoutState = above_high_level`
     - `volumeRel20 >= 1.2`
     - `atrPctZScore >= 0`
     - `relativeStrength1h > -1`
     - derivatives either `directionAligned = true` or `pressure = short_flush`
   - `SHORT`
     - `breakoutState = below_low_level`
     - `volumeRel20 >= 1.2`
     - `atrPctZScore >= 0`
     - `relativeStrength1h < 1`
     - derivatives either `directionAligned = true` or `pressure = long_flush`

### Replay After The Rebuild

Full export with the new gate:

- `approved = 997`
- `TP / FP / TN / FN = 695 / 302 / 11236 / 16040`
- `precision_approved = 69.7%`
- `recall_winners = 4.15%`
- `avg_profit_all = -1.47`
- `avg_profit_approved = +1.35`
- `avg_profit_approved_per_day = +14.96`
- `avg_profit_approved_per_month = +455.39`
- `avg_approved_trades_per_day = 11.08`
- `avg_approved_trades_per_week = 77.59`
- `expectancy_delta = +2.82`

Directional summary after the rebuild:

- `LONG`
  - `approved = 533`
  - `precision_approved = 70.0%`
  - `avg_profit_approved = +1.14`
- `SHORT`
  - `approved = 464`
  - `precision_approved = 69.4%`
  - `avg_profit_approved = +1.59`

### Net Effect

Compared with the baseline gate on the same export:

- approvals increased from `236` to `997`
- recall improved from `1.08%` to `4.15%`
- approved profit per day improved from `+9.03` to `+14.96`
- approved profit per month improved from `+274.72` to `+455.39`
- average approved trade quality dropped from `+3.44` to `+1.35`
- precision dropped from `76.7%` to `69.7%`

Interpretation:

- this is a deliberate shift from a very sparse high-expectancy gate to a broader still-profitable gate
- the new gate materially improves participation and total approved PnL flow
- the cost is lower per-trade expectancy and lower precision
- if live cadence matters more than keeping approvals ultra-rare, this is the better operating point
- if later you want a stricter variant, the safest first rollback is to keep the new `q5` filters but narrow the promoted `q4` breakout path

### Follow-up Tightening: Flush-Only Promoted Breakouts (`2026-05-19`)

Second pass on the same export showed that the weakest remaining pocket was not `core q5`, but promoted breakout traffic:

- promoted `LONG` with `pressure = crowded_short` and only generic derivatives alignment was a bad pocket
- promoted `SHORT` without explicit `long_flush` support was also a bad pocket

That led to a stricter rule:

- keep `core q5` unchanged
- but for promoted `q4` breakout approvals require explicit flush pressure
  - `LONG` promoted path now requires `pressure = short_flush`
  - `SHORT` promoted path now requires `pressure = long_flush`

Replay after this tightening:

- `approved = 794`
- `TP / FP / TN / FN = 574 / 220 / 11318 / 16161`
- `precision_approved = 72.3%`
- `recall_winners = 3.43%`
- `avg_profit_approved = +1.96`
- `avg_profit_approved_per_day = +17.26`
- `avg_profit_approved_per_month = +525.41`
- `avg_approved_trades_per_day = 8.83`
- `avg_approved_trades_per_week = 61.79`
- `expectancy_delta = +3.43`
- `total approved profit = +1552.67`

Compared with the broader first rebuild:

- approvals went down from `997` to `794`
- precision improved from `69.7%` to `72.3%`
- `avg_profit_approved` improved from `+1.35` to `+1.96`
- `avg_profit_approved_per_day` improved from `+14.96` to `+17.26`
- `avg_profit_approved_per_month` improved from `+455.39` to `+525.41`
- `total approved profit` improved from `+1345.75` to `+1552.67`

Interpretation:

- this is the best operating point found so far on the current export
- it keeps the broader `baseContext` rebuild benefits
- but removes the weakest promoted breakout traffic instead of tightening the entire `LONG` side or the whole strategy globally

## Fresh Export Review (`2026-05-17`)

Current export:

- `data/ai/export/ai-dataset-trendshift-merged-1779028973465.jsonl`
- rows: `17966`
- full window: `2026-03-18 12:30 UTC -> 2026-05-17 11:45 UTC`

Replay mode used:

```bash
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1779028973465.jsonl -n 0 --localOnly --json
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1779028973465.jsonl -n 1000 --localOnly --json
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1779028973465.jsonl -n 2000 --localOnly --json
```

Interpretation:

- this remains deterministic `AI_MODE=gate` research only
- it does not describe `AI_MODE=llm` provider behavior

### Full Export Metrics

Default approved stream is now effectively `q5+` only:

- `approved = 195`
- `TP / FP / TN / FN = 136 / 59 / 7384 / 10387`
- `precision_approved = 69.7%`
- `recall_winners = 1.29%`
- `avg_profit_all = -1.54`
- `avg_profit_approved = +1.99`
- `avg_profit_approved_per_day = +6.48`
- `avg_profit_approved_per_month = +197.18`
- `avg_approved_trades_per_day = 3.25`
- `avg_approved_trades_per_week = 22.76`
- `expectancy_delta = +3.53`

Quality breakdown on the full export:

- `q4`: `17771` rows, `0` approvals, `10387` winners, `avg_profit = -1.58`
- `q5`: `195` approvals, `136` winners, `avg_profit = +1.99`

Meaning:

- the post-update defensive gate still holds on the full March 18 -> May 17 sample
- `q4` remains net-negative overall and should not be blindly reopened
- approved expectancy is positive, but recall is intentionally extremely low

### Latest Windows

Latest `1000` rows:

- window: `2026-05-14 11:15 UTC -> 2026-05-17 11:45 UTC`
- `approved = 7`
- `TP / FP / TN / FN = 7 / 0 / 451 / 542`
- `precision_approved = 100%`
- `recall_winners = 1.28%`
- `avg_profit_all = -1.31`
- `avg_profit_approved = +6.33`
- `avg_profit_approved_per_day = +14.68`
- `avg_profit_approved_per_month = +446.80`
- `avg_approved_trades_per_day = 2.32`
- `avg_approved_trades_per_week = 16.22`
- `expectancy_delta = +7.64`

Latest `2000` rows:

- window: `2026-05-11 18:30 UTC -> 2026-05-17 11:45 UTC`
- `approved = 16`
- `TP / FP / TN / FN = 13 / 3 / 797 / 1187`
- `precision_approved = 81.3%`
- `recall_winners = 1.08%`
- `avg_profit_all = -0.51`
- `avg_profit_approved = +7.37`
- `avg_profit_approved_per_day = +20.63`
- `avg_profit_approved_per_month = +627.82`
- `avg_approved_trades_per_day = 2.80`
- `avg_approved_trades_per_week = 19.58`
- `expectancy_delta = +7.88`

Directionally on `n=2000`:

- approved `LONG`: `3` trades, `2` winners, `avg_profit_approved = +6.44`
- approved `SHORT`: `13` trades, `11` winners, `avg_profit_approved = +7.59`
- rejected `q4 LONG`: `1269` rows, `690` winners, `avg_profit = -2.57`
- rejected `q4 SHORT`: `715` rows, `497` winners, `avg_profit = +2.98`

This is the main new regime signal:

- `q4 LONG` is still bad and should remain watch-only
- recent `q4 SHORT` is no longer behaving like the old negative `q4` stream
- the current gate is probably too strict specifically on the `SHORT` side in the latest regime, not globally

### Pocket Findings (`n=2000`)

Approved `q5` winners are concentrated in very stretched flips:

- `SHORT | bearish bias aligned | dist 0.80-0.99 | slope >= 0.12 | stretch >= 0.16`: `7` wins, `avg_profit = +6.33`
- `SHORT | bullish bias conflict | dist 0.80-0.99 | slope >= 0.12 | stretch >= 0.16`: `3` wins, `avg_profit = +20.81`
- `LONG | bearish bias conflict | dist 0.80-0.99 | slope >= 0.12 | stretch >= 0.16`: `2` wins, `avg_profit = +10.68`

Approved loser sample is small but worth watching:

- one losing `SHORT` still came from the bullish-bias-conflict override path
- one losing `SHORT` had extreme overshoot (`distanceAtrRatio = 1.41`, `avgSlopePct = 4.236`, `closeVsAvgPct = 4.423`)

Rejected profitable `q4 SHORT` pockets are now the most important missed stream:

- `SHORT | bearish aligned | dist < 0.55 | slope >= 0.12 | stretch >= 0.16`: `180` wins, `avg_profit = +10.64`
- `SHORT | bullish conflict | dist < 0.55 | slope >= 0.12 | stretch >= 0.16`: `130` wins, `avg_profit = +8.99`
- `SHORT | bearish aligned | dist 0.55-0.69 | slope >= 0.12 | stretch >= 0.16`: `85` wins, `avg_profit = +10.85`
- `SHORT | bullish conflict | dist 0.55-0.69 | slope >= 0.12 | stretch >= 0.16`: `78` wins, `avg_profit = +10.68`

But these same `q4 SHORT` pockets also still contain large loser clusters:

- `SHORT | bearish aligned | dist < 0.55 | slope >= 0.12 | stretch >= 0.16`: `68` losses, `avg_profit = -14.19`
- `SHORT | bullish conflict | dist < 0.55 | slope >= 0.12 | stretch >= 0.16`: `63` losses, `avg_profit = -13.85`

Meaning:

- recent `q4 SHORT` drift is real, but the profitable pocket is not yet clean enough to reopen as-is
- the likely next step is a conditional `q4 SHORT` experiment, not a blanket `q4` rollback

### Current Improvement Hypothesis

If TrendShift needs more live participation without destroying the post-update expectancy gain:

1. keep `q5-only` for `LONG`
2. test a selective `q4 SHORT` allow-path only when:
   - `direction = SHORT`
   - `distanceAtrRatio` is below the current `q5` threshold but still not tiny
   - slope / stretch stay in the strong band already observed in the winners
3. separately consider an overextension cap for extreme `q5 SHORT` cases where `distanceAtrRatio` is already too far from the average

### Implemented Derivatives-Aware Gate Refinement (`2026-05-17`)

Applied adapter changes:

- keep `q5` in watch mode when derivatives show `oi_not_confirming` and there is no supporting liquidation flush in the reversal direction
- keep very overextended `SHORT` `q5` flips in watch mode when `distanceAtrRatio > 1.2` and there is no `long_liquidation_spike`

Why this was chosen:

- recent approved losers were much more concentrated in `oi_not_confirming` states than approved winners
- recent approved winners often had explicit flush support
- trading-session and Coinbase spread context did not show a clean enough separator for TrendShift in this export

Replay after the refinement on the same export:

Full export (`17966` rows):

- `approved = 143` vs `195` before
- `TP / FP / TN / FN = 105 / 38 / 7405 / 10418`
- `precision_approved = 73.4%` vs `69.7%` before
- `avg_profit_approved = +2.88` vs `+1.99` before
- `avg_profit_approved_per_day = +6.86` vs `+6.48` before
- `avg_profit_approved_per_month = +208.76` vs `+197.18` before
- `avg_approved_trades_per_day = 2.38` vs `3.25` before
- `avg_approved_trades_per_week = 16.69` vs `22.76` before
- `expectancy_delta = +4.42` vs `+3.53` before

Latest `2000` rows after the refinement:

- `approved = 13` vs `16` before
- `TP / FP / TN / FN = 13 / 0 / 800 / 1187`
- `precision_approved = 100%` vs `81.3%` before
- `avg_profit_approved = +11.46` vs `+7.37` before
- `avg_profit_approved_per_day = +26.05` vs `+20.63` before
- `avg_profit_approved_per_month = +792.82` vs `+627.82` before
- `avg_approved_trades_per_day = 2.27` vs `2.80` before
- `avg_approved_trades_per_week = 15.91` vs `19.58` before
- `expectancy_delta = +11.96` vs `+7.88` before

Latest `1000` rows after the refinement:

- unchanged versus the prior gate on this tail
- `approved = 7`
- `TP / FP / TN / FN = 7 / 0 / 451 / 542`
- `avg_profit_approved = +6.33`

Interpretation:

- this refinement improved approved expectancy on both the full export and the latest `2000` rows
- the gain came from filtering weakly confirmed `q5` cases, not from reopening `q4`
- derivatives context looks useful for defensive filtering of TrendShift approvals
- market session and spread context did not justify a direct gate rule in this export

### Selective q4 SHORT Experiment (`2026-05-17`)

Added a narrow exception path on top of the defensive gate:

- allow `q4 SHORT` as live-approved only when all of these hold:
  - `distanceAtrRatio >= 0.7 && < 0.8`
  - strong geometry already present inside the `q4` pocket
  - `long_liquidation_spike` exists
  - derivatives `directionAligned = true`
  - no `oi_not_confirming`
  - no session overlap

Rationale:

- broad `q4 SHORT` reopen still hurts the full March-May export too much
- but this much narrower follow-through pocket stayed positive on both the full export and the latest tail

Replay after the selective `q4 SHORT` allow-path:

Full export (`17966` rows):

- `approved = 173` vs `143` before the experiment
- `TP / FP / TN / FN = 131 / 42 / 7401 / 10392`
- `precision_approved = 75.7%` vs `73.4%` before
- `avg_profit_approved = +3.65` vs `+2.88` before
- `avg_profit_approved_per_day = +10.52` vs `+6.86` before
- `avg_profit_approved_per_month = +320.29` vs `+208.76` before
- `avg_approved_trades_per_day = 2.88` vs `2.38` before
- `avg_approved_trades_per_week = 20.19` vs `16.69` before
- `expectancy_delta = +5.19` vs `+4.42` before

Latest `2000` rows:

- `approved = 23` vs `13` before the experiment
- `TP / FP / TN / FN = 23 / 0 / 800 / 1177`
- `precision_approved = 100%`
- `avg_profit_approved = +14.64` vs `+11.46` before
- `avg_profit_approved_per_day = +58.90` vs `+26.05` before
- `avg_profit_approved_per_month = +1792.76` vs `+792.82` before
- `avg_approved_trades_per_day = 4.02` vs `2.27` before
- `avg_approved_trades_per_week = 28.15` vs `15.91` before
- `expectancy_delta = +15.15` vs `+11.96` before

Latest `1000` rows:

- `approved = 8` vs `7` before the experiment
- `TP / FP / TN / FN = 8 / 0 / 451 / 541`
- `precision_approved = 100%`
- `avg_profit_approved = +8.14` vs `+6.33` before
- `expectancy_delta = +9.45` vs `+7.64` before

Interpretation:

- this is the first `q4 SHORT` reopen that improved both the full export and the latest tail at the same time
- the gain comes from a very specific derivatives-backed bearish follow-through pocket, not from general `q4` relaxation
- `q4 LONG` should still remain watch-only

## Strategy Intent

`TrendShift` пытается брать разворот состояния тренда на adaptive average flip, а не продолжение уже растянутого импульса.

Ключевой риск здесь не в том, что gate слишком поздний, а в том, что текущий deterministic approval почти всегда пропускает обычный `q4` flip без достаточной фильтрации regime/context.

## Current Export And Config

Export:

- `data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl`
- rows: `53541`

Latest `1000` rows replay window:

- `2026-04-29 13:15 UTC -> 2026-05-02 12:15 UTC`

Redis backtest config `TrendShift:ai`:

```json
{
  "MA_FAST": [14],
  "MA_MEDIUM": [49],
  "MA_SLOW": [50],
  "OBV_SMA": [10],
  "ATR": [14],
  "ATR_PCT_SHORT": [7],
  "ATR_PCT_LONG": [30],
  "BB": [20],
  "BB_STD": [2],
  "MACD_FAST": [12],
  "MACD_SLOW": [26],
  "MACD_SIGNAL": [9],
  "TRENDSHIFT_MULTIPLICATIVE_FACTOR": [4],
  "TRENDSHIFT_SLOPE": [12],
  "TRENDSHIFT_ATR_LENGTH": [150],
  "TRENDSHIFT_WIDTH_PCT": [75],
  "TRENDSHIFT_CONFIRM_FLIP_WITH_CLOSE": [true],
  "TRENDSHIFT_MIN_FLIP_DISTANCE_ATR": [0.15],
  "TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP": [true],
  "TRENDSHIFT_MAX_FIGURE_POINTS": [180],
  "LONG": [{ "enable": true, "direction": "LONG", "TP": 2.8, "SL": 1.1, "minRiskRatio": 1.6 }],
  "SHORT": [{ "enable": true, "direction": "SHORT", "TP": 2.8, "SL": 1.1, "minRiskRatio": 1.6 }]
}
```

## Replay Mode Used

Main replay command:

```bash
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl -n 1000 --localOnly
```

Stricter comparison:

```bash
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl -n 1000 --localOnly --minQuality 5
```

Interpretation:

- `--localOnly` here is deterministic gate research for `AI_MODE=gate`
- it does not say anything about `AI_MODE=llm` provider behavior

## Latest Window Metrics

Default `q4+` stream (`MIN_AI_QUALITY=4`):

- `approved = 421`
- `TP / FP / TN / FN = 71 / 350 / 458 / 121`
- `precision_approved = 16.9%`
- `recall_winners = 37.0%`
- `avg_profit_all = -3.35`
- `avg_profit_approved = -3.96`
- `expectancy_delta = -0.62`

By direction:

- `LONG`: `41 / 166 / 255 / 63`, `avg_profit_approved = -3.89`
- `SHORT`: `30 / 184 / 203 / 58`, `avg_profit_approved = -4.03`

Deterministic flow:

- `signalAvailable = 1000`
- `coreBlocked = 0`
- `adapterBlocked = 0`
- `modelCandidate = 1000`
- `modelApproved = 421`
- `modelRejected = 579`

Quality breakdown:

- `q2`: `579` rows, `121` winners, not approved
- `q4`: `419` approvals, `70` winners, `avg_profit = -4.00`
- `q5`: `2` approvals, `1` winner, `avg_profit = +3.17`

## q4+ Approved Cadence / Profit

For the effective default approved stream `q4+`:

- `avg_profit_approved_per_day = -563.94`
- `avg_profit_approved_per_month = -17164.88`
- `avg_approved_trades_per_day = 142.31`
- `avg_approved_trades_per_week = 996.17`

Interpretation:

- cadence is very high, but that is not a strength here
- the gate is approving too many flips into a negative expectancy stream

## q5+ Comparison

Stricter `q5+` replay on the same window:

- `approved = 2`
- `TP / FP / TN / FN = 1 / 1 / 807 / 191`
- `precision_approved = 50.0%`
- `avg_profit_approved = +3.17`
- `avg_profit_approved_per_day = +2.14`
- `avg_profit_approved_per_month = +65.18`
- `avg_approved_trades_per_day = 0.68`
- `avg_approved_trades_per_week = 4.73`

Interpretation:

- `q5+` is positive on this window
- but it is only `2` trades, so it is not enough to justify a live conclusion by itself
- the real problem is that current `q4` dominates the stream and is deeply negative

## Additional Wider Tail Check (`n=2000`)

Wider replay window:

- `2026-04-27 01:45 UTC -> 2026-05-02 12:15 UTC`

Command:

```bash
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl -n 2000 --localOnly
```

Default `q4+` on `n=2000`:

- `approved = 891`
- `TP / FP / TN / FN = 180 / 711 / 794 / 315`
- `precision_approved = 20.2%`
- `recall_winners = 36.4%`
- `avg_profit_all = -1.72`
- `avg_profit_approved = -2.99`
- `expectancy_delta = -1.28`

`q4+` approved cadence/profit on `n=2000`:

- `avg_profit_approved_per_day = -490.64`
- `avg_profit_approved_per_month = -14933.97`
- `avg_approved_trades_per_day = 163.86`
- `avg_approved_trades_per_week = 1147.03`

Quality breakdown on `n=2000`:

- `q2`: `1109` rows, `315` winners, not approved
- `q4`: `885` approvals, `176` winners, `avg_profit = -3.08`
- `q5`: `6` approvals, `4` winners, `avg_profit = +9.05`

Stricter `q5+` on `n=2000`:

```bash
yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl -n 2000 --localOnly --minQuality 5
```

- `approved = 6`
- `TP / FP / TN / FN = 4 / 2 / 1503 / 491`
- `precision_approved = 66.7%`
- `avg_profit_approved = +9.05`
- `avg_profit_approved_per_day = +9.99`
- `avg_profit_approved_per_month = +303.95`
- `avg_approved_trades_per_day = 1.10`
- `avg_approved_trades_per_week = 7.72`

Interpretation:

- widening from `1000` to `2000` does not rescue `q4+`
- `q4+` remains decisively negative and actually gets worse on `expectancy_delta`
- `q5+` still looks positive, but it remains a tiny stream
- `q5` is mostly a `LONG` phenomenon in this window: `5` LONG rows, `1` SHORT row, and the only SHORT `q5` loser is negative

Rejected-winner pattern on `n=2000`:

- all `315 / 315` rejected winners are still `coin_bias_conflict`
- `SHORT | coin_bias_conflict`: `191` winners, `avg_profit = +19.76`
- `LONG | coin_bias_conflict`: `124` winners, `avg_profit = +18.56`

This is the strongest stability signal from the wider tail:

- the false-negative pattern is not a `1000`-row accident
- the current hard block on `coinBiasAligned === false` is very likely over-strict for TrendShift

## Implemented Gate Update (`2026-05-02`)

Changed:

- `coin_bias_conflict` is no longer a structural hard block by itself
- ordinary `q4` flips are now watch-only
- live approval now requires `q5` geometry
- strong `q5` flips may still pass even when `coinBiasAligned === false`

Rationale:

- pre-update `q4+` was massively over-approving and negative on both `n=1000` and `n=2000`
- full hard-blocking `coin_bias_conflict` was also too blunt, because it removed a large set of profitable flips
- the cleanest defensive policy was to stop treating ordinary `q4` as live-approved at all

### After Gate Update

Targeted test:

```bash
yarn unit packages/strategies/src/TrendShift/__tests__/ai.test.ts
```

Result:

- `4/4` tests passed

Latest `1000` rows after the gate update:

- command: `yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl -n 1000 --localOnly`
- `approved = 14`
- `TP / FP / TN / FN = 6 / 8 / 800 / 186`
- `precision_approved = 42.9%`
- `recall_winners = 3.1%`
- `avg_profit_all = -3.35`
- `avg_profit_approved = +4.91`
- `avg_profit_approved_per_day = +23.25`
- `avg_profit_approved_per_month = +707.64`
- `avg_approved_trades_per_day = 4.73`
- `avg_approved_trades_per_week = 33.13`
- `expectancy_delta = +8.26`

Quality breakdown after the gate update on `n=1000`:

- `q4`: `986` rows, `0` approvals, `186` winners, `avg_profit = -3.46`
- `q5`: `14` approvals, `6` winners, `avg_profit = +4.91`

Latest `2000` rows after the gate update:

- command: `yarn ai-train --file data/ai/export/ai-dataset-trendshift-merged-1777741501722.jsonl -n 2000 --localOnly`
- `approved = 35`
- `TP / FP / TN / FN = 22 / 13 / 1492 / 473`
- `precision_approved = 62.9%`
- `recall_winners = 4.4%`
- `avg_profit_all = -1.72`
- `avg_profit_approved = +9.46`
- `avg_profit_approved_per_day = +60.88`
- `avg_profit_approved_per_month = +1852.93`
- `avg_approved_trades_per_day = 6.44`
- `avg_approved_trades_per_week = 45.06`
- `expectancy_delta = +11.17`

Quality breakdown after the gate update on `n=2000`:

- `q4`: `1965` rows, `0` approvals, `473` winners, `avg_profit = -1.91`
- `q5`: `35` approvals, `22` winners, `avg_profit = +9.46`

Interpretation:

- the gate is now much more selective
- approved expectancy flipped from negative to strongly positive on both tail windows
- this is now a defensive high-conviction gate, not a broad participation gate
- recall is intentionally low; the strategy still earns its raw backtest through many trades that the new gate will simply watch and skip

## Main Discoveries

1. Current `TrendShift` deterministic gate is too permissive at `q4`.

- `419 / 421` approvals come from `q4`
- that `q4` bucket has only `16.7%` winners and `avg_profit = -4.00`

2. All missed winners in this window are blocked by the same rule: `coin_bias_conflict`.

- rejected profitable rows: `121`
- all `121 / 121` are `coin_bias_conflict`
- none come from `unconfirmed_flip` or `weak_flip_distance`

3. The adapter is not using any soft regime filter once `coinBiasAligned !== false`.

- `coreBlocked = 0`
- `adapterBlocked = 0`
- every selected row becomes a model candidate
- approval is then decided almost entirely by three numeric thresholds:
  `distanceAtrRatio >= 0.45`, `|avgSlopePct| >= 0.04`, `|closeVsAvgPct| >= 0.05`

4. `LONG` and `SHORT` are both bad under current `q4+`.

- `LONG` is slightly less bad on expectancy
- `SHORT` has even worse approved precision
- this does not look like a one-side-only issue

## Best And Worst Pockets

Best observed approved pocket in this tail:

- `q5` micro-sample: `2` approvals, `1` winner, `avg_profit = +3.17`

Best repeated `q4` winner pockets existed, but they are drowned out by much larger loser pockets:

- `LONG | bullish bias | distance < 0.55 | high slope | high close stretch`: `26` wins, `avg_profit = +18.33`
- `SHORT | bearish bias | distance < 0.55 | high slope | high close stretch`: `11` wins, `avg_profit = +19.48`

Largest loser pockets under current approvals:

- `SHORT | bearish bias | distance < 0.55 | high slope | high close stretch`: `120` losses, `avg_profit = -8.44`
- `LONG | bullish bias | distance < 0.55 | high slope | high close stretch`: `97` losses, `avg_profit = -9.82`

Meaning:

- the current context fields are not separating good and bad flips inside the same broad pocket
- raw slope / stretch / distance alone are insufficient as live approval criteria

## Concrete Next Improvements

### Strategy Core

1. Add or expose more regime context at signal time instead of only flip geometry.

- likely candidates: higher-timeframe trend agreement, post-flip continuation confirmation, or session/derivatives context already present elsewhere in the payload

2. Consider delaying entry by one confirming bar if same-bar flips are the source of churn.

### Backtest Config

1. Re-run `backtest -> ai-export -> ai-train --localOnly` with stricter gate validation instead of only detector tuning.

2. Current grid is narrow and symmetric on TP/SL.

- detector params alone are unlikely to rescue this gate
- the main issue is approval policy, not obvious TP/SL imbalance

### AI Adapter

1. Demote current `q4` to watch-only or require another confirmation layer before approval.

2. Revisit `coin_bias_conflict` specifically.

- in this tail it blocked `121` winners and nothing else
- a hard block is probably too strict
- better options are downgrade to `q3` or conditional allow when flip geometry is very strong

3. Make `q5` reachable more often only if extra confirmation is genuinely selective.

- right now `q5` looks better, but sample size is only `2`
- do not treat that as proof until the next fresh export reproduces it
