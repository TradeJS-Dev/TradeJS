---
name: ai-train-local-research
description: Run strategy-neutral TradeJS ai-train investigations, especially local deterministic gate research with `yarn ai-train --localOnly`, qN+ metrics, drawdown/winrate analysis, time/symbol stability checks, and gate-vs-LLM comparison when needed.
---

# AI Train Local Research

Use this skill when the user asks to:

- run `ai-train` for a strategy
- research or tune a local deterministic AI gate
- analyze `latest N` or `skip K`
- do the replay without OpenRouter
- inspect qN+ approval streams, drawdown, winrate, profit factor, or cadence
- check time stability, symbol concentration, or direction-specific pockets
- compare current results with previous TrendLine / ReverseTrendLine style investigations
- break down false positives / false negatives
- save conclusions in `notes/AI_*_REPLAY_NOTES.md`
- tune approval cadence toward roughly 2-3 approved trades per day when possible, with ~1 approved trade per day as the practical lower bound for narrow high-quality pockets; if a gate approves more, look for filters that lower approvals and raise winrate

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
```

Shard-aware examples:

```bash
yarn ai-train --strategy TrendShift --localOnly --json -n 0
yarn ai-train --strategy TrendShift --file data/ai/export/ai-dataset-trendshift-merged-1779459438806-part1.jsonl --localOnly --json -n 0
```

Interpretation:

- both commands above should evaluate the full shard group for that merge id, not only `part1`
- if you need a truly partial replay, create an explicit temp slice first instead of assuming one shard equals one isolated window

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

- compare q4+ and q5+ separately
- report winrate as a percentage
- report max drawdown both as an absolute value and as percentages of gross profit and total profit
- always report max consecutive losses / max loss streak for the approved stream
- split by direction
- split by quarter or month when the export spans enough time
- check symbol concentration; avoid rules where most profit comes from only a few symbols
- prefer candidate pockets that improve profit factor or drawdown without destroying cadence
- for live-style approval gates, usually aim for about 2-3 approved trades per day, but accept narrow high-quality pockets down to ~1 approved trade per day when profit factor/drawdown materially improve; if a strategy approves substantially more, assume there is likely room to lower approvals and raise winrate with additional filters
- treat tiny added slices as unstable even when aggregate profit improves

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
