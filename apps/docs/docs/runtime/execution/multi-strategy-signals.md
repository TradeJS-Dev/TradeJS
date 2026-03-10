---
title: Multi-Strategy Runtime
---

`npx @tradejs/cli signals` can run multiple strategies in one pass.

Source:

- `@tradejs/cli`

## How Strategies Are Loaded

For selected user, runtime scans keys:

- `users:<user>:strategies:*:config`

For each key it resolves:

- strategy name from Redis key
- creator via `getStrategyCreator(strategyName)`
- config payload from Redis

Unknown strategies are skipped with warning.

## Per-Symbol Execution Order

1. Load symbol candles and BTC context candles.
2. Iterate loaded strategies in sorted config-key order.
3. Run each strategy.
4. On first non-empty signal:

- save signal to Redis
- stop checking other strategies for this symbol

So current behavior is **first signal wins per symbol** in one run.

## Data Context

Every strategy receives:

- symbol candles (`data`)
- BTC symbol candles (`btcData`)
- BTC Binance/Coinbase candles (for spread/correlation context)

Runtime injects:

- `ENV: 'CRON'`
- selected `INTERVAL`
- `MAKE_ORDERS` from CLI flag

## Practical Setup

1. Put multiple strategy configs under `users:<user>:strategies:<Strategy>:config`.
2. Run:

```bash
npx @tradejs/cli signals --user root --timeframe 15
```

3. Optional notifications/orders:

```bash
npx @tradejs/cli signals --user root --timeframe 15 --notify --makeOrders
```

## Related

- [How Signals Work](./signals)
- [Results -> Runtime Config Promotion](../backtesting/results-runtime-config)
