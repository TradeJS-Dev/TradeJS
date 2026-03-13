---
title: TypeScript Strategy Step by Step
---

This guide shows the shortest practical path to build a custom TypeScript strategy with `StrategyAPI`.

Example strategy: simple MA crossover.

Import rule for this guide:

- use public `@tradejs/core/*` subpaths for runtime/helpers and `@tradejs/types` for types
- do not use `@utils`, `@types`, `@constants` or non-public deep imports

## 1. Create Files

Create a folder:

- `src/strategies/SimpleMa`

Create files:

- `config.ts`
- `core.ts`
- `strategy.ts`
- `manifest.ts`
- `src/plugins/simpleMa.plugin.ts`

## 2. Add Strategy Config (`config.ts`)

```ts
import type { Interval, StrategyConfig } from '@tradejs/types';

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  BACKTEST_PRICE_MODE: 'mid' as const,
  MA_FAST: 21,
  MA_SLOW: 55,
  TP_PERCENT: 2,
  SL_PERCENT: 1,
  MAX_LOSS_USDT: 10,
} as const;

export type SimpleMaConfig = StrategyConfig & typeof config;
```

## 3. Add Core Logic (`core.ts`)

```ts
import type { CreateStrategyCore, Direction } from '@tradejs/types';
import { SimpleMaConfig } from './config';

const getCrossDirection = ({
  fastPrev,
  fastCurrent,
  slowPrev,
  slowCurrent,
}: {
  fastPrev: number;
  fastCurrent: number;
  slowPrev: number;
  slowCurrent: number;
}): Direction | null => {
  const entryLong = fastPrev <= slowPrev && fastCurrent > slowCurrent;
  const entryShort = fastPrev >= slowPrev && fastCurrent < slowCurrent;

  if (entryLong) return 'LONG';
  if (entryShort) return 'SHORT';
  return null;
};

export const createSimpleMaCore: CreateStrategyCore<SimpleMaConfig> = async ({
  config,
  strategyApi,
  indicatorsState,
}) => {
  return async () => {
    indicatorsState.onBar();

    const snapshot = indicatorsState.snapshot();
    const maFast = Array.isArray(snapshot?.maFast) ? snapshot.maFast : [];
    const maSlow = Array.isArray(snapshot?.maSlow) ? snapshot.maSlow : [];

    if (maFast.length < 2 || maSlow.length < 2) {
      return strategyApi.skip('WAIT_MA_DATA');
    }

    const [fastPrev, fastCurrent] = maFast.slice(-2);
    const [slowPrev, slowCurrent] = maSlow.slice(-2);

    const direction = getCrossDirection({
      fastPrev,
      fastCurrent,
      slowPrev,
      slowCurrent,
    });

    if (!direction) {
      return strategyApi.skip('NO_CROSS');
    }

    if (await strategyApi.isCurrentPositionExists()) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    const { currentPrice } = await strategyApi.getMarketData();

    const { stopLossPrice, takeProfitPrice, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction,
        takeProfitDelta: config.TP_PERCENT,
        stopLossDelta: config.SL_PERCENT,
        unit: 'percent',
        maxLossValue: config.MAX_LOSS_USDT,
      });

    return strategyApi.entry({
      direction,
      indicators: {
        maFast: fastCurrent,
        maSlow: slowCurrent,
      },
      additionalIndicators: {
        cross: direction === 'LONG' ? 'bullish' : 'bearish',
      },
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

## 4. Wire Runtime and Manifest

`strategy.ts`:

```ts
import { createStrategyRuntime } from '@tradejs/core/strategies';
import { config, SimpleMaConfig } from './config';
import { createSimpleMaCore } from './core';

export const SimpleMaCreator = createStrategyRuntime<SimpleMaConfig>({
  strategyName: 'SimpleMa',
  defaults: config as SimpleMaConfig,
  createCore: createSimpleMaCore,
});
```

`manifest.ts`:

```ts
import type { StrategyManifest } from '@tradejs/types';

export const simpleMaManifest: StrategyManifest = {
  name: 'SimpleMa',
};
```

## 5. Export Plugin Entry

`src/plugins/simpleMa.plugin.ts`:

```ts
import { defineStrategyPlugin } from '@tradejs/core/config';
import { simpleMaManifest } from '../strategies/SimpleMa/manifest';
import { SimpleMaCreator } from '../strategies/SimpleMa/strategy';

export default defineStrategyPlugin({
  strategyEntries: [{ manifest: simpleMaManifest, creator: SimpleMaCreator }],
});
```

`tradejs.config.ts`:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['./src/plugins/simpleMa.plugin.ts'],
});
```

## 6. Add Redis Configs

Runtime config:

```bash
redis-cli JSON.SET users:root:strategies:SimpleMa:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "MA_FAST": 21,
  "MA_SLOW": 55,
  "TP_PERCENT": 2,
  "SL_PERCENT": 1,
  "MAX_LOSS_USDT": 10
}'
```

Backtest config:

```bash
redis-cli JSON.SET users:root:backtests:configs:SimpleMa:quickstart '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "MA_FAST": [14, 21],
  "MA_SLOW": [50, 55],
  "TP_PERCENT": [2],
  "SL_PERCENT": [1],
  "MAX_LOSS_USDT": [10]
}'
```

## 7. Run and Validate

```bash
npx @tradejs/cli backtest --user root --config SimpleMa:quickstart --connector bybit --tests 200 --parallel 4
npx @tradejs/cli results --strategy SimpleMa --coverage --user root
npx @tradejs/cli signals --user root --strategy SimpleMa --connector bybit
```

## Notes

- `indicatorsState.snapshot().maFast/maSlow` comes from shared indicator pipeline.
- Keep `core.ts` focused on decision logic. Execution, AI/ML, hooks, and order placement are handled by shared runtime.
- If you need Pine integration, use [Pine Strategy Step by Step](./pine-strategy-step-by-step).
