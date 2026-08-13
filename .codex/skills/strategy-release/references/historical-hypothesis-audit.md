# Historical hypothesis audit

Use this audit before inventing release-core hypotheses. Its purpose is to
prevent a new Codex task from forgetting a stronger prior core result, rerunning
an already rejected idea, or treating an unrelated refactor as research.

## Contents

1. Build the inventory
2. Match commits to evidence
3. Bridge prior results to the current experiment
4. Prioritize untested hypotheses
5. Required artifact

## 1. Build the inventory

Inspect the complete strategy history, the current strategy files, and every
shared helper imported by that strategy:

```bash
git log --reverse --date=iso-strict \
  --format='%H%x09%aI%x09%s' -- packages/strategies/src/<Strategy>
git show --stat --patch <commit-sha> -- \
  packages/strategies/src/<Strategy> <referenced-shared-paths>
yarn research:core index
```

Also inspect `notes/<Strategy>/`, relevant `notes/CrossStrategy/` records, the
core-research family ledger/index, Redis config snapshots cited by those
records, and retained release artifacts. Search by full/short Git SHA, config
field, canonical config hash, behavior/diff hash, research id, and run id. A
missing Git SHA in a note is not proof that no evidence exists.

Classify every behavior-relevant commit or dirty patch as exactly one of:

- `verified-result`: complete reconciled evidence exists for the same behavior;
- `rejected-result`: complete evidence exists and rejected it;
- `partial-result`: useful evidence exists but is not selection-grade;
- `untested-behavior`: a causal behavior change has no result evidence;
- `refactor-no-hypothesis`: no intended decision/economic behavior change;
- `superseded-duplicate`: the same causal delta was tested under another
  commit/config lineage;
- `unreconstructable`: the behavior or required point-in-time inputs cannot be
  reproduced honestly.

Do not infer the class from the commit subject. Inspect the patch. Config,
filter, engine, order-plan, exit-lifecycle, risk, and deterministic-gate changes
are hypothesis candidates; tests, formatting, module moves, and performance-only
refactors are not unless the patch changed decisions or execution semantics.

## 2. Match commits to evidence

Match evidence semantically, not only by filename:

- exact or documented dirty Git lineage;
- canonical resolved core config and behavior/diff hash;
- ordered universe and checksum;
- half-open window and cache coverage;
- fees, slippage, entry delay, interval, connector, and context lineage;
- completed manifest, export hash, and Redis N/W/L/PnL reconciliation;
- result status and whether the evidence was control, candidate, diagnostic, or
  release-selection grade.

If a current behavior was introduced by several commits, collapse them into one
causal hypothesis record. If one commit introduced several independent
mechanisms, split them. Never spend several trial slots on semantic duplicates.

When a change is already part of the current control but was never ablated, the
current baseline proves only its combined economics. Reconstruct an explicit
off/on ablation before claiming that the historical mechanism helped.

## 3. Bridge prior results to the current experiment

Before freezing new families, create a bridge table containing every previously
strong or shortlisted core result:

```text
source lineage | behavior/config delta | window | universe | costs | ALL/LONG/SHORT |
N | PnL | PF | PnL/trade | DD | cadence | evidence grade | current comparability
```

Classify comparability as:

- `exact`: logic, config, universe, window, costs, and context match;
- `bridge-required`: the causal config is reconstructable but one or more
  experiment dimensions differ;
- `diagnostic-only`: evidence cannot support a direct economic comparison.

Do not compare raw PnL from 1500d/300 symbols with 1800d/507 symbols as if it
were the same experiment. Equally, do not ignore the former. For every
`bridge-required` result that dominates or materially challenges the current
baseline, rerun its exact causal config on the new frozen window/universe/cost
contract before testing novel ideas. Attribute the delta to source/config,
membership, window, costs, or context with matched metrics where possible.

The current release control is not accepted merely because it is named `:ai`.
If it is materially worse than a prior comparable result, explain and reproduce
that regression first. A final claim that “nothing works” is invalid while a
stronger prior result remains unbridged.

## 4. Prioritize untested hypotheses

Use reconstructable `untested-behavior` records before generating novel
families. Select at most three causally distinct records as round-1 anchors,
ranked by:

1. strength and completeness of any adjacent/prior evidence;
2. direct relevance to the current ALL/LONG/SHORT failure mode;
3. causal clarity and point-in-time validity;
4. support and cadence potential;
5. difference from hypotheses already tested in the ledger.

Historical anchors consume the normal trial budget; they are not free extra
looks. Remaining records stay in the immutable backlog. They may motivate the
post-round-3 rescue board when they address a selected seed's measured failure.
An exact bridge rerun of a different core config counts as a candidate in the
same family-aware ledger; prefer it as an anchor or, if discovered later, spend
a rescue slot. Rebuilding the unchanged control or normalizing metadata does
not count as a candidate.
Do not return `STOP_RESEARCH` or claim the strategy is exhausted while a
reconstructable untested historical hypothesis with stronger evidence than the
tested set remains unbridged and fits an available anchor/rescue slot. If the
bounded budget is exhausted first, report the remaining backlog explicitly as
`INSUFFICIENT_EVIDENCE`, not as market unsuitability.

## 5. Required artifact

Persist and hash a machine-readable inventory before round 1:

```json
{
  "schema": "tradejs-strategy-hypothesis-inventory/v1",
  "strategy": "<Strategy>",
  "headGitSha": "<sha>",
  "entries": [
    {
      "sourceCommits": ["<sha>"],
      "causalFamily": "<family-or-null>",
      "configOrBehaviorDelta": {},
      "behaviorSha256": "<sha-or-null>",
      "status": "verified-result|rejected-result|partial-result|untested-behavior|refactor-no-hypothesis|superseded-duplicate|unreconstructable",
      "evidenceResearchIds": [],
      "priorResult": null,
      "comparability": "exact|bridge-required|diagnostic-only|null",
      "decision": "round1-anchor|rescue-backlog|closed|excluded",
      "reason": "<bounded reason>"
    }
  ],
  "bridgeRuns": [],
  "unresolvedBacklog": []
}
```

Reference its SHA from every child spec, causal handoff, final note, and release
decision. An absent or stale inventory makes the release evidence incomplete.
