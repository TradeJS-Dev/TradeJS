# Release research objective and candidate revalidation

## Contents

1. Version the objective
2. Use a hierarchical objective
3. Condition terminal evidence on support
4. Revalidate historical candidates
5. Keep one global trial ledger
6. Required artifacts
7. Progress checkpoint payload

## 1. Version the objective

Every release task starts a new immutable lineage unless the user explicitly
names an existing lineage to continue. Audit prior work, but never count a
prior round, rescue child, gate ablation, report, or verdict as work completed
inside the new lineage.

Before the baseline, persist a `tradejs-release-objective/v2` artifact. Its
file SHA-256 is the `objectiveFingerprint` for the lineage. Freeze:

- the return unit and risk normalization;
- cost/slippage and adverse-cost scenarios;
- development, tuning, sealed-test, walk-forward, and terminal partitions;
- eligibility gates, Pareto dimensions, and tie-break rules;
- independent-event grouping and support bands;
- drawdown, concentration, capacity, and execution guardrails;
- the global trial-ledger reference used for DSR/PBO.

Any change to these fields creates a new objective fingerprint. Do not reuse a
ranking, verdict, or selected candidate from another fingerprint.

## 2. Use a hierarchical objective

Do not maximize full-period PnL, Sharpe, win rate, or recent-window PnL in
isolation. Use this hierarchy:

1. **Integrity and causality.** Complete reconciled evidence, signal-time
   inputs, point-in-time execution semantics, and comparable risk/cost units
   are mandatory.
2. **Economic edge.** Require positive aggregate expectancy per unit risk after
   normal costs and PF above 1 on the maximum-covered historical evaluation.
   Apply the same check to every active approved side; an explicitly suppressed
   side remains a zero row. Nested calendar slices do not repeat this gate.
3. **Selection adjustment.** Report probabilistic and deflated Sharpe using
   non-IID-aware returns and the complete effective trial count. A raw
   per-trade annualized Sharpe is diagnostic, not selection authority.
4. **Risk robustness.** Enforce preregistered realized MaxDD, tail/CVaR,
   recovery, time-under-water, adverse-cost, concentration, and capacity
   guardrails.
5. **Temporal robustness.** Prefer non-overlapping/event-grouped walk-forward
   evidence and regime coverage. Nested 3y/4y/max and recent calendar windows
   are context, not independent confirmations or waiting periods.
6. **Executable support.** Require independent events, viable cadence, and an
   event-arrival rate consistent with the strategy thesis.

Rank eligible candidates on a Pareto frontier across expectancy/risk, PF,
deflated Sharpe, MaxDD/recovery, walk-forward stability, cost stress,
independent support, and cadence. Use a scalar score only as a frozen tie-break,
never to compensate for a failed integrity or economic gate.

Treat win rate only together with payoff ratio and expectancy. Treat maximum
loss streak, losing-month streak, drawdown duration, and worst rolling returns
as risk diagnostics and monitoring bounds, not optimization targets. Absolute
streaks grow mechanically with sample size and cannot fairly rank candidates
with different cadence.

## 3. Condition terminal evidence on support

Always report continuous-run 365d/180d/90d/30d/7d rows, including zero rows,
but use them to describe current regime and cadence rather than to decide when a
prospective test may start. Classify each ALL/LONG/SHORT cohort by independent
event count:

- `underpowered`: fewer than 20 independent closed events;
- `diagnostic`: 20 through 49 independent closed events;
- `selection_grade`: at least 50 independent closed events.

An `underpowered` terminal row is `n/a` for pass/fail. It cannot reject a
candidate, prove current-market decay, justify another threshold, or force a
calendar wait. A `diagnostic` row may motivate the one preregistered causal
recent-direction repair, but cannot reject an otherwise eligible composition by
itself. A `selection_grade` row may cap a historical `READY_FOR_RUNTIME` claim
or lower the candidate's Pareto rank, but it does not block an otherwise valid
`MAX_LOSS_VALUE=1` prospective test. Hard causality, reconciliation, execution,
maximum-covered economics, and frozen portfolio-risk failures still block it.

For sparse strategies also report the last 20/50/100 independent events and
compare observed calendar cadence with the preregistered historical
event-arrival distribution. Zero trades are a cadence observation, not a loss;
classify them as abnormal only when they breach that frozen distribution. The
next review is triggered by independent events or a risk/parity breach, never
by waiting 7, 30, or 180 calendar days.

## 4. Revalidate historical candidates

Objective changes invalidate old rankings, not the underlying evidence. Before
inventing new hypotheses, build a deduplicated inventory of every historical
core, deterministic-gate, direction-policy, rescue, shortlisted, and untested
candidate. Group semantic duplicates by behavior/config fingerprint.

For every reconstructable candidate:

1. Recompute the new objective from retained normalized trades when window,
   universe, costs, execution semantics, source behavior, and risk unit match.
2. Otherwise rerun the exact historical behavior on the new frozen contract
   with `--cacheOnly` before ranking it when it could reach the new frontier.
3. Record `rescored`, `bridge-rerun`, `rejected`, `partial`, or
   `unreconstructable`, with the source inventory entry, evidence paths, and
   hashes. Use `new-trial-required` for an inventoried behavior that was never
   economically tested; schedule it inside the normal new-candidate budget.
