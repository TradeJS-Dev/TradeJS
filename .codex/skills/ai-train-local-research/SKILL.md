---
name: ai-train-local-research
description: Execute deterministic AI-gate research for a frozen TradeJS core/export with ai-train, ai-pocket-search, and the reusable gate-ablation tool. Use strategy-improvement-research instead to choose or retune core candidates and orchestrate the full improvement lineage.
---

# AI Train Local Research

Run these commands with `PROJECT_CWD` pointing to `TradeJS-Project`, which owns
`data/`, `notes/`, `.env`, and `tradejs.config.ts`. Set
`TRADEJS_SOURCE_REPOSITORY_ROOT` to the exact framework or standalone strategy
Git checkout whose build and lineage are under study. When that source is a
standalone strategy, also set `TRADEJS_FRAMEWORK_REPOSITORY_ROOT` to the exact
framework checkout that provides the built `@tradejs/node` and `@tradejs/cli`
research runtime. Never infer either source root from `PROJECT_CWD`.

This is a gate-stage specialist. It does not select core hypothesis families,
run multi-round core tuning, or replace the raw-core verdict. Use
`$strategy-improvement-research` for the complete lineage; invoke this skill
only after the core/export identity is frozen.

Use this skill when the user asks to:

- run `ai-train` for a strategy
- run `ai-pocket-search` over AI export files
- research or tune a local deterministic AI gate
- analyze `latest N` or `skip K`
- do the replay without OpenRouter
- inspect qN+ approval streams, drawdown, winrate, profit factor, or cadence
- check time stability, symbol concentration, or direction-specific pockets
- compare current results with previous TrendLine / ReverseTrendLine style investigations
- break down false positives / false negatives
- save each conclusion in a new
  `$PROJECT_CWD/notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md` research record
- tune approval cadence toward roughly 2-3 approved trades per day when possible, with ~1 approved trade per day as the practical lower bound for narrow high-quality pockets; if a gate approves more, look for filters that lower approvals and raise winrate

## Reusable Research Tooling

When AI-gate work follows a raw-core experiment, first read the verified
`data/research/core/<researchId>/spec.json`, `result.json`, and normalized
`trades.jsonl` produced by `yarn research:core`. Treat that bundle as the
immutable source for raw-core ALL/LONG/SHORT economics, selected config lineage,
and causal setup attribution. Do not rerun core selection inside gate tooling or
rewrite its target/aggregate verdict. The gate study is a new hypothesis stage:
evaluate LONG and SHORT approved streams separately, preserve the core bundle
research ID/config SHA/export lineage in the gate note, and make any
direction-aware gate explicit. A weak raw-core side may be filtered by a later
gate only after its own timestamp-grouped validation; never hide or retroactively
disable it in the core result.

Use `scripts/ai-gate-ablation.mjs` for custom deterministic gate filters,
exclusions, recovery additions, gate replacements, feature inventory, and
baseline-vs-candidate tables. Read `references/gate-ablation.md` for its
expression grammar and report contract.

Mandatory rule:

- Do not create `/tmp` parsers, heredoc ESM replays, or strategy-specific
  one-off scripts for work covered by this tool.
- If a recurring analysis is missing, extend the permanent script, add or update
  `scripts/ai-gate-ablation.test.mjs`, and document the behavior in the
  reference. Run `node --test scripts/ai-gate-ablation.test.mjs` from the skill
  directory.
- Build changed strategy/node/CLI packages before running the tool because it
  reconstructs current gate context from `dist`.
- Keep `yarn ai-train --localOnly --json -n 0` as the authoritative baseline;
  do not interpret variants until baseline qN+ support, PnL, PF, max drawdown,
  strict loss, and loss streak match.

## Mandatory reporting contract

Before returning AI-gate metrics in chat or writing a dated notes entry, read
`references/reporting.md` and follow its section order, metric names, windows,
rounding, and `n/a` rules exactly. Use the full contract unless the user
explicitly asks for one narrow metric. Do not improvise a shorter alternative
or silently omit unavailable metrics.

