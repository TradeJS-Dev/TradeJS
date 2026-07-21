# VolatilityCompressionBreakout deterministic AI-gate replay notes

Date: 2026-07-21

## Conclusion

The strategy never had a deterministic AI gate before this research. Its
adapter only copied `volatilityCompressionBreakoutContext` into the payload, so
the shared local fallback assigned quality 3 to every row. Consequently q4+
and q5+ approved zero trades both at the introducing commit `80d9cb65` and at
the pre-change HEAD `40f51410`.

The rebuilt gate approves only fresh SHORT breakouts with enough structural and
execution margin:

- signal direction is `SHORT`;
- signal-time stop distance is at least 125 bps;
- price is at least 3% below the trend-follow trail;
- RSI is at least 25, avoiding already oversold breakdowns;
- 24h price change is at least -6%, avoiding late chase entries;
- quality 5 is reserved for the fresher subset with 24h price change at least
  -5%; the remaining approved rows receive quality 4.

On the supplied export this changes q4+ from zero trades to 41 trades with
`+133.39` net PnL and PF `1.51`. q5+ contains 33 trades with `+138.28` and PF
`1.71`.

This is a profitable result on the supplied historical export, not yet a
production-readiness claim. The final 25% time holdout has only seven q4+
approvals (five q5+), below the preferred minimum validation support of 25.

## Dataset and lineage

- Dataset: `ai-dataset-volatilitycompressionbreakout-merged-1784626121629`
- Shards: parts 1 through 7
- Rows: 3,950
- Timestamp range: 2025-07-20 15:30 UTC through 2026-07-19 11:45 UTC
- Span: 363.84 days
- Data lag at replay: 1.95 days
- Strategy config id in the export: `13x5b4`
- Git SHA: `40f51410f78c25e498f893b6827ee8a4d96645cc` with a dirty worktree
- Final gate fingerprint: `b0106afdf6c5aeb5`
- Config ids fingerprint: `648ee910d4baad22`
- Context fingerprint: `4186a11d2ef809af`
- Replay mode: local deterministic, `MIN_AI_QUALITY=4`
- Derivatives context: enabled, BTC benchmark context, target context disabled,
  48h lookback, references BNB/SOL/TRX/XRP

The active Redis config is
`users:root:backtests:configs:VolatilityCompressionBreakout:ai`. It keeps both
LONG and SHORT enabled, `MAX_LOSS_VALUE=10`, `VCB_TARGET_R_MULT=2.2`, both
compression filters, MTF alignment, and trade-flow alignment. The AI gate, not
the strategy config, disables the unprofitable LONG side for this dataset.

## Previous gate history

`git log --all -- packages/strategies/src/VolatilityCompressionBreakout`
contains the initial implementation and later StrategyAPI refactors:

- `80d9cb65 Add context-based AI strategy candidates`
- `118d9fc6 Remove direct strategy indicator advancement API`
- `7dcae9b0 Improve replay-safe strategy data access`
- `a4442f92 Simplify StrategyAPI contracts`

The adapter blob at `80d9cb65` and the pre-change HEAD has the same SHA-256:
`5278fcb3a2dc2f36375487dd45909471340889fdb88ff071a6632d08982ab082`.
No historical revision contained `postProcessAnalysis`. The zero-approval
baseline was therefore an unimplemented gate, not a regression from an older
profitable gate.

## Pre-change baseline

The authoritative pre-change `ai-train --localOnly --json -n 0` replay
assigned quality 3 to all 3,950 rows:

- q4+: 0 approvals
- q5+: 0 approvals
- raw PnL: `-49,112.70`
- raw LONG: 727 trades, `-8,113.81`
- raw SHORT: 3,223 trades, `-40,998.89`
- raw winners / losers: 1,101 / 2,849
- last 180d raw PnL: `-29,653.11`
- last 90d raw PnL: `-14,835.60`
- last 30d raw PnL: `-8,000.65`
- last 7d raw PnL: `-3,424.38`

The 30-day cache-only backtest of the active `:ai` config produced 510
successful tickers, two timeouts, average PnL per ticker `-14.28`, and win rate
`25.8%` (`data/backtests/output/202607211304-VolatilityCompressionBreakout-ai.md`).

A separate cache-only grid over target R `1.5`, `2.2`, and `3.0`, with opposite
breakout exit both enabled and disabled, remained negative. The best result was
average PnL `-13.02` and win rate `28.6%` at target R `1.5`. Opposite-breakout
exit made no difference because all 3,950 exported outcomes were stop-loss or
take-profit exits.

## Research and rejected hypotheses

The supplied pocket report's best validation-positive rule had only four
validation rows and used absolute SOL open interest, a scale/time proxy. It was
not accepted.