4. Put every evaluated behavior in the global trial ledger even when it is no
   longer shortlisted. Re-scoring does not erase the original selection look.
5. Preserve exposed tails as exposed. A new lineage or objective fingerprint
   never makes previously viewed data sealed again.

Metric-only re-scoring and exact bridge reruns of already-tested behavior do
not consume the new lineage's 18 causal-candidate slots. They remain part of
the global multiple-testing count. A changed threshold, feature, direction
policy, payoff rule, or other behavior is a new candidate and consumes the
normal family/rescue budget.

Finish the revalidation board before freezing the three new causal families.
An old candidate may become the matched control or finalist under the new
objective, but the task must still perform its new causal improvement rounds;
revalidation is evidence-first preparation, not a substitute for new research.

## 5. Keep one global trial ledger

The trial ledger spans tasks, lineages, source branches, objective versions,
core variants, gate variants, directional policies, and rescue attempts.
Deduplicate exact behavior reruns but retain every distinct selection look.
Record at least:

- candidate/behavior fingerprint and parent family;
- first-seen lineage and every evaluation lineage;
- objective fingerprint;
- development/tuning/test exposure status;
- return series, sample size, skew, kurtosis, and serial-dependence method;
- raw, probabilistic, and deflated Sharpe;
- effective independent trial count and PBO/selection diagnostics.

Do not reset DSR/PBO because a new chat, Git commit, research id, or objective
was created. Repeated research is legitimate only when the ledger makes the
increasing selection burden explicit.

## 6. Required artifacts

Before round 1, persist:

```json
{
  "schema": "tradejs-release-candidate-revalidation/v2",
  "strategy": "<Strategy>",
  "lineageId": "<new-lineage-id>",
  "objectiveFingerprint": "<objective-artifact-sha256>",
  "historyInventorySha256": "<history-inventory-sha256>",
  "status": "complete",
  "priorCandidateCount": 1,
  "candidates": [
    {
      "historyEntryIndex": 0,
      "disposition": "rescored|bridge-rerun|rejected|partial|unreconstructable|new-trial-required",
      "behaviorFingerprint": "<sha256>",
      "evidence": []
    }
  ],
  "unresolved": [],
  "trialLedger": { "path": "<path>", "sha256": "<sha256>" }
}
```

`priorCandidateCount: 0` is valid only when the bound history inventory proves
that no prior behavior candidate exists. Refactor-only and superseded-duplicate
entries are excluded; every other deduplicated entry needs exactly one indexed
disposition. Hash this artifact and reference it from the opportunity map, all
new round specs/handoffs, the rescue board, selected composition, and final
decision.

## 7. Progress checkpoint payload

Use `tradejs-release-progress-input/v2`. Completion claims are artifact-backed:

```json
{
  "schema": "tradejs-release-progress-input/v2",
  "strategy": "<Strategy>",
  "lineageId": "<new-lineage-id>",
  "objectiveContract": { "artifact": { "path": "...", "sha256": "..." } },
  "historyAudit": {
    "complete": true,
    "artifact": { "path": "...", "sha256": "..." }
  },
  "candidateRevalidation": {
    "required": true,
    "complete": true,
    "artifact": { "path": "...", "sha256": "..." }
  },
  "baseline": {
    "complete": true,
    "reconciled": true,
    "artifact": { "path": "...", "sha256": "..." }
  },
  "opportunityMap": {
    "complete": true,
    "artifact": { "path": "...", "sha256": "..." }
  },
  "hypothesisPortfolio": {
    "frozen": true,
    "artifact": { "path": "...", "sha256": "..." }
  },
  "families": [
    {
      "id": "<family>",
      "status": "active",
      "roundArtifacts": [
        {
          "round": 1,
          "researchId": "<id>",
          "manifestArtifact": { "path": "...", "sha256": "..." },
          "resultArtifact": { "path": "...", "sha256": "..." },
          "traceArtifacts": [{ "path": "...", "sha256": "..." }],
          "handoffArtifact": { "path": "...", "sha256": "..." }
        }
      ]
    }
  ],
  "rescueBoard": { "complete": false },
  "directionalParameterCheckpoint": { "required": false, "complete": false },
  "directionPolicyCheckpoint": { "required": false, "complete": false },
  "fullAiReport": { "complete": false },
  "chart": { "complete": false },
  "selectedComposition": null,
  "limitations": []
}
```

Provide exactly three family entries. `roundArtifacts`, not a caller-supplied
count, determines completed rounds. Each round requires a completed matching
core manifest, result, trace declared by that result, and causal handoff whose
`resultSha256` matches the result file. A family retired before round 3 also
requires a hashed `retirementArtifact`.

A completed rescue board uses `tradejs-release-rescue-board/v2`, binds the same
strategy/lineage/objective, embeds artifact-backed child evidence, and accounts
for all three slots through `children` plus bounded `missingSlots` reasons.

After the exact chart is frozen, create
`tradejs-release-selected-composition/v2`. It binds the strategy, lineage,
candidate id, composition fingerprint, objective fingerprint, historical
matrix SHA, chart SHA, and core/gate fingerprints. Pass its reference as
`selectedComposition.artifact`. The checkpoint returns
`tradejs-release-progress/v2` and copies the verified selected identity into
its decision output for `strategy-release decide`.