For every approved-stream summary, calculate `PnL/trade` as total approved PnL
divided by completed approved trades. Never substitute the backtest CLI progress
`avg`, which is PnL per completed test/symbol. Use `n/a` when `N = 0`.

## AI Gate Pocket Hygiene

Do not move a discovered pocket into a deterministic AI gate just because it
improves aggregate backtest PnL. Treat every candidate rule as overfit until it
survives the checks below.

Hard rule:

- Do not use data-availability or sample-count fields as approval evidence.
  Examples include derivatives `points`, `rows`, `latestIndex`, source array
  `.length`, coverage counts, shard counts, or "how much context was loaded".
  These may be used only as data-quality guards that block or mark data as
  missing/stale; they must not promote quality or unlock approval pockets.
- Event counts that are genuine market structure features, such as trendline
  touches, zone `hitCount`, bars since a detected setup, or pivot counts, are
  allowed only when they measure the setup itself and are causal at signal time.
  Do not confuse them with "number of rows available in the dataset".
- Do not reject `baseContext.derivatives.intervals` as an AI-gate input only
  because the historical export has partial coverage. In TradeJS exports these
  target derivative interval fields may be unavailable for older history and
  cannot always be backfilled to a longer period, but they are causal live
  market-state fields when present and may be used for deterministic AI-gate
  approval after validation. Treat missing/stale interval data as a quality
  guard, not as approval evidence.
- Treat independent decision timestamps or documented market episodes as the
  support unit for gate selection. Rows and symbols sharing one timestamp are
  correlated fan-out, not independent observations.
- Keep every timestamp group wholly inside one partition. Never split rows from
  the same timestamp across train, tuning, validation, or test.
- Treat any partition used to rank, select, or refine a pocket as tuning data.
  Production readiness requires a later untouched chronological test.

Before implementing a pocket:

- Audit existing gate conditions before proposing new ones. Inventory current
  approval, downgrade, recovery, and block pockets in the strategy adapter /
  guardrails, including constants, high-precision thresholds, env-sensitive
  fields, and data-count fields.
- Revalidate old pockets under the same export, live env assumptions, and metric
  table used for any new candidate. Do not assume existing gate rules are still
  valid after data provider, context, lookback, interval, target/reference, or
  adapter changes.
- For each existing pocket, classify it as `keep`, `round`, `replace`,
  `disable`, or `needs-more-data`, and explain why.
- Require time-ordered validation, not only full-sample or train metrics.
- Require at least `25` independent approved events in train and `25` in the
  untouched test, with support across at least two folds or calendar months.
  If support is lower, classify the pocket as `needs-more-data` and
  `research-only` / passive-only regardless of row count or aggregate PnL.
- Check stability by direction, month/quarter, and symbol. Avoid rules where the
  result depends on one short period, one side, or a few symbols.
- Record each pocket field's scope as `target`, `benchmark`, or `global`.
  Benchmark/global approval pockets require a fan-out stress test plus either a
  target-specific discriminator or an enforced portfolio throttle.
- Treat a new export as revalidation only for independent timestamps after the
  prior selection cutoff. Overlapping historical rows are not new evidence.
- Compare q4+ and q5+ streams before and after the rule. A pocket that improves
  total PnL but worsens drawdown, loss streak, or losing months usually should
  not become live approval logic.
- Run an ablation: show the baseline gate, the new pocket alone, and the final
  gate with the pocket included.
- Run threshold sensitivity around each numeric cutoff. Test adjacent rounded
  values and a small band around the discovered value; prefer rules that remain
  useful after rounding.

Threshold implementation rules:

- Do not paste high-precision search cutoffs directly into gate code unless
  there is a strong documented reason. Values like `0.416874`, `-0.00904779`,
  `4.6069`, or `-0.5906` should be treated as search artifacts first.
