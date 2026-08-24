---
name: strategy-forward-status
description: Inspect the live status and evidence of one TradeJS strategy’s forward test, including deployed identity, parity, orders, normalized performance, drawdown, execution quality, and whether the test is still informative. Read-only; does not scale, stop, or deploy.
---

# Strategy Forward Status

Require one exact strategy name and resolve the exact runtime user/deployment.

## Boundary

This skill is read-only. Do not edit source/config, pause/resume, place/cancel
orders, scale risk, publish, or deploy. Missing local Redis keys are not proof
that production did not run; prefer immutable runtime evidence from the target
deployment.

## Inspect

Verify the deployed manifest, package version, full effective config,
`strategyRevision`, `deploymentCompositionId`, account/connector/symbol binding,
`MAX_LOSS_VALUE`, heartbeat, and single-process ownership. Compare all of them
with the selected candidate manifest and classify exact match, explainable
drift, or invalid forward evidence.

Collect runtime evidence and reconcile signal → gate decision → order → fill →
exit. Report:

- independent closed positions, open exposure, cadence, and elapsed market
  coverage;
- PnL and drawdown normalized by the candidate risk unit;
- expectancy, PF, win rate, Sharpe when meaningful, worst loss, current and
  maximum loss streak, losing-month streak, and recovery;
- fees, slippage, rejects, latency, partial fills, missed/duplicate decisions,
  parity mismatches, symbol/regime concentration, and historical-envelope
  utilization;
- prospective evidence only—never merge live observations back into the
  historical selection sample.

Classify the forward test as `RUNNING_INFORMATIVE`, `RUNNING_UNDERPOWERED`,
`PAUSED_OR_STOPPED`, `COMPOSITION_DRIFT`, or `EXECUTION_INVALID`. Calendar age
alone is not success or failure; weight the number and diversity of independent
events. Finish with one exact recommendation: keep collecting, diagnose via a
new research task, stop through the deployment runbook, or invoke
`$strategy-risk-scale`.
