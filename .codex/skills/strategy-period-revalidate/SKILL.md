---
name: strategy-period-revalidate
description: Re-evaluate one TradeJS strategy’s production composition and strongest prior candidates on a newly extended common period without retuning them. Use when new market data is available or old candidates must be revalidated under the current metric objective.
---

# Strategy Period Revalidate

Require one exact strategy name and use the TradeJS project as the evidence
root.

## Boundary

This is frozen-behavior evaluation. Do not alter strategy logic, gate rules,
parameters, direction policy, or runtime state after seeing the new period. Do
not publish or deploy. A configuration change belongs to a new
`$strategy-improvement-research` lineage.

## Cohort

Include the exact current production composition, latest selected best
candidate, strongest prior aggregate candidate, strongest side-specific
candidate when distinct, and any currently running forward candidate. Deduplicate
identical core/gate/context behavior. Record why any plausible prior candidate
cannot be reproduced.

## Run

1. Freeze the new common end time, maximum common start, point-in-time universe,
   costs, execution assumptions, and candidate identities before evaluation.
2. Use existing cached history first. If the requested new tail is absent,
   fetch only that missing tail through the supported TradeJS data path, then
   fingerprint the resulting coverage; never silently rewrite old history.
3. Evaluate all frozen candidates on identical scopes. Do not eliminate a
   candidate after one window and do not tune against the new observations.
4. Recompute ALL/LONG/SHORT full/max, 3y/4y/5y-or-max, 365d, 180d, 90d, 30d,
   and 7d rows where covered, including zero-activity rows. Report PnL/risk,
   PF, expectancy, win rate, Sharpe/PSR/DSR, MaxDD, worst loss, loss streak,
   losing-month streak, recovery, cadence, stability, concentration, and cost
   stress.
5. Weight recent windows by independent support: below 20 underpowered, 20–49
   diagnostic, 50+ selection-grade. Never require waiting 7, 30, or 180
   calendar days merely to obtain a verdict.

Update the immutable comparison evidence and candidate freshness without
rewriting the original selection record. State whether the incumbent remains
best under the frozen objective and choose exactly one next skill: report,
research, forward-start, forward-status, or risk-scale.