- Convert discovered thresholds to coarser, defensible boundaries before
  implementation, then rerun replay metrics. Examples: use human-scale values
  such as `0.42`, `-0.01`, `4.7`, `-0.6`, or a clearly named domain threshold
  instead of copying the exact optimizer boundary.
- Round approval thresholds in the stricter direction by default so rounding
  does not silently expand the approved set. For `>=` approval cutoffs, round
  upward; for `<=` approval cutoffs, round downward. If a relaxed rounded value
  is desired, validate it explicitly as a separate candidate.
- If rounding materially changes cadence, PF, drawdown, or month stability, do
  not implement the pocket until a stable rounded threshold is found.
- Name constants by their market meaning and validation scope, not by the search
  output. Good names mention the feature, direction, and intent, for example
  `SHORT_BREADTH_SHOCK_MARKET_RETURN_MAX`.

Documentation requirement for any new AI-gate pocket:

- Report the exact export/merge id and shard count.
- Report train, tuning, and untouched-test metrics; independent-event support;
  direction and month/quarter splits; symbol and event concentration; PF;
  drawdown; and max loss streak.
- Report trades and events per day, active-day ratio, trades per event, p95/max
  batch size, and the largest event's shares of approved count and PnL.
- Report capacity stress at the real production cap or, when unknown, at
  capacities `1`, `3`, and `5`, including rejected overflow. Calculate
  simultaneous stop-risk only from the historical effective `MAX_LOSS_VALUE`
  used by the backtest that produced the export. Prefer an immutable resolved
  config snapshot or archived backtest checkpoint referenced by
  `backtestRunId`/`backtestTestKey`. Do not substitute the current named Redis
  config, a current strategy default, or a production value unless lineage
  proves it matches the export. When the historical value cannot be recovered,
  report stop-risk as `unknown`/`n/a`.
- State the raw discovered threshold and the rounded implemented threshold.
- State whether the rounded rule was rerun and whether it stayed stable.
- If the rule uses a context field whose semantics can change with env settings
  such as lookback, interval list, target/reference mode, or data provider, call
  that out explicitly and avoid using the field for approval unless the rule is
  validated under the intended live env.

Documentation requirement for existing AI-gate pockets:

- Include an "Existing Gate Audit" section in the report or notes whenever gate
  tuning is requested.
- List each existing pocket or threshold group with file/line references where
  practical.
- For every old high-precision threshold, state whether it should stay exact,
  be rounded and rerun, or be removed.
- For every old data-count or env-sensitive condition, state whether it is only
  a data-quality guard or whether it currently affects approval. If it affects
  approval, recommend replacing it with market-state features unless validation
  proves it is stable under the intended live env.
- If old rules are not revalidated, mark the final recommendation as incomplete
  and do not present new pockets as production-ready.

Suggested old-gate audit commands:

```bash
rg -n "pocket|calibrated|q4|q5|recovery|approvalAllowedNow|deterministicQuality|hardBlockReasons|softBlockReasons|[0-9]+\\.[0-9]{3,}|\\.points|\\.length" packages/strategies/src/<Strategy>
rg -n "DERIVATIVES_CONTEXT|targetContext|targetDerived|referenceContexts|points|rows|lookback|intervals" packages/strategies/src/<Strategy> packages/core/src packages/node/src
```

Mandatory validation sections for gate work:

- **Live-env parity**: record the intended live env and compare it with the
  export/replay assumptions. Include at least `AI_MODE`, `MIN_AI_QUALITY`,
  interval/timeframe, strategy config name, derivatives lookback/intervals/
  target mode, CMC windows, and any provider/context toggles that can affect
  gate fields. If parity is unknown, mark the recommendation as not ready for
  production.
- **Feature provenance**: for every field used by an old or new pocket, list
  the source path, whether it is causal at signal time, whether it is
  market-state, setup-event-count, or data-availability, whether its scope is
  target/benchmark/global, and whether it depends on
  lookback/window/cache/provider settings.
