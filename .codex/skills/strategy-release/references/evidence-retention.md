# Evidence retention

Preserve enough immutable evidence to reproduce every displayed metric and
understand every trial after Redis, caches, and exported files are deleted.

## Immutable lineage

Create a new release or diagnostic record for each question and immutable
lineage. Never append a new run, changed composition, opened holdout, or revised
decision to an older result record.

Store internal research under the existing repository note contract:

```text
$PROJECT_CWD/notes/<Strategy>/YYYY-MM-DD-<release-or-diagnose-slug>.md
```

Keep `notes/` ignored and never stage or force-add it. Embed the complete
secret-free evidence in the note; mutable Redis keys and artifact paths are
inventory only.

## Required release evidence

Retain:

- every `tradejs-release-progress/v2` input/output pair, including objective,
  historical-candidate revalidation, artifact-backed round/rescue evidence, and
  selected-composition lineage, evidence ceiling, and the next stage that
  prevented a premature final verdict;
- the evidence-limitation classification (`hard invalidation`,
  `research-grade provenance`, or `operational`) and sensitivity results;
- the trading thesis, opportunity map, hypothesis-role portfolio, and per-round
  belief-ledger updates that explain why each experiment was worth running;
- experiment id, question, mode, preregistered acceptance rules, verdict, and
  timestamp when each result partition was opened;
- the hashed strategy-history hypothesis inventory: behavior-relevant commits
  and dirty patches, semantic/config hashes, evidence matches, classification,
  bridge status, selected anchors, excluded duplicates/refactors, and unresolved
  backlog;
- the prior-result bridge table with source/config/window/universe/cost lineage,
  ALL/LONG/SHORT metrics, comparability class, rerun ids, and explanation for
  every material regression or reproduction;
- append-only trial ledger containing the common control, all 3 causal families,
  three refinement-round indices, rescue-board index, parent research IDs, and
  every attempted candidate up to the 18-variant cap, with status, resolved
  config, selection rank, cadence region, mechanism verdict, and rejection
  reason;
- per-round authoritative metrics, setup matching, matched/added/removed/
  changed-outcome and occupancy cohorts, trace-funnel/skip deltas, causal
  regimes, cost stress, statistical guardrails, predicted-versus-observed
  effects, and the evidence rationale for each next-round child variant;
- each round's hashed causal-handoff payload, including direct parents,
  eligible carried control, mechanism verdict, failure mode, family decision,
  and preregistered primary/falsification or refinement/robustness child deltas;
- the post-round-3 rescue board: complete candidate frontier, cadence-diverse
  seed-selection inputs, each seed's dominant failure, one predicted rescue
  delta per seed, rescue result, and the hard reason for any unused slot;
- the mandatory direction-policy checkpoint: frozen useful-side rule, raw side
  statuses, trigger, five gate variants, raw-versus-approved ALL/LONG/SHORT,
  policy/config/result hashes, and selected/rejected reason;
- every triggered directional-parameter checkpoint: one-field attribution,
  side effects/support, resolution mode, classifier hashes, legacy fallback,
  target-only/combined ablations, config/state isolation tests, and non-target
  identity or occupancy-spillover evidence;
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
- the full diagnostic matrix even when no finalist qualifies: authoritative
  control, best aggregate, best LONG, best SHORT, and every rescue/policy
  attempt over full/3y/4y/max-covered/365d/180d/90d/30d/7d windows;
- control/candidate matched, removed, added, changed-outcome, occupancy, regime,
  month, symbol, event, concentration, and capacity evidence;
- gate train/tuning/test boundaries, feature provenance, threshold rounding,
  sealed-test flag/open timestamp, ablation, support, and one-round selection
  decision; record any accidental early test exposure permanently;
- the complete `$ai-train-local-research` report sections and structured
  full-period `ai-train --localOnly --chart -n 0` output, labelled
  `diagnostic-only` when no composition qualifies;
- LLM comparison scope/provider/model/prompt/cost/fingerprint when enabled,
  explicitly labelled advisory.

Preserve risk-scale changes as compact permanent `L` markers. Do not fork or
hide the unchanged core + gate evidence timeline merely because
`MAX_LOSS_VALUE` changed; retain the old/new values, timestamp, source artifact,
and normalization ratio.

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
