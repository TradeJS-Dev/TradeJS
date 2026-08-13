# Directional parameter split

Use this checkpoint when one isolated global parameter change helps one
direction and harms the other. It converts a measured side conflict into a
causal core experiment; it is not permission to duplicate every config field.

## Trigger

Run the classifier after a complete reconciled matched comparison:

```bash
node .codex/skills/strategy-release/scripts/directional-parameter-checkpoint.mjs \
  --input <directional-parameter-input.json> \
  > <directional-parameter-decision.json>
```

Classify each side with the preregistered side rule as `improved`, `worsened`,
`neutral`, or `inconclusive`. Require adequate independent support, the intended
trace transition, and a one-parameter config delta. A split is required only
for `LONG improved / SHORT worsened` or the mirrored conflict.

Do not trigger from aggregate PnL alone, one profitable symbol/event, an
outcome-derived cohort, or an unexplained occupancy change. When the original
candidate changed several fields, run an ablation first.

## Implementation contract

Keep the original field as the backward-compatible fallback and add optional
directional overrides:

```text
PARAM
PARAM_LONG
PARAM_SHORT
```

Resolve only `undefined` to the fallback. Values such as `0`, `false`, and an
empty string are valid explicit overrides. With both overrides absent, old
configs, decisions, payloads, and state keys must remain exact.

Choose the implementation according to where the value acts:

- `decision_time`: resolve after direction is known; use a normal fallback
  override.
- `detector_state`: a shared detector cannot simply switch values after a
  signal appears. Use isolated replay-safe LONG and SHORT detector state or
  reject the split as architecturally unsafe.
- `shared_lifecycle`: add the override, but preregister occupancy/cooldown and
  opposite-side identity guardrails because one side can change the other's
  opportunity set.

Include the effective LONG and SHORT values in detector/execution config
identity wherever they can alter replay state or decisions. Add focused tests
for implicit fallback parity, explicit LONG/SHORT resolution, zero/false
overrides, config isolation, replay reconstruction, and same-timestamp behavior.

## Minimal research ablation

The global candidate is already evidence. Spend existing child/rescue slots,
not extra trials, on the smallest discriminating set:

1. exact legacy control with no overrides;
2. target-side-only override, keeping the opposite side at control;
3. combined best-per-side override only when both side values have independent
   prior evidence.

Use an explicit equal-overrides parity case in unit tests; backtest it only when
runner/config resolution parity is uncertain. Do not automatically test a full
Cartesian grid.

For the target side require the frozen improvement rule. For the non-target
side require exact signal/trade identity when architecture guarantees
independence. Otherwise report matched/added/removed identities, occupancy
spillover, N/cadence, PnL/trade, PF, WR, and side-only DD under a preregistered
non-regression rule. Keep aggregate portfolio DD as a separate guardrail.

## Interpretation

- A successful target-only override supports a genuine directional parameter
  asymmetry and may be carried forward as core behavior.
- If the target side improves but the opposite side changes through occupancy,
  judge the whole causal composition rather than claiming isolation.
- If equal explicit overrides do not reproduce the global candidate, fix config
  resolution/state identity before using any economics.
- If a detector-state split needs duplicated engines whose state cannot be
  replayed exactly, retire the split rather than accepting runtime divergence.
- Preserve the original global parameter even after promotion so existing
  configs remain reproducible and future configs can still choose symmetric
  behavior.

Persist the classifier input/output, parameter semantics, fallback contract,
resolved configs, implementation tests, side identities, and decision in the
immutable family handoff.
