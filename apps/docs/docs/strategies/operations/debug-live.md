---
title: Debugging Strategies in Live Mode
---

When a strategy behaves unexpectedly in live mode, debug it in layers.

## 1. Confirm Inputs

- Check symbol, interval, and strategy config loaded from Redis.
- Verify market data freshness for target symbol and BTC context.

## 2. Confirm Strategy Decision Path

- Inspect whether strategy returns `skip`, `entry`, or `exit`.
- If `entry` exists but order is missing, inspect runtime policy and gate results.

## 3. Check Runtime Gates

- AI quality threshold (`minQuality`)
- ML threshold and enrichment status
- `MAKE_ORDERS` flag in effective runtime config

## 4. Inspect Stored Artifacts

- Signal records in Redis
- `analysis:<symbol>:<signalId>` for AI decision details
- Recent logs around the same timestamp

## 5. Reproduce With Narrow Scope

- Run one symbol and one strategy.
- Keep `--cacheOnly` where possible for deterministic replay.