- **Walk-forward validation**: when the export spans enough history, validate
  across multiple chronological folds or at least month/quarter buckets. Prefer
  pockets that survive changing market regimes over pockets that win only in a
  single terminal validation split.
- **Acceptance gates**: define minimum validation support, maximum symbol
  and event concentration, acceptable losing months, max loss streak,
  PF/drawdown improvement, and cadence/capacity bounds before recommending
  implementation. Require `>=25` independent events in both train and untouched
  test; no symbol or timestamp may provide more than one third of approved count
  or PnL; no batch may exceed the declared live capacity; no new losing-month
  cluster or worse loss streak is allowed. A miss is unconditionally
  `research-only` / passive-only until new evidence resolves it.
- **Negative control**: for suspiciously strong or highly specific pockets, run
  a sanity check such as shuffled labels/profits or a nearby nonsense feature.
  A pocket that still looks good under a negative control is overfit or the
  script is wrong.
- **Boundary tests**: require unit tests for implemented gate changes at the
  threshold boundary, just above/below it, with missing/null fields, and with
  rounded thresholds rather than raw optimizer cutoffs.
- **Passive rollout**: add new or changed gate logic in observation mode first.
  Log old decision, new decision, reason deltas, and per-timestamp fan-out. Do
  not present or enforce a candidate that fails independent-event support or
  capacity gates as historically production-ready. The sole exception is an
  operator-directed prospective test explicitly authorized through
  `$strategy-forward-start` for one checksum-reproducible candidate at
  `MAX_LOSS_VALUE=1`; keep its classification `research-only`, retain contrary
  evidence, and let that skill enforce the immutable target, package, runtime,
  and rollback boundaries.
- **Old-gate cleanup**: when an old pocket is replaced or disabled, remove dead
  constants/prompt fields/tests, update notes, and explain the migration path.

## Workflow

1. Confirm the latest merged dataset exists.

