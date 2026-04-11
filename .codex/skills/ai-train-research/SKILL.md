---
name: ai-train-research
description: Run repo-specific ai-train investigations for TradeJS strategies, especially when the task is to replay latest N rows, compare local deterministic gate vs LLM mode, analyze TP/FP/TN/FN patterns, inspect the active backtest config in Redis, and write or update notes/AI_*_REPLAY_NOTES.md.
---

# AI Train Research

Use this skill when the user asks to:

- run `ai-train` for a strategy
- analyze `latest N` or `skip K`
- do the replay without OpenRouter
- compare current results with previous TrendLine / ReverseTrendLine style investigations
- break down false positives / false negatives
- save conclusions in `notes/AI_*_REPLAY_NOTES.md`

## Workflow

1. Confirm the latest merged dataset exists.

Prefer:

```bash
node -e "const fs=require('fs');const p='data/ai/export';const f=fs.readdirSync(p).filter(x=>x.startsWith('ai-dataset-<token>-merged-')&&x.endsWith('.jsonl')).sort().at(-1); console.log(f?require('path').join(p,f):'');"
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

4. Run the replay.

Examples:

```bash
yarn ai-train --strategy TrendLine -n 500 --localOnly
yarn ai-train --strategy ReverseTrendLine -n 500 --localOnly
yarn ai-train --strategy VolumeDivergence -n 500 --localOnly
```

5. Read these sections first:

- `OUTCOME`
- `BY DIRECTION`
- `DETERMINISTIC FLOW`
- `QUALITY BREAKDOWN`

6. For deeper FP/FN analysis, do not read the entire merged JSONL into memory.

For large exports:

- use `tail -n <N>` or another streaming slice
- then run a small local script against only the selected window

Preferred pattern:

```bash
tmp=$(mktemp)
tail -n 500 data/ai/export/ai-dataset-<token>-merged-<ts>.jsonl > "$tmp"
TMP_PATH="$tmp" node --input-type=commonjs <<'NODE'
// read only TMP_PATH, reconstruct signal from row.payload,
// use buildAiPayload / runAiPromptLocal from packages/node/dist/ai.js,
// cluster FP / FN / approved pockets by deterministic context fields
NODE
rc=$?
rm -f "$tmp"
exit $rc
```

7. For strategy AI investigations, always look for these questions:

- Is the strategy core firing earlier than the adapter wants?
- Is `quality=5` actually better than `quality=4`?
- Is one direction much worse than the other?
- Are the best pockets counter-trend or aligned?
- Is there a field mismatch between `core.ts` and `adapters/ai.ts`?
- Is the backtest config exploring the detector or only TP/SL?

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
5. main discoveries
6. best and worst pockets
7. concrete next improvements for:
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
