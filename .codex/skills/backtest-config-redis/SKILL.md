---
name: backtest-config-redis
description: Fetch a TradeJS backtest or strategy configuration from the local RedisJSON users configuration namespace by config name, including named variants such as Grid:ai or TrendLine:research. Use for inspecting, reproducing, or recording Redis-backed strategy grids.
---

# Backtest Config from Redis

## Use

- Ask for the config name if not provided.
- Read the RedisJSON value from
  `users:<user>:backtests:configs:<config>` and return the config object as-is
  unless the user asks to edit or reformat it. The default user is `root`.
- Prefer using the script `scripts/get_backtest_config.sh` to access Redis via Docker.
- If the container name differs from `inv-redis`, ask for the correct name.
- For research lineage, embed the returned JSON and a canonical checksum in the
  note. The mutable Redis key alone is not reproduction evidence.