Use the shard-aware permanent discovery command:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --list --strategy <Strategy>
```

Important shard-aware rule:

- merged exports may now be split into `-part1 ... -partN` files
- treat all files with the same `strategy token + merge id` as one logical export
- do not assume the latest export is a single `...-merged-<ts>.jsonl` file
- `yarn ai-train` already groups matching part files automatically when:
  - no explicit `--file` is given and it selects the latest merge id
  - or `--file` points to any one shard like `...-part1.jsonl`
- `yarn ai-pocket-search` follows the same shard grouping convention and treats a `--file ...-part1.jsonl` argument as the whole merge group
- when reporting the export used, list the merge id and shard count, not only the first shard path

2. If the user wants config analysis, read the real Redis config instead of guessing from defaults.

Use:

```bash
docker exec inv-redis redis-cli JSON.GET users:root:backtests:configs:<Strategy>:ai
```

3. Decide replay mode.

- If the user explicitly says `without OpenRouter`, use `--localOnly`.
- If the goal is deterministic gate research, also prefer `--localOnly`.
- If the user explicitly wants model behavior, run normal `ai-train` with the default GPT-5 Mini model unless they name another model.
- Interpret replay mode against runtime `AI_MODE` explicitly:
  - `yarn ai-train --localOnly` matches `AI_MODE=gate` behavior for approval logic, because both use the local deterministic strategy AI gate and the same `MIN_AI_QUALITY` threshold.
  - normal `yarn ai-train` is the closer proxy for `AI_MODE=llm`, because approval depends on provider/model output instead of only the local deterministic gate.
  - do not describe `--localOnly` findings as expected `AI_MODE=llm` production behavior.

4. Run the replay.

Examples:

```bash
yarn ai-train --strategy TrendLine -n 500 --localOnly
yarn ai-train --strategy ReverseTrendLine -n 500 --localOnly
yarn ai-train --strategy VolumeDivergence -n 500 --localOnly
yarn ai-train --strategy TrendLine -n 0 --localOnly --terminalWindows=180,90,30,7 --output data/ai/output/trendline-ai-train.json
yarn ai-pocket-search --strategy TrendLine -n 0 --maxDepth 2 --minSupport 25
```

### Freshness and terminal-window gate

For any current/live cadence conclusion, run all selected rows so one execution
produces the full result and terminal summaries:

```bash
yarn ai-train --strategy <Strategy> -n 0 --localOnly --terminalWindows=180,90,30,7
```

Terminal windows are anchored to the maximum dataset timestamp. Whenever a
period comparison table is shown, it must include the full export plus `180d`,
`90d`, `30d`, and `7d`, including windows with zero approvals. Use
`--terminalWindows=180,90,30,11,7` when the production comparison additionally
uses an 11-day window. Do not run the provider repeatedly for these windows;
the command derives them from the same evaluated rows. If the export is shorter
than 180 days, keep the `180d` row and mark it as incomplete/overlapping the
available full export rather than silently omitting it.

Before stating expected production cadence:

- record dataset min/max timestamps and `dataLagDays`
- require the export to overlap the production window under discussion
- report full history and every terminal window, including zero approvals
- period tables must always show rows for the full export, `180d`, `90d`,
  `30d`, and `7d`
- when comparing a new candidate/gate with a baseline or previous result, show
  terminal-window metrics as a comparison table for every row (`full`, `180d`,
  `90d`, `30d`, `7d`) rather than only the candidate values. Include baseline
  and candidate N, WR, PF, PnL, Max DD, max loss streak, losing months, and
  trades/day
- for the same terminal rows, include events/day, active-day ratio, unique
  events, trades/event, p95/max batch, and largest-event count/PnL shares
- use terminal `approvedPerCalendarDay`, not the full-history average, as the
  current cadence evidence
- record git SHA, dirty state, gate fingerprint, config-id fingerprint, and
  context fingerprint from the report
- compare runtime only when gate/config/context lineage and `MIN_AI_QUALITY`
  match; otherwise label it a different experiment
- inspect terminal top reject reasons before changing a threshold
- if the export tail is stale, report current live cadence as unknown and build
  a fresh export

Context semantics rule:

- top-level derivatives fields are BTC benchmark context
- `targetContext` / `targetDerived` are target-symbol context
- when `DERIVATIVES_CONTEXT_TARGET_ENABLED=false`, target fields must be absent;
  downloaded target rows or membership in extra reference symbols may expose the
  symbol only through `referenceContexts`
- do not rename benchmark evidence as target evidence in reports
- do not switch an existing gate from benchmark to target behavior without a
  new export, terminal validation, and updated notes

After any gate-code change, rerun the command and create a new research file at
`notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md`. Never append the run to an
older research file. Metrics from an older gate fingerprint are historical
context only.

Shard-aware examples:

```bash
yarn ai-train --strategy TrendShift --localOnly --json -n 0
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl --localOnly --json -n 0
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl --localOnly --json -n 0 --dumpEvaluations /tmp/trendshift-evals.jsonl
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl --localOnly --json -n 0 --dumpEvaluations /tmp/trendshift-evals.jsonl --dumpFeatures gateFeatures
yarn ai-pocket-search --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl -n 0 --maxDepth 2 --minSupport 25
yarn ai-pocket-search --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl -n 0 --scope approved --maxDepth 2 --minSupport 5
```

Interpretation:

- both commands above should evaluate the full shard group for that merge id, not only `part1`
- if a partial replay is genuinely needed, use native `ai-train` selection
  options rather than assuming one shard equals one isolated window
- `yarn ai-train --localOnly --json` is the baseline source of truth for current deterministic gate metrics
- Release evidence with an explicit one-side gate must pass
  `--directionPolicy long_only|short_only`. This flag is evidence metadata, not
  a filter: `ai-train` rejects the report unless the actual evaluated gate has
  zero approved rows for the suppressed direction in full and terminal
  windows. Use `both` (default) or `direction_aware` for policies that retain
  both approved sides.
- `yarn ai-pocket-search` is the default pocket discovery tool for future AI-gate rules. It reconstructs current strategy AI payloads, excludes outcome/current gate-output fields by default, shows progress bars, deduplicates equivalent row-selection pockets, and writes a Markdown report under `data/ai/output`.
- `ai-pocket-search` uses a time-ordered row holdout by default
  (`--validationSplit 0.25`) and ranks candidates on that holdout. Treat it as
  tuning evidence, not an untouched test. For direction-specific discovery use
  `--direction LONG` or `--direction SHORT`. For release research, reserve a
  timestamp-grouped tail with `--testSplit ... --sealTest`; the report retains
  only its timestamp/count bounds and excludes its rows from current-gate and
  pocket economics. Open it once later with a frozen `ai-gate-ablation.mjs`
  spec. Plain `--testSplit` still prints test metrics and is therefore an opened
  historical test, not sealed release evidence. Use `--validationSplit 0` only
  for legacy full-sample exploration.
- `ai-pocket-search` uses `--coverageMode auto` by default. It keeps the
  full-history search for non-provider features and runs separate CMC and
  Coinalyze cohorts over rows where that context is usable. Each cohort gets
  its own timestamp-grouped train/tuning/test split, and every reported cohort
  pocket must contain a predicate from that provider family. Use
  `--coverageMode full` only when intentionally reproducing the legacy single
  full-period search.
- `ai-pocket-search` uses `--cadenceMode auto` by default. For a sparse train
  partition it scales discovery-only `minSupport` / `minEvents` down from the
  legacy 20 / 10 defaults using the number of independent timestamp events.
  A train partition below 200 events uses
  `minSupport=clamp(ceil(events*0.1),3,20)` and
  `minEvents=clamp(ceil(minSupport*0.5),3,10)`; the default maximum event share
  relaxes only as far as one third. Each provider coverage cohort gets its own
  thresholds. Explicit
  `--minSupport`, `--minEvents`, `--minValidationSupport`,
  `--minValidationEvents`, and `--maxEventCountShare` values always win. Use
  `--cadenceMode fixed` to reproduce the legacy fixed thresholds.
- Adaptive thresholds make low-cadence hypothesis discovery possible; they do
  not lower the production evidence bar. Every pocket is marked
  `research-only` when it has fewer than 25 independent train events, fewer
  than 25 matching events in the untouched test, or no untouched test at all.
  `production-candidate` means only that these sample-size prerequisites were
  met, not that the pocket is automatically safe to ship.
- Coverage flags, coverage start/end, and cohort sizes are data-quality
  metadata only. They select the research cohort and appear in the report, but
  they are never eligible pocket predicates. Missing or stale provider context
  must not be flattened into fallback market states such as derivatives
  `pressure=neutral`.
- use `--includeGateContext` only for auditing existing gate output fields, not for discovering new future approval rules
- use `--scope approved` with a smaller `--minSupport` to find sub-pockets inside the current qN+ approved stream; use `--scope all` or `--scope candidates` to look for expansion candidates
- when doing offline pocket research, prefer `--dumpEvaluations` for the evaluated rows
- when the research needs signal-time gate inputs such as CMC, MTF, ATR bucket, benchmark conflict, participation, execution, or strategy-specific `*GateFeatures`, add `--dumpFeatures gateFeatures`; this writes the current `baseContext.gateFeatures` and strategy gate features into each dump row
- when broader context is needed, use `--dumpFeatures baseContext`; it writes compact current base-context sections (`regime`, `structure`, `participation`, `relative`, `derivatives`, `mtf`, `gateFeatures`) without the bulky `raw` section
- join/compare extra fields from the original dataset only when they are not available through `--dumpFeatures`, and treat those joined fields as explanatory features rather than current gate truth after adapter changes
- use `scripts/ai-gate-ablation.mjs` for custom rule ablations and verify its
  baseline against `yarn ai-train --localOnly --json` for the same export/window

5. Read these sections first:

- `OUTCOME`
- `BY DIRECTION`
- `DETERMINISTIC FLOW`
- `QUALITY BREAKDOWN`

6. Always show quality-cadence metrics for the main approved bucket.

Default naming convention:

- `qN+` means the effective `MIN_AI_QUALITY=N` approved stream, so it includes every approval with quality `>= N`.
- Examples:
  - `q3+` includes `q3`, `q4`, `q5`
  - `q4+` includes `q4`, `q5`
  - `q5+` includes only `q5`
- Do not default to plain `q1` / `q2` / `q3` / `q4` / `q5` wording unless the user explicitly asks for the isolated subset.

For the default `q4+` approved stream, report:

- `winrate` / `precision_approved`
- `profit_factor`
- `max_drawdown`
- `max_drawdown_pct_of_gross_profit`
- `max_drawdown_pct_of_total_profit`
- `max_consecutive_losses` / `max loss streak`
- losing approved months count, and list the losing months when the count is non-zero
- `avg_profit_approved_per_day`
- `avg_profit_approved_per_month`
- `avg_approved_trades_per_day`
- `avg_approved_trades_per_week`
- unique approved event timestamps
- approved events per day and active-day ratio
- trades per event, p95/max approved batch size
- largest-event shares of approved count and PnL

Use the same period logic as `packages/cli/src/lib/aiTrainMetrics.ts`: `(max timestamp - min timestamp) / 1 day`, with a minimum of `1` day. If useful, also mention the full-window normalization separately, but the required table is for the default approved stream named in `qN+` notation. If `q5+` or another threshold is important for the strategy, include it too. If the user explicitly asks for isolated `q1` / `q2` / `q3` / `q4` / `q5`, report those separately and label them clearly.

7. For deeper FP/FN and gate-ablation analysis, use the permanent tool.

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs \
  --file data/ai/export/ai-dataset-<token>-merged-<ts>-part1.jsonl \
  --variant 'name::filter::additionalIndicators.baseContext.<path> <= <value>' \
  --featurePattern '<field-regex>' \
  --output data/ai/output/<strategy>-gate-ablation.md
```

