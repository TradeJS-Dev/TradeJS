---
sidebar_position: 9
title: How Signals Work
---

## Entry Point

```bash
npx @tradejs/cli signals
```

Main script:

- `@tradejs/cli`

## Real Strategy Config Source

Signal runtime loads active strategy configs from Redis keys like:

- `users:<user>:strategies:TrendLine:config`

And resolves creators dynamically:

```ts
const strategyCreator = await getStrategyCreator(strategyName);
const strategy = await strategyCreator({
  userName: flags.user,
  connector,
  symbol,
  data: [...cachedData],
  btcData: [...btcCachedData],
  btcBinanceData: [...btcBinanceData],
  btcCoinbaseData: [...btcCoinbaseData],
  config: {
    ...strategyConfig,
    ENV: 'CRON',
    INTERVAL: interval,
    MAKE_ORDERS: flags.makeOrders,
  },
});
```

## Pipeline

1. Load active strategy configs.
2. Load symbol candles + BTC context data.
3. Run strategy runtime for each symbol.
4. Save produced signals to Redis.
5. Optionally send screenshots and Telegram notifications.

## Order Execution

- Enable with `--makeOrders`.
- Runtime can still skip orders due to AI/ML policy.
- Signal can be stored with `orderStatus = skipped` when gate blocks execution.

## Telegram Notifications

```bash
npx @tradejs/cli signals --notify
```

When AI analysis is present, Telegram receives a follow-up analysis message.

See full setup:

- [Telegram Notifications](./telegram-notifications)
