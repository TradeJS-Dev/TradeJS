---
name: save-strategy-config-from-backtest
description: Save a TradeJS runtime strategy config in Redis from an existing Redis backtest config grid. Use when the user asks to create, copy, promote, or save a users strategies config key from a backtest config such as Strategy:ai, Strategy:research, or another users backtests configs entry.
---

# Save Strategy Config From Backtest

## Repository roots

Run this skill from `/Users/aleksnick/dev/tradejs/tradejs-project`. Treat that
directory as `PROJECT_CWD`; it owns the local Docker Compose/Redis environment
and the project scripts. Use `TRADEJS_SOURCE_REPOSITORY_ROOT` only when source
code or Git lineage must be inspected.

## Workflow

1. Resolve inputs:
   - user: default `root` unless specified
   - strategy: exact strategy name, e.g. `LiquidityZones`
   - source config: usually `<Strategy>:ai`
   - target key: `users:<user>:strategies:<Strategy>:config`

2. Read the backtest config grid from Redis:

```bash
docker exec inv-redis redis-cli JSON.GET 'users:<user>:backtests:configs:<Strategy>:<name>'
```

If `JSON.GET` returns null and the key is expected to exist, try `GET` as a fallback. If Redis container is not `inv-redis`, inspect `docker ps` or ask for the container name.

3. Convert the backtest grid to a runtime strategy config:
   - Backtest configs are grids: `{ FIELD: [value1, value2] }`.
   - Runtime strategy config is a plain object: `{ FIELD: value }`.
   - For every one-element array, unwrap to its only value.
   - For multi-value arrays, do not pick arbitrarily. Use the best backtest result/config id if the user asked for best config; otherwise ask which value to promote.
   - Preserve nested objects such as `LONG`, `SHORT`, detector configs, AI options, and risk parameters as normal values after unwrapping.

4. Apply TradeJS runtime conventions before saving:
   - Keep `ENABLE` true unless the user asked to save a disabled config.
   - For `:ai` promotion, keep both `LONG` and `SHORT` enabled when present; let the AI gate filter sides later.
   - For ordinary runtime promotion, if `MAX_LOSS_VALUE` exists, set/keep it
     at `10`.
   - When invoked from `$strategy-release` forward-test/micro-forward rollout,
     override `MAX_LOSS_VALUE` to the release risk scale, normally `1`, and
     record that this is a prospective micro-forward config.
   - Preserve `AI_ENABLED`, `AI_MODE`, and `MIN_AI_QUALITY`; do not convert `AI_MODE=gate` results into `llm` expectations.
   - Do not add backtest-only execution artifacts or outcome fields from results.
   - Do not store grid arrays in runtime config.

5. Save to Redis only after showing or checking the final object:

```bash
docker exec inv-redis redis-cli JSON.SET 'users:<user>:strategies:<Strategy>:config' '$' '<json>'
```

Use shell-safe quoting. For non-trivial JSON, write it to a temp file and pass it through `redis-cli -x JSON.SET ... '$'` or use a short Node script to avoid broken quotes.

6. Verify immediately:

```bash
docker exec inv-redis redis-cli JSON.GET 'users:<user>:strategies:<Strategy>:config'
```

Confirm:

- the saved config is an object, not a grid
- `LONG` and `SHORT` are objects when the strategy uses side configs
- `ENABLE` is not false unless intentional
- `AI_ENABLED` / `AI_MODE` / `MIN_AI_QUALITY` match the intended runtime mode
- no obvious backtest-only fields or arrays remain

## Safety Notes

- Never overwrite an existing runtime strategy config blindly. Read and compare it first; mention if the save replaces an existing config.
- Do not infer that local Redis is production runtime. If the user asks about
  live production, ask for the runtime server/source of truth unless the active
  `$strategy-release` rollout context says the user has deployed the pushed
  code and replied `готово`/`ready`; in that case, read and backup the
  production config before writing the exact same candidate config.
- If the source backtest config has multiple candidate values, prefer a config id from actual backtest results over manual guessing.
- After saving, suggest running a narrow verification such as `yarn signals` only when the user wants runtime validation.