- It streams shards in part order, rebuilds the current payload after plugin
  registration, and keeps outcome labels separate from decision features.
- Use repeated `--variant` arguments or a JSON `--spec` to compare hypotheses
  in one pass.
- Use `filter`, `exclude`, `add@quality`, or `replace@quality` according to the
  ablation semantics documented in `references/gate-ablation.md`.
- Do not use `--includeGateContext` for discovery; it is audit-only.
- If its baseline differs materially from `ai-train`, stop and fix the permanent
  tool before interpreting hypotheses.

8. For strategy AI investigations, always look for these questions:

- Is the strategy core firing earlier than the adapter wants?
- Is a stricter threshold such as `q5+` actually better than the broader default stream such as `q4+`?
- Is one direction much worse than the other?
- Is one direction responsible for most drawdown?
- Are the best pockets counter-trend or aligned?
- Is there a field mismatch between `core.ts` and `adapters/ai.ts`?
- Is the backtest config exploring the detector or only TP/SL?

9. For gate tuning, validate candidate rules beyond aggregate profit.

Minimum checks:

- audit existing gate pockets and thresholds before adding new ones
- revalidate existing approval/recovery/downgrade/block rules on the same export
  and env assumptions used for the proposed change
- classify old pockets as `keep`, `round`, `replace`, `disable`, or
  `needs-more-data`
