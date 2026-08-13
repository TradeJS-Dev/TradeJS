# Evidence limitations and action ceiling

Classify an evidence problem before deciding whether to stop work. Do not use
the generic word `contamination` for limitations with different consequences.

## Hard invalidation

These conditions invalidate selection economics and stop the affected run:

- outcome, future, or delayed-execution fields entered a signal-time decision;
- export and Redis N/W/L do not reconcile;
- the manifest is partial, failed, OOM, or belongs to another run;
- candidate and control use different causal windows, costs, or data revisions;
- a strategy state/reset leak mixes candidate cells;
- required candles or causal context are absent for the evaluated timestamps.

Repair or rerun the invalid evidence. A hard-invalid run cannot rank a
candidate, but the failure does not excuse skipping other valid families.

## Research-grade provenance limitation

These conditions reduce the claim ceiling but do not stop paired research:

- the current deployable symbol cohort is applied retrospectively because
  effective-dated exchange membership is unavailable;
- a chronological tail was exposed before variant freeze;
- an old uncommitted patch is not byte-reconstructable, while its causal
  mechanism can be implemented again as a new candidate;
- remote deployment/account bindings are absent on the local research machine;
- prospective independent-event support is not yet available.

For a retrospective current-universe cohort:

1. Label the estimand honestly: "performance of today's deployable cohort over
   its available cached history", not historical exchange-wide performance.
2. Keep control and candidates on the identical cohort/window and emphasize
   matched setup/trade deltas over absolute PnL.
3. Run membership sensitivity when the cache permits it: stable incumbent
   symbols, minimum cached-history-age cohorts, and leave-one-symbol/event
   concentration checks. Never invent listing/delisting dates.
4. Use the result to select a prospective candidate. It cannot by itself
   establish unconditional historical robustness or `READY_FOR_RUNTIME`.
5. If the bounded composition otherwise qualifies, prepare or start the
   authorized risk-1 micro-forward. Prospective current-universe evidence is the
   correct way to resolve this limitation; waiting for a perfect historical
   membership archive is not.

An exposed holdout follows the same action rule: it cannot establish a sealed
historical release claim, but it may select one immutable prospective
composition. Do not tune again after that selection.

## Operational limitation

Missing local runtime bindings, credentials, or server Redis records do not
block local research. Produce the portable handoff and mark it
`requiresRuntimeBinding=true`. Resolve the binding only on the runtime server.

## Action matrix

| Limitation                         | Continue core/gate research           | Historical READY claim | Risk-1 micro-forward                    |
| ---------------------------------- | ------------------------------------- | ---------------------- | --------------------------------------- |
| Causal leakage/lookahead           | No, repair evidence                   | No                     | No                                      |
| Reconciliation/partial run         | No, rerun                             | No                     | No                                      |
| Retrospective current universe     | Yes, paired/sensitivity               | No                     | Yes                                     |
| Exposed holdout                    | Yes, without retuning after selection | No                     | Yes                                     |
| Missing old patch, mechanism known | Yes, new implementation lineage       | No claim from old run  | Yes after new evidence                  |
| Missing local server binding       | Yes                                   | Unaffected             | Portable handoff locally; bind remotely |

Record one of these ceilings in the release progress artifact:

- `historical_ready_eligible`;
- `micro_forward_only`;
- `invalid_evidence`.

The ceiling controls claims, not whether Codex performs the next bounded
research action.
