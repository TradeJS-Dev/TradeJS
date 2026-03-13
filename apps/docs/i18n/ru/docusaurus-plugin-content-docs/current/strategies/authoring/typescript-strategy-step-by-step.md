---
title: TypeScript Strategy Step by Step
---

Это самый короткий практический путь, как сделать пользовательскую TypeScript-стратегию через `StrategyAPI`.

Пример стратегии: простое пересечение MA.

Правило импортов для гайда:

- используйте публичные `@tradejs/core/*` subpath’и для browser-safe helper’ов, `@tradejs/node/*` для Node runtime wiring и `@tradejs/types` для типов
- не используйте `@utils`, `@types`, `@constants` и непубличные deep-imports

## 1. Создайте файлы

Создайте папку:

- `src/strategies/SimpleMa`

Создайте файлы:

- `config.ts`
- `core.ts`
- `strategy.ts`
- `manifest.ts`
- `src/plugins/simpleMa.plugin.ts`

## 2. Добавьте конфиг стратегии (`config.ts`)

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

## 3. Добавьте логику стратегии (`core.ts`)

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

## 4. Подключите runtime и manifest

`strategy.ts`:

```ts
import { createStrategyRuntime } from '@tradejs/node/strategies';
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

## 5. Экспортируйте plugin entry

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

## 6. Добавьте Redis-конфиги

Runtime-конфиг:

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

Backtest-конфиг:

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

## 7. Запустите и проверьте

```bash
npx @tradejs/cli backtest --user root --config SimpleMa:quickstart --connector bybit --tests 200 --parallel 4
npx @tradejs/cli results --strategy SimpleMa --coverage --user root
npx @tradejs/cli signals --user root --strategy SimpleMa --connector bybit
```

## Примечания

- `indicatorsState.snapshot().maFast/maSlow` приходит из общего indicator pipeline.
- В `core.ts` оставляйте только стратегическую логику. Исполнение, AI/ML, hooks и placement делает shared runtime.
- Для Pine-пути используйте [Pine Strategy Step by Step](./pine-strategy-step-by-step).
