---
name: backtest-config-redis
description: Fetch backtest configuration from local Redis for any config name when asked for a backtest config or strategy config stored under `backtests:<config>` (e.g., trendline, rsi, macd).
---

# Backtest Config from Redis

## Use

- Ask for the config name if not provided.
- Read from Redis by key `backtests:<config>` and return the JSON as-is unless the user asks to edit or reformat it.
- Prefer using the script `scripts/get_backtest_config.sh` to access Redis via Docker.
- If the container name differs from `inv-redis`, ask for the correct name.
