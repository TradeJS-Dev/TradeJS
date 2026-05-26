# DoubleTap AI Replay Notes

Last updated: 2026-05-26.

This file keeps internal notes for `ai-train` replay windows and DoubleTap AI gate analysis.

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

