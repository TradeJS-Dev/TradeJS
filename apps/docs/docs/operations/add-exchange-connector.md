---
title: Add a New Exchange Connector
---

This guide explains how to add a new exchange connector and where integration points are.

Important:

- connectors can be registered via `tradejs.config.ts` using `connectorsPlugins`
- connector plugins export `connectorEntries`
- CLI/runtime resolve providers and connector names from the merged built-in + plugin connector registry

## 1. Implement Connector Creator

Implement connector in your own module/package (for example `@your-scope/tradejs-connectors`) and return full typed `Connector` contract.

Minimal typed skeleton:

```ts
import type {
  Connector,
  ConnectorCreator,
  KlineRequest,
  KlineChartData,
  Ticker,
  Position,
  Order,
  Tp,
  Sl,
} from '@tradejs/core/types';

const kline = async (options: KlineRequest): Promise<KlineChartData> => {
  return [];
};

const getTickers = async (): Promise<Ticker[]> => {
  return [];
};

const getPosition = async (symbol: string): Promise<Position | null> => {
  return null;
};

const getPositions = async (): Promise<Position[]> => {
  return [];
};

const placeOrder = async (
  order: Order,
  tp?: Tp[],
  slPrice?: Sl,
): Promise<boolean> => {
  return true;
};

const closePosition = async (order: Omit<Order, 'qty'>): Promise<boolean> => {
  return true;
};

export const MyExchangeConnectorCreator: ConnectorCreator = async ({
  userName,
}) => {
  const connector: Connector = {
    kline,
    getTickers,
    getPosition,
    getPositions,
    placeOrder,
    closePosition,
    getState: async () => ({}),
    setState: async (_state: object) => {},
  };

  return connector;
};
```

Required methods in `Connector`:

- `kline`
- `getTickers`
- `getPosition`, `getPositions`
- `placeOrder`, `closePosition`
- `getState`, `setState`

## 2. Export Connector Plugin Entries

In your connector package, export `connectorEntries`:

```ts
import {
  defineConnectorPlugin,
  type ConnectorRegistryEntry,
} from '@tradejs/core';

import { MyExchangeConnectorCreator } from './myExchangeConnector';

const connectorEntries: ConnectorRegistryEntry[] = [
  {
    name: 'MyExchange',
    providers: ['myexchange', 'mx'],
    creator: MyExchangeConnectorCreator,
  },
];

export default defineConnectorPlugin({ connectorEntries });
```

Then connect plugin package in root config:

```ts
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: [],
  indicatorsPlugins: [],
  connectorsPlugins: ['@your-scope/tradejs-connectors'],
});
```

## 3. Type Updates

If provider is user-facing in filters/configs, update provider union in:

- `@tradejs/core` (`Provider`)

## 4. CLI Integration Points

Already map-based and plugin-aware:

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
