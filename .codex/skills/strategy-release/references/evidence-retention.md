# Evidence retention

Preserve enough immutable evidence to reproduce every displayed metric and
understand every trial after Redis, caches, and exported files are deleted.

## Immutable lineage

Create a new release or diagnostic record for each question and immutable
lineage. Never append a new run, changed composition, opened holdout, or revised
decision to an older result record.

Store internal research under the existing repository note contract:

```text
notes/<Strategy>/YYYY-MM-DD-<release-or-diagnose-slug>.md
```

Keep `notes/` ignored and never stage or force-add it. Embed the complete
secret-free evidence in the note; mutable Redis keys and artifact paths are
inventory only.

## Required release evidence

Retain:

- experiment id, question, mode, preregistered acceptance rules, verdict, and
  timestamp when each result partition was opened;
- append-only trial ledger containing the common control, all 3 causal families
  and 15 variants, statuses, resolved configs, selection rank, and rejection
  reason;
- selected isolated-long finalist and final core-plus-gate composition;
- exact git SHA/dirty diff inventory, config/gate/context fingerprints, and
  tool/metric implementation SHA;
- ordered ticker universe, checksum, eligible/raw counts, connector, interval,
  exact `[start,end)`, maximum-common-cache coverage proof, and point-in-time
  membership lineage;
- fees, slippage, entry delay, `MAX_LOSS_VALUE`, AI mode, quality threshold,
  provider/context settings, and BOTH-direction proof;
- exact commands, run ids, manifest status, planned/completed/error/OOM counts,
  config ids, export merge/part ids, hashes, and Redis reconciliation;
- complete machine-readable ALL/LONG/SHORT metrics for full and required
  terminal/cold-start windows, including zero-trade cohorts;
- control/candidate matched, removed, added, changed-outcome, occupancy, regime,
  month, symbol, event, concentration, and capacity evidence;
- gate train/tuning/test boundaries, feature provenance, threshold rounding,
  ablation, support, and one-round selection decision;
- LLM comparison scope/provider/model/prompt/cost/fingerprint when enabled,
  explicitly labelled advisory.

Do not overwrite rejected hypotheses. Preserve partial/OOM/error runs with an
invalid-for-selection label so they are not silently retried as new evidence.

## Required diagnose-live evidence

Retain:

- referenced immutable release id and exact composition fingerprints;
- incident `[start,end)`, remote/local source authority, collection timestamp,
  affected symbols, runtime ids, signal/evaluation/analysis/order/trade keys;
- closed candles, detector state/checkpoint identity, baseContext/gate inputs,
  gate decision and reasons, allocator/risk/order statuses;
- requested and actual entry/exit timestamps/prices, exit reason, quantity,
  fees, funding, spread, impact, delay, slippage, and realized PnL;
- replay/backtest command and cached-coverage proof, match tolerance, matched and
  unmatched classifications, nearest candidates, and per-field deltas;
- forward-incubation cutoff, independent event count, ALL/LONG/SHORT and regime
  comparison with frozen release bounds;
- verdict precedence applied and unresolved evidence gaps.

## Retention status

Use one of:

- `complete`: the record embeds all configuration, structured metrics, lineage,
  and verdict evidence.
- `partial`: diagnostic material is useful but cannot reproduce every claim.
- `blocked`: a named missing or invalid input prevents the requested verdict.
- `legacy-partial`: historical evidence predates the contract and must not be
  filled from current defaults.

Never mark evidence complete merely because a command exited zero. Verify the
finished manifest, hashes, counts, reconciliation, and machine-readable metrics.

## Forward incubation

Write new post-cutoff observations to a new immutable record. Do not reopen the
selection/test tail or mutate the release note. Advisory/shadow candidates may
log counterfactual decisions and LLM comparisons, but they must not change
orders, runtime config, risk, daemon state, or promotion status without explicit
approval and a separate release decision.

## Storage tiers and cleanup

Use the default tiering unless the user later changes it:

- operational Redis evidence: 3 days;
- reproducible verbose payloads: 14 days;
- verified, aggregated runtime bundles: 90 days;
- compact trial ledgers, release manifests, outcomes, gate disagreements,
  diagnoses, and chart markers: permanent.

Review the plan before applying it:

```bash
yarn strategy:release retention --input <retention-inventory.json>
yarn strategy:release retention --input <retention-inventory.json> --apply
```

The first command is a dry run. The planner must keep unverified or unaggregated
evidence regardless of age so cleanup cannot destroy the only unresolved source
artifact.
