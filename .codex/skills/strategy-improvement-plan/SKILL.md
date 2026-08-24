---
name: strategy-improvement-plan
description: Analyze how one TradeJS strategy could be improved from its source, latest candidate, production comparison, traces, and rejected hypotheses. Use for an opportunity map or research plan; do not run experiments, edit code, or change production.
---

# Strategy Improvement Plan

Require one exact strategy name. Read the strategy repository rules, source,
tests, latest selected candidate, production composition, prior candidate
ledger, rejection reasons, and available signal-to-exit traces.

## Boundary

This skill produces a causal research plan only. Do not run backtests or gate
searches, edit source, create a new candidate, publish, deploy, or change risk.

## Analysis

Reconstruct the market thesis and map evidence across:

- setup formation and point-in-time data quality;
- entry timing, direction policy, and regime dependence;
- stop/target geometry, payoff asymmetry, and worst-loss mechanics;
- position lifecycle, shared occupancy, cooldown, and exits;
- deterministic gate precision, rejection coverage, and missing context;
- symbol/time concentration, capacity, fees, slippage, and execution parity.

Do not recommend generic threshold grids. For every proposed change state the
mechanism, exact source/config seam, predicted trade-identity and metric effect,
minimum falsifying observation, affected side/regime, and overfit risk.

## Professional objective

Rank hypotheses hierarchically:

1. causal validity, trace reconciliation, and absence of leakage;
2. positive out-of-sample expectancy per risk after costs with enough
   independent support;
3. Sharpe/PSR/DSR, drawdown/tail loss, recovery, loss streaks, and losing-month
   streaks;
4. walk-forward/regime stability, concentration, cost robustness, and
   executable cadence;
5. full-period PnL and win rate as economic diagnostics, never sole targets.

Recent 7d/30d/180d rows describe the current regime with support-aware weight;
they are not mandatory profit gates when sparse. Avoid objectives that improve
Sharpe or win rate by suppressing almost all trades.

Return an ordered plan with one exploit hypothesis, one repair hypothesis, one
explore/falsify hypothesis, frozen evaluation criteria, expected cost, and the
exact invocation of `$strategy-improvement-research`.
