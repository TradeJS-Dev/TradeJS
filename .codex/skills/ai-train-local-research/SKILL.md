---
name: ai-train-local-research
description: Run strategy-neutral TradeJS ai-train investigations, especially local deterministic gate research with `yarn ai-train --localOnly`, `yarn ai-pocket-search`, qN+ metrics, pocket discovery, drawdown/winrate analysis, time/symbol stability checks, and gate-vs-LLM comparison when needed.
---

# AI Train Local Research

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
- save conclusions in `notes/AI_*_REPLAY_NOTES.md`
- tune approval cadence toward roughly 2-3 approved trades per day when possible, with ~1 approved trade per day as the practical lower bound for narrow high-quality pockets; if a gate approves more, look for filters that lower approvals and raise winrate

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
- Check train and validation support separately. A profitable pocket with tiny
  validation support is a hypothesis, not a gate rule.
- Check stability by direction, month/quarter, and symbol. Avoid rules where the
  result depends on one short period, one side, or a few symbols.
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
- Report train and validation metrics, support, direction split, month/quarter
  split, symbol concentration, PF, drawdown, and max loss streak.
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
  market-state, setup-event-count, or data-availability, and whether it depends
  on lookback/window/cache/provider settings.
- **Walk-forward validation**: when the export spans enough history, validate
  across multiple chronological folds or at least month/quarter buckets. Prefer
  pockets that survive changing market regimes over pockets that win only in a
  single terminal validation split.
- **Acceptance gates**: define minimum validation support, maximum symbol
  concentration, acceptable losing months, max loss streak, PF/drawdown
  improvement, and cadence bounds before recommending implementation. If a
  candidate misses any gate, classify it as research-only. Default gates unless
  strategy evidence justifies otherwise: validation support `>= 25`, no single
  symbol provides more than about one third of approved profit or count, no new
  losing-month cluster, no worse max loss streak, and cadence remains within the
  target live range.
- **Negative control**: for suspiciously strong or highly specific pockets, run
  a sanity check such as shuffled labels/profits or a nearby nonsense feature.
  A pocket that still looks good under a negative control is overfit or the
  script is wrong.
- **Boundary tests**: require unit tests for implemented gate changes at the
  threshold boundary, just above/below it, with missing/null fields, and with
  rounded thresholds rather than raw optimizer cutoffs.
- **Passive rollout**: prefer adding new or changed gate logic in observation
  mode first. Log old decision, new decision, and reason deltas for a live
  comparison window before enforcing approvals, unless the user explicitly asks
  for immediate enforcement and accepts the risk.
- **Old-gate cleanup**: when an old pocket is replaced or disabled, remove dead
  constants/prompt fields/tests, update notes, and explain the migration path.

## Workflow

1. Confirm the latest merged dataset exists.

Prefer:

```bash
node -e "const fs=require('fs');const p='data/ai/export';const f=fs.readdirSync(p).filter(x=>x.startsWith('ai-dataset-<token>-merged-')&&x.endsWith('.jsonl')).sort().at(-1); console.log(f?require('path').join(p,f):'');"
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

Useful check:

```bash
node - <<'NODE'
const fs=require('fs');
const path=require('path');
const p='data/ai/export';
const entries=fs.readdirSync(p).filter(x=>x.endsWith('.jsonl'));
const groups=new Map();
for (const name of entries) {
  const m=name.match(/^ai-dataset-(.+)-merged-(\d+)(?:-part(\d+))?\.jsonl$/);
  if (!m) continue;
  const key=`${m[1]}:${m[2]}`;
  const row=groups.get(key) ?? {strategy:m[1], mergeId:m[2], files:[]};
  row.files.push(name);
  groups.set(key,row);
}
for (const row of [...groups.values()].sort((a,b)=>a.mergeId.localeCompare(b.mergeId))) {
  row.files.sort((a,b)=>{
    const ap=Number(a.match(/-part(\d+)\.jsonl$/)?.[1] ?? 0);
    const bp=Number(b.match(/-part(\d+)\.jsonl$/)?.[1] ?? 0);
    return ap-bp || a.localeCompare(b);
  });
  console.log(`${row.strategy} merge=${row.mergeId} shards=${row.files.length}`);
  for (const file of row.files) console.log(`  ${path.join(p,file)}`);
}
NODE
```

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
yarn ai-pocket-search --strategy TrendLine -n 0 --maxDepth 2 --minSupport 25
```

### Freshness and terminal-window gate

For any current/live cadence conclusion, run all selected rows so one execution
produces the full result and terminal summaries:

```bash
yarn ai-train --strategy <Strategy> -n 0 --localOnly
```

