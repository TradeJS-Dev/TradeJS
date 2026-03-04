---
title: Add a New Exchange Connector
---

This guide explains how to add a new exchange connector and where integration points are.

## 1. Implement Connector Creator

Create a new folder:

- `packages/connectors/src/<Exchange>/index.ts`

Implement `ConnectorCreator` and return full `Connector` contract:

- `kline`
- `getTickers`
- `getPosition`, `getPositions`
- `placeOrder`, `closePosition`
- `getState`, `setState`

Reference implementations:

- `packages/connectors/src/Binance/index.ts`
- `packages/connectors/src/Coinbase/index.ts`
- `packages/connectors/src/ByBit/index.ts`

## 2. Register Connector In One Place

Register in:

- `packages/connectors/src/index.ts`

Update:

- `ConnectorNames`
- `ConnectorProviders`
- `providerToConnectorName`
- `connectors`

After this, `backtest` connector resolution and `continuity --provider` use the shared provider map.

## 3. Type Updates

If provider is user-facing in filters/configs, update provider union in:

- `packages/core/src/types/trade.ts` (`Provider`)

## 4. CLI Integration Points

Already map-based:

- `packages/cli/src/scripts/backtest.ts`
- `packages/cli/src/scripts/continuity.ts`

Still strategy-specific/fixed in current architecture:

- `backtest.ts` and `signals.ts` also load BTC reference data from Binance/Coinbase for spread/correlation paths
- `results.ts --coverage` uses ByBit ticker universe for denominator

So adding a connector for generic market history is easy, but some flows intentionally keep Binance/Coinbase/ByBit roles.

## 5. Recommended Validation Checklist

1. `yarn dev-tsc`
2. `yarn unit`
3. `yarn update-history -- --connector <provider> --config <Strategy:Config> --timeframe 15`
4. `yarn continuity --provider <provider> --timeframe 15 --tickers BTCUSDT`
5. `yarn backtest --connector <provider> --config <Strategy:Config> --tests 20`

## 6. Optional Next Step

If you want even fewer entry points for new connectors, you can extract BTC reference providers and coverage universe into configurable provider settings instead of fixed Binance/Coinbase/ByBit choices.
