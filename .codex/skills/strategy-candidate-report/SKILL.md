---
name: strategy-candidate-report
description: Show the latest selected best candidate for one TradeJS strategy, including exact lineage, configuration, gate, freshness, chart, and professional risk-adjusted metrics. Use for “show the best candidate” or “latest candidate metrics”; do not run new research or change runtime state.
---

# Strategy Candidate Report

Require one exact strategy name. Work from the TradeJS project that owns
`tradejs.config.ts`, `data/`, and research evidence.

## Boundary

This is a reporting skill. Do not edit strategy source or configuration, start
backtests, publish packages, change `tradejs.config.ts`, or mutate a runtime.
Creating a report or chart under `output/` is allowed.

## Select the candidate

1. Find the newest completed research lineage that explicitly selected a best
   candidate and has checksum-verifiable evidence. Do not equate newest file,
   largest PnL, an incomplete run, or an old production config with “best.”
2. Prefer a verified strategy-release/candidate manifest. If evidence exists
   only in notes, require the exact source SHA, resolved config, gate identity,
   data bounds, costs, and artifact hashes before calling it reproducible.
3. If there is no selected reproducible candidate, say so. Show the strongest
   known evidence separately, but do not silently promote it.

## Report

Show:

- candidate ID, selection time, research ID, source/package revision, dirty
  state, core config, deterministic gate and direction policy;
- data start/end, universe provenance, fees/slippage, train/discovery/test
  exposure, and the newest evaluated candle;
- ALL, LONG, and SHORT rows for full/max coverage plus available continuous
  3y, 4y, 5y-or-max, 365d, 180d, 90d, 30d, and 7d windows;
- `N`, net PnL, PnL/trade, PF, win rate, Sharpe, probabilistic/deflated Sharpe
  when available, realized MaxDD, worst trade, maximum loss streak, maximum
  losing-month streak, recovery duration, and cadence;
- walk-forward/fold and regime stability, concentration, cost stress, and all
  recorded limitations or failed checks;
- a stored equity/drawdown chart, or rebuild the chart only from the frozen
  candidate trades and label it as report rendering rather than new evidence.

Classify every window by independent support: fewer than 20 events is
underpowered, 20–49 is diagnostic, and 50+ is selection-grade. A zero-trade or
sparse 7d/30d row must remain visible, but it is not a standalone veto and does
not imply that anyone must wait for a calendar deadline.

Finish with one exact next skill: compare, plan, revalidate, or forward-start.