- include live-env parity and feature provenance tables in the analysis
- run walk-forward or month/quarter stability checks when history allows it
- define acceptance gates before treating a pocket as production-ready
- use a negative control for unusually strong or highly specific pockets
- reject approval rules based on data-count or availability fields such as
  derivatives `points`, row counts, `.length`, coverage counts, or loaded-window
  size; use those only as missing/stale-data guards
- reject high-precision pocket thresholds until they have been rounded to a
  defensible value and replayed again
- run sensitivity checks around each proposed numeric threshold
- report train and validation support separately when using `ai-pocket-search`
  or a custom split, but label any partition used for selection as tuning
- group partitions by timestamp and report independent-event support separately
  for train, tuning, and untouched test
- report event clustering and capacity stress for every terminal window
- require a target-specific discriminator or portfolio throttle for
  benchmark/global pockets that can approve many symbols on one timestamp
- include an ablation table: baseline, pocket-only when applicable, and final
  gate
- require boundary tests and a passive-rollout plan for implemented gate changes
- clean up old disabled pockets instead of leaving dead constants or prompt
  fields behind
- compare q4+ and q5+ separately
- report winrate as a percentage
- report max drawdown both as an absolute value and as percentages of gross profit and total profit
- report Sharpe, Sortino, and Calmar for the approved stream when available,
  and include a one-sentence conclusion: whether the candidate improved
  risk-adjusted quality, merely reduced trades, or worsened tail risk
