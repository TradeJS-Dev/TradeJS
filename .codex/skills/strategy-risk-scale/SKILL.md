---
name: strategy-risk-scale
description: Increase MAX_LOSS_VALUE for a currently running TradeJS forward strategy while preserving the exact core, gate, context, direction policy, package, and deployment composition. Use only after explicit user instruction to increase risk; never switch candidates or wait for fixed calendar tails.
---

# Strategy Risk Scale

Require one exact strategy name. Invocation authorizes one bounded risk step
for the currently deployed composition only.

## Invariants

Freeze and verify source/package revision, full config, deterministic gate and
context, direction policy, universe, connector/account, deployment, and current
`strategyRevision`/`deploymentCompositionId`. Apart from `MAX_LOSS_VALUE`, all
strategy behavior must remain identical. If anything else differs, stop and
route to `$strategy-forward-start` or `$strategy-improvement-research`.

Do not use “7 profitable days” or “wait 30 days” as a generic gate. Use the
candidate’s preregistered event-driven scaling policy. If none exists, require
enough independent closed positions to estimate expectancy and drawdown,
positive after-cost normalized expectancy, execution/parity integrity,
acceptable slippage and concentration, and normalized drawdown/tail losses
inside the frozen historical stress envelope. Treat fewer than 20 independent
events as underpowered and 20–49 as diagnostic unless unusually strong
strategy-specific evidence justifies the recorded exception.

## Scale

1. Produce a read-only forward status and scaling decision first. Refuse the
   step on composition drift, execution-invalid evidence, unresolved critical
   parity errors, breached loss envelope, or missing deployment binding.
2. Increase risk by only one preregistered step, never more than 2× the current
   value and never above the candidate’s approved cap.
3. Change only `MAX_LOSS_VALUE` in Git-owned `tradejs.config.ts`. Run strict
   checks, commit and push the complete Project release range, publish/deploy
   the exact immutable tip through the existing workflow, and verify the new
   deployment atomically.
4. Record a risk-scale marker linking old/new values and deployment identities;
   keep historical and live performance normalized to a common risk unit.

Never place, cancel, or close orders manually and never start an unmanaged
daemon. Return the evidence decision, old/new risk, Project commit, deployment
identity, verification, monitoring threshold, and rollback condition.
