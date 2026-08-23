---
name: strategy-candidate-compare
description: Compare one TradeJS strategy’s latest selected best candidate with the exact composition currently deployed or configured for production on a common evidence scope. Use for candidate-vs-production questions; do not tune, publish, deploy, or change risk.
---

# Strategy Candidate Compare

Require one exact strategy name.

## Boundary

This is a read-only comparison. Do not edit source/config, select new
parameters, publish, deploy, or alter orders. A single cache-only bridge run is
allowed only when the two frozen compositions lack a valid common-scope result;
it must not change either composition.

## Resolve both identities

1. Resolve the latest explicitly selected, reproducible candidate using the
   same rules as `$strategy-candidate-report`.
2. Resolve production from the deployed package manifest and Git-owned
   `tradejs.config.ts`, including effective defaults, package lock, deterministic
   gate, runtime context, `strategyRevision`, and `deploymentCompositionId`.
   Redis backtest configs and legacy strategy keys are not production truth.
3. If live evidence is unavailable, use the newest immutable deployment
   manifest and label production identity as unconfirmed rather than guessing.

## Make the comparison fair

Use the maximum common timestamp range, point-in-time universe, symbols,
interval, fees, slippage, entry delay, risk unit, and execution assumptions.
Normalize PnL and drawdown per unit of `MAX_LOSS_VALUE` when production and the
candidate use different risk. Never compare raw money at different sizing as
strategy quality.

If a bridge is necessary, freeze the comparison before running it, use cached
history, run both exact compositions, and record the new run as evaluation—not
optimization. Do not inspect one result and alter the other.

## Output

Show side-by-side absolute values and candidate-minus-production deltas for
ALL/LONG/SHORT across full/max coverage and continuous 365d/180d/90d/30d/7d
windows, plus 3y/4y/5y-or-max when covered. Include `N`, net PnL, expectancy,
PF, win rate, Sharpe/PSR/DSR, MaxDD, worst trade, loss streak, losing-month
streak, recovery, cadence, stability, concentration, and cost stress.

Conclude with:

- identity/parity confidence;
- what improved, regressed, or remains underpowered;
- whether the candidate remains the selected best candidate under the frozen
  objective;
- one exact next action. Do not launch it from this skill.
