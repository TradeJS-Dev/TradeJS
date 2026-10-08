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

## Remote data through MCP

When a TradeJS MCP server is configured, follow `$tradejs-mcp` for remote reads.
Check server/user/deployment identity before interpreting the result. Prefer
verified diagnostic artifacts and validate their SHA-256 after download;
keep existing local research evidence as the source for candidate selection.
Use `backtest_list_configs` for remote named grids. Do not initiate OAuth,
start a new job from this read-only workflow, or silently fall back to SSH.