Expanded full-year and 180-day searches found no positive atomic pocket and no
broad generic context-score, breakout-strength, participation, direction, or
risk-distance rule that stayed profitable on both train and validation.
Notable rejected classes:

- generic shared `gateFeatures` scores;
- LONG or SHORT breakout/body/pressure thresholds;
- volume and range-expansion thresholds;
- `rewardToVolatility` and `stopDistanceAtr` thresholds;
- the provided SOL open-interest/funding pocket;
- target-R changes in cache-only backtests.

The export contains 2,685 stop losses totalling `-61,082.02` and 1,265 take
profits totalling `+11,969.32`. This led to adding causal signal-time risk
distances to the permanent pocket-search feature collector:

- `derived.stopDistanceBps`
- `derived.takeProfitDistanceBps`

These use requested current/stop/TP prices only. Execution prices, delayed fill
telemetry, exit reason, and final trade result are not gate inputs.

The stable hypothesis is a fresh downside expansion rather than a late chase.
Across the 18 neighboring combinations of stop `120-130` bps, trail distance
`-2.9%` to `-3.1%`, and 24h freshness `-5%` to `-6%`, every combination was
positive on both train and validation. The selected wider rule keeps more
trades.

## Final authoritative replay

Command shape:

```bash
yarn ai-train --strategy VolatilityCompressionBreakout \
  --file data/ai/export/ai-dataset-volatilitycompressionbreakout-merged-1784626121629-part1.jsonl \
  --localOnly --json -n 0 --terminalWindows=180,90,30,7
```

| Stream | Trades | WR | PF | PnL | Max DD | Trades/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| q4+ full | 41 | 48.8% | 1.51 | +133.39 | 113.62 | 0.113 |
| q5+ full | 33 | 51.5% | 1.71 | +138.28 | 74.69 | 0.091 |
| q4+ last 180d | 11 | 54.5% | 1.95 | +57.57 | 24.36 | 0.061 |
| q4+ last 90d | 7 | 71.4% | 4.08 | +75.00 | 24.36 | 0.078 |
| q4+ last 30d | 2 | 100.0% | n/a | +39.78 | 0.00 | 0.067 |
| q4+ last 7d | 0 | n/a | n/a | 0.00 | 0.00 | 0.000 |

The no-trade 7-day window is reported explicitly. The gate did not approve the
three recent wide-stop late SHORTs that the less selective prototype admitted;
all three ended at stop loss.

Time-ordered validation for q4+:

- first 50% / last 50%: 33 trades, `+70.77`, PF `1.32` / 8 trades,
  `+62.62`, PF `2.70`;
- first 75% / last 25%: 34 trades, `+58.39`, PF `1.25` / 7 trades,
  `+75.00`, PF `4.08`.

Monthly PnL is not uniformly positive. November 2025 is the main losing
cluster, so the full-sample edge remains moderate despite the positive split
results.

## Ablations and negative controls

The post-build ablation confirms that the real adapter baseline exactly equals
the research expression:

| Variant | Trades | PF | PnL | Validation trades | Validation PnL |
| --- | ---: | ---: | ---: | ---: | ---: |
| current adapter q4+ | 41 | 1.51 | +133.39 | 7 | +75.00 |
| expression replacement | 41 | 1.51 | +133.39 | 7 | +75.00 |
| q5 freshest subset | 33 | 1.71 | +138.28 | 5 | +66.59 |
| q4 margin-only band | 8 | 0.92 | -4.89 | 2 | +8.41 |
| same setup, late 24h move below -6% | 96 | 0.90 | -79.49 | 18 | -33.87 |
| approve every SHORT | 3,223 | 0.22 | -40,998.89 | 819 | -10,653.01 |

The negative controls show that data availability and direction alone are not
approval evidence. The 24h freshness boundary separates the profitable fresh
breakdown pocket from the losing late-chase population in this export.

## Artifacts

- `data/ai/output/volatilitycompressionbreakout-final-evaluations.jsonl`
- `data/ai/output/volatilitycompressionbreakout-final-gate-ablation.json`
- `data/ai/output/volatilitycompressionbreakout-fresh-breakdown-sensitivity.json`
- `data/ai/output/volatilitycompressionbreakout-final-sensitivity.json`
- `data/ai/output/volatilitycompressionbreakout-atomic-ablation.json`
- `data/ai/output/volatilitycompressionbreakout-strategy-features-ablation.json`
- `data/ai/output/volatilitycompressionbreakout-risk-distance-ablation.json`
- `data/ai/output/ai-pocket-search-volatilitycompressionbreakout-merged-1784626121629-all-2026-07-21T10-14-07Z.md`

Before treating the gate as production-ready, collect a new export with at
least 25 out-of-sample approvals under the same gate/config/context lineage and
repeat the terminal-window and negative-control checks.