- always report max consecutive losses / max loss streak for the approved stream
- always report losing approved months count for the approved stream; when non-zero, include the month ids and monthly approved PnL
- split by direction
- split by quarter or month when the export spans enough time
- check symbol concentration; avoid rules where most profit comes from only a few symbols
- prefer candidate pockets that improve profit factor or drawdown without destroying cadence
- for live-style approval gates, usually aim for about 2-3 approved trades per day, but accept narrow high-quality pockets down to ~1 approved trade per day when profit factor/drawdown materially improve; if a strategy approves substantially more, assume there is likely room to lower approvals and raise winrate with additional filters
- treat tiny added slices as unstable even when aggregate profit improves
- if the candidate depends on env-sensitive context construction, such as
  derivatives lookback, interval selection, target/reference mode, or CMC window
  availability, validate it under the intended live env before recommending code
  changes

Risk-adjusted metric convention:

- `sharpe_ratio` and `sortino_ratio` in TradeJS AI-gate research are computed
  from approved trade PnL, annualized by approved-trade cadence over the
  evaluated period. Treat them as PnL-stream quality metrics, not capital-return
  ratios.
- `calmar_ratio` is annualized approved PnL divided by approved max drawdown.
- When comparing gates, prefer candidates where Sharpe/Sortino/Calmar improve
  together with PF/maxDD. If only Sharpe improves because many trades were
  removed while 30d/7d tail risk remains, state that explicitly.

## Notes format

Read both `references/reporting.md` and
`../strategy-backtest-research/references/research-notes.md` before writing a
note. The shared contract controls storage, one-research-per-file boundaries,
frontmatter, resolved config, and the machine-readable metric snapshot. The AI
reporting contract controls tables, metric names, validation, threshold,
rollout, and cleanup sections.

Every new AI-gate study must:

- create one new file under `notes/<Strategy>/`, never update a rolling log;
- keep that file local-only and ignored by Git; never stage, commit, or
  force-add anything under `notes/`;
- embed the complete `ai-train --localOnly --json` result and structured
  ablation/partition summaries needed to rebuild every displayed metric;
- embed the secret-free resolved backtest/runtime/context configuration instead
  of only naming a Redis key or current config;
- list export/output paths and SHA-256 values as disposable artifact inventory,
  not as the only metric evidence;
- downgrade `reproduction` from `complete` when any displayed metric or lineage
  cannot be recovered from the note after export deletion.

## Current repo conventions

- Prefer `GPT-5 Mini` by default for non-local AI replay unless the user names another model.
- When the strategy already has deterministic adapter fields like:
  - `approvalAllowedNow`
  - `deterministicQuality`
  - `structuralHardBlockReasons`
    local replay is the preferred research mode.
- If these fields are missing, add them before trusting `--localOnly`.
