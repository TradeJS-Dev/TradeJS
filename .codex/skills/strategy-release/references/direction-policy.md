# Direction-policy checkpoint

Use this checkpoint after the core rescue board and before concluding that no
composition can be salvaged. It tests whether a useful raw direction is being
obscured by the opposite direction or by the current deterministic gate.

## Invariants

- Keep both directions enabled in the authoritative raw-core run and retain its
  ALL/LONG/SHORT evidence.
- Never rewrite a failed raw-core result as profitable by deleting a side from
  its metrics.
- Treat direction policy as explicit composition logic. Freeze, hash, and test
  `both`, `long_only`, and `short_only` policies like other deterministic-gate
  variants.
- Prefer a deterministic-gate direction block to changing the core side toggle:
  it preserves raw counterfactual telemetry and makes the suppression visible.
- A core side toggle may be used only as an explicit equivalence candidate. It
  must reproduce the corresponding gate-blocked entries and be separately
  authorized before runtime configuration changes.
- Direction containment may produce a composition finalist even when the raw
  ALL cohort failed. It does not waive terminal, cost, support, concentration,
  drawdown, or holdout rules for the retained side.

## Required trigger table

Evaluate every row before returning `UNSUITABLE_FOR_CURRENT_MARKET` or
`STOP_RESEARCH`:

Create the preregistered input and run the deterministic classifier before
freezing variants:

```bash
node .codex/skills/strategy-release/scripts/direction-policy-checkpoint.mjs \
  --input <direction-policy-input.json> > <direction-policy-decision.json>
```

The input contains raw ALL/LONG/SHORT metrics, the frozen useful-side rule, and
current gate-approved side counts when available. Hash the input and output.
Do not override a required checkpoint in prose.

| Raw/gate evidence                                                                                                       | Required action                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One raw side has positive PnL and PF above 1 with adequate support, while the other side is the dominant aggregate loss | Run the five-variant direction-containment gate checkpoint. A no-gate-stop verdict is invalid.                                                             |
| A useful raw side receives zero or negligible current-gate approvals                                                    | Run side pass-through and direction-aware rescue variants.                                                                                                 |
| The retained side is profitable long-window but fails recent terminals or cost stress                                   | Still evaluate the frozen direction policy; classify it as diagnostic or prospective-only unless it passes the release rule. Do not call it runtime-ready. |
| Both raw sides fail the preregistered side edge rule                                                                    | No direction salvage is required, but the full diagnostic report remains mandatory.                                                                        |
| Side support is too sparse for release inference                                                                        | Keep the policy research-only or micro-forward eligible according to the verdict contract; do not manufacture historical support.                          |

`Useful raw side` is frozen before the checkpoint. By default it requires
positive full-development PnL, PF greater than 1, positive PnL/trade, and the
preregistered minimum support/cadence. A study may use a stricter rule but may
not invent a looser rule after seeing the result.

## Five frozen variants

Freeze these variants before opening tuning/test economics:

1. current deterministic gate with both directions;
2. hard block of the failing direction (`long_only` or `short_only`);
3. retained-side raw pass-through plus the same failing-direction hard block;
4. current gate plus one rounded causal repair pocket for the failing direction;
5. direction-aware replacement using the best preregistered policy per side,
   including a hard block where that is the frozen candidate.

When the problem is instead a profitable side hidden by the gate, variants 2
and 3 become target-side raw pass-through and pass-through plus a protective
exclusion, matching the release workflow's recovery semantics. Record which
case is active so the same label cannot change meaning after outcomes are known.

For each variant report:

- raw and approved ALL/LONG/SHORT metrics;
- approval share and reject reasons by side;
- full, 3y, 4y, maximum-covered, 365d, 180d, 90d, 30d, and 7d windows;
- cost stress, folds/months, regimes, concentration, event fan-out, loss streak,
  and drawdown;
- retained-side support and non-target removal/occupancy effects;
- train, tuning, and untouched-test partitions.

If a blocked side has zero approved rows, report explicit zero rows rather than
omitting it. The raw side remains visible beside the approved side.

## Decision examples

### Positive LONG, losing SHORT

Raw LONG `PnL > 0`, `PF > 1`; raw SHORT supplies most aggregate loss. Test
`long_only` and the remaining four variants. If LONG then fails 90d/30d/7d or
cost stress, reject runtime readiness for those reasons. Do not claim that
SHORT made testing impossible.

### Profitable SHORT hidden by the gate

Raw SHORT passes its edge rule but current qN+ approves no SHORT rows. Test
SHORT pass-through, a causal SHORT pocket, protected SHORT, and the
direction-aware replacement. A zero-approval current gate is not a final
market-unsuitable result.

### Both sides weak

If neither side passes the frozen useful-side rule, record `no_side_salvage`.
Still generate the complete raw-core and current-gate diagnostic reports and
chart before the verdict.

## Required artifact

Persist a machine-readable checkpoint:

```json
{
  "schema": "tradejs-direction-policy-checkpoint/v1",
  "trigger": "losing_side_contamination|profitable_side_hidden|no_side_salvage",
  "rawCoreResearchId": "<id>",
  "usefulSideRule": {},
  "rawSideStatuses": {
    "LONG": "useful|failed|insufficient",
    "SHORT": "useful|failed|insufficient"
  },
  "variants": [
    {
      "id": "<id>",
      "policy": "both|long_only|short_only|direction_aware",
      "configSha256": "<sha256>",
      "resultSha256": "<sha256-or-null>",
      "status": "complete|invalid|not-run",
      "decision": "retain|reject|diagnostic"
    }
  ],
  "selectedPolicy": "both|long_only|short_only|direction_aware|null",
  "reason": "<bounded evidence statement>"
}
```

Hash and cite it from the final release note and decision input. A required but
missing checkpoint makes the release evidence incomplete.