The default terminal windows are `90d,30d,7d`, anchored to the maximum dataset
timestamp. Use `--terminalWindows=90,30,11,7` when the production comparison
uses an 11-day window. Do not run the provider repeatedly for these windows;
the command derives them from the same evaluated rows.

Before stating expected production cadence:

- record dataset min/max timestamps and `dataLagDays`
- require the export to overlap the production window under discussion
- report full history and every terminal window, including zero approvals
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
- do not rename benchmark evidence as target evidence in reports
- do not switch an existing gate from benchmark to target behavior without a
  new export, terminal validation, and updated notes

After any gate-code change, rerun the command and update the matching
`notes/AI_*_REPLAY_NOTES.md`. Metrics from an older gate fingerprint are
historical context only.

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
- if you need a truly partial replay, create an explicit temp slice first instead of assuming one shard equals one isolated window
- `yarn ai-train --localOnly --json` is the baseline source of truth for current deterministic gate metrics
- `yarn ai-pocket-search` is the default pocket discovery tool for future AI-gate rules. It reconstructs current strategy AI payloads, excludes outcome/current gate-output fields by default, shows progress bars, deduplicates equivalent row-selection pockets, and writes a Markdown report under `data/ai/output`.
- `ai-pocket-search` uses time-ordered holdout validation by default (`--validationSplit 0.25`). Treat train-only pockets as hypotheses; prefer pockets with enough validation support and acceptable validation PnL/PF/drawdown. Use `--validationSplit 0` only for legacy full-sample exploration.
- use `--includeGateContext` only for auditing existing gate output fields, not for discovering new future approval rules
- use `--scope approved` with a smaller `--minSupport` to find sub-pockets inside the current qN+ approved stream; use `--scope all` or `--scope candidates` to look for expansion candidates
- when doing offline pocket research, prefer `--dumpEvaluations` for the evaluated rows
- when the research needs signal-time gate inputs such as CMC, MTF, ATR bucket, benchmark conflict, participation, execution, or strategy-specific `*GateFeatures`, add `--dumpFeatures gateFeatures`; this writes the current `baseContext.gateFeatures` and strategy gate features into each dump row
- when broader context is needed, use `--dumpFeatures baseContext`; it writes compact current base-context sections (`regime`, `structure`, `participation`, `relative`, `derivatives`, `mtf`, `gateFeatures`) without the bulky `raw` section
- join/compare extra fields from the original dataset only when they are not available through `--dumpFeatures`, and treat those joined fields as explanatory features rather than current gate truth after adapter changes
- before trusting a custom script, verify its baseline `approved`, q4+, q5+, PnL, PF, max drawdown, and max loss streak match `yarn ai-train --localOnly --json` for the same export/window

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

Use the same period logic as `packages/cli/src/lib/aiTrainMetrics.ts`: `(max timestamp - min timestamp) / 1 day`, with a minimum of `1` day. If useful, also mention the full-window normalization separately, but the required table is for the default approved stream named in `qN+` notation. If `q5+` or another threshold is important for the strategy, include it too. If the user explicitly asks for isolated `q1` / `q2` / `q3` / `q4` / `q5`, report those separately and label them clearly.

7. For deeper FP/FN analysis, do not read the entire merged JSONL into memory.

For large exports:

- if the export is sharded, stream across shards in part order first
- use `tail -n <N>` or another streaming slice on the combined stream
- then run a small local script against only the selected window

Preferred pattern:

```bash
tmp=$(mktemp)
cat data/ai/export/ai-dataset-<token>-merged-<ts>-part*.jsonl | tail -n 500 > "$tmp"
TMP_PATH="$tmp" node --input-type=commonjs <<'NODE'
// read only TMP_PATH, reconstruct signal from row.payload,
// use buildAiPayload / runAiPromptLocal from packages/node/dist/ai.js,
// cluster FP / FN / approved pockets by deterministic context fields
NODE
rc=$?
rm -f "$tmp"
exit $rc
```

Important custom-script correctness rules:

- Do not treat saved strategy context in the dataset as current gate truth after adapter changes. Fields such as `payload.additionalIndicators.adaptiveMomentumRibbonContext`, `trendLineContext`, `reverseTrendlineContext`, etc. may be stale snapshots from export time.
- If a custom script needs current deterministic gate fields, reconstruct the `Signal` from the dataset row, call the current `buildAiPayload(signal)`, then read the freshly built context from that payload.
- When importing from `packages/node/dist/ai.mjs` or `packages/node/dist/ai.js`, always call `ensureAiStrategyPluginsLoaded()` before `buildAiPayload`, `getDeterministicAiGateContext`, or `runAiPromptLocal`. Without plugin registration the default/base adapter may be used and the script may silently read stale context from the dataset.
- If strategy adapter code was changed after the last build, run the relevant build before importing from `dist`, for example `yarn workspace @tradejs/strategies build` and the package that provides the imported helper. Otherwise use the checked-in CLI flow (`yarn ai-train`) as the authoritative replay path.
- Keep outcome fields separate from decision fields. `profit`, `tradeResult`, delayed execution fields, exit reason, and final result are labels/diagnostics only; they must not be used to decide approval for the same signal.
- Any custom rule search must print the baseline from the same script and compare it against `yarn ai-train --localOnly --json`. If they differ materially, stop and fix the script before interpreting hypotheses.
- Be careful with shell/JQ precedence when inspecting JSON. Prefer a tiny Node snippet that parses one row and prints explicit keys over complex one-line `jq` expressions.

ESM custom-script skeleton:

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
import readline from 'node:readline';
import {
  buildAiPayload,
  ensureAiStrategyPluginsLoaded,
  getDeterministicAiGateContext,
} from './packages/node/dist/ai.mjs';

await ensureAiStrategyPluginsLoaded();

const signalFromRow = (row) => ({
  ...row.payload.signal,
  strategy: row.payload.signal.strategy,
  figures: row.payload.figures ?? {},
  indicators: row.payload.indicators ?? {},
  additionalIndicators: row.payload.additionalIndicators ?? {},
  prices: row.payload.signal.prices,
});

for (const filePath of process.argv.slice(2)) {
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const signal = signalFromRow(row);
    const payload = buildAiPayload(signal);
    const gateContext = getDeterministicAiGateContext(payload);
    // Use gateContext for current gate decision features.
    // Use row.profit/tradeResult only as labels for evaluation.
  }
}
NODE
```

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
  or a custom split
- include an ablation table: baseline, pocket-only when applicable, and final
  gate
- require boundary tests and a passive-rollout plan for implemented gate changes
- clean up old disabled pockets instead of leaving dead constants or prompt
  fields behind
- compare q4+ and q5+ separately
- report winrate as a percentage
- report max drawdown both as an absolute value and as percentages of gross profit and total profit
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

## Notes format

Write results to:

- `notes/AI_TRENDLINE_REPLAY_NOTES.md`
- `notes/AI_REVERSE_TRENDLINE_REPLAY_NOTES.md`
- `notes/AI_VOLUME_DIVERGENCE_REPLAY_NOTES.md`
- or the matching new file for the strategy under review

Keep the structure similar:

1. strategy intent
2. current export and config
3. replay mode used
4. latest window metrics
5. `q4+` approved cadence/profit metrics:
   - `winrate`
   - `profit_factor`
   - `max_drawdown`
   - `max_drawdown_pct_of_gross_profit`
   - `max_drawdown_pct_of_total_profit`
   - `max_consecutive_losses` / `max loss streak`
   - losing approved months count, with month ids and monthly approved PnL when non-zero
   - `avg_profit_approved_per_day`
   - `avg_profit_approved_per_month`
   - `avg_approved_trades_per_day`
   - `avg_approved_trades_per_week`
6. main discoveries
7. best and worst pockets
8. concrete next improvements for:
   - strategy core
   - backtest config
   - AI adapter
9. existing gate audit:
   - current pockets and thresholds
   - classification: `keep`, `round`, `replace`, `disable`, `needs-more-data`
   - old high-precision and data-count conditions
10. live-env parity and feature provenance:
    - live env assumptions vs export/replay assumptions
    - source, causality, field type, and env sensitivity for every pocket field
11. validation evidence:
    - train vs validation support
    - walk-forward or month/quarter split
    - symbol concentration
    - ablation table
    - negative-control result when applicable
12. threshold implementation:
    - raw discovered thresholds
    - rounded implemented thresholds
    - sensitivity results
    - boundary tests added or still missing
13. rollout and cleanup:
    - passive rollout or immediate enforcement decision
    - old gate cleanup required
    - remaining blockers before production

## Current repo conventions

- Prefer `GPT-5 Mini` by default for non-local AI replay unless the user names another model.
- When the strategy already has deterministic adapter fields like:
  - `approvalAllowedNow`
  - `deterministicQuality`
  - `structuralHardBlockReasons`
    local replay is the preferred research mode.
- If these fields are missing, add them before trusting `--localOnly`.

## Existing examples

Use these files as style references:

- `notes/AI_TRENDLINE_REPLAY_NOTES.md`
- `notes/AI_REVERSE_TRENDLINE_REPLAY_NOTES.md`
- `notes/AI_VOLUME_DIVERGENCE_REPLAY_NOTES.md`
