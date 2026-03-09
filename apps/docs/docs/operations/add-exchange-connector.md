---
title: Add a New Exchange Connector
---

This guide explains how to add a new exchange connector and where integration points are.

## 1. Implement Connector Creator

Create a new folder:

- `@tradejs/connectors`

Implement `ConnectorCreator` and return full `Connector` contract:

- `kline`
- `getTickers`
- `getPosition`, `getPositions`
- `placeOrder`, `closePosition`
- `getState`, `setState`

Reference implementations:

- Binance connector in `@tradejs/connectors`
- Coinbase connector in `@tradejs/connectors`
- ByBit connector in `@tradejs/connectors`

## 2. Register Connector In One Place

Register in:

- `@tradejs/connectors`

Update:

- `ConnectorNames`
- `ConnectorProviders`
- `providerToConnectorName`
- `connectors`

After this, `backtest` connector resolution and `continuity --provider` use the shared provider map.

## 3. Type Updates

If provider is user-facing in filters/configs, update provider union in:

- `@tradejs/core` (`Provider`)

## 4. CLI Integration Points

Already map-based:

- `backtest` command in `@tradejs/cli`
- `continuity` command in `@tradejs/cli`

Still strategy-specific/fixed in current architecture:

- `backtest.ts` and `signals.ts` also load BTC reference data from Binance/Coinbase for spread/correlation paths
- `results.ts --coverage` uses ByBit ticker universe for denominator

So adding a connector for generic market history is easy, but some flows intentionally keep Binance/Coinbase/ByBit roles.

## 5. Recommended Validation Checklist

1. Run TypeScript checks in your connector project.
2. Run unit tests in your connector project.
3. `npx @tradejs/cli backtest --updateOnly --connector <provider> --config <Strategy:Config> --timeframe 15`
4. `npx @tradejs/cli continuity --provider <provider> --timeframe 15 --tickers BTCUSDT`
5. `npx @tradejs/cli backtest --connector <provider> --config <Strategy:Config> --tests 20`

## 6. Optional Next Step

If you want even fewer entry points for new connectors, you can extract BTC reference providers and coverage universe into configurable provider settings instead of fixed Binance/Coinbase/ByBit choices.
