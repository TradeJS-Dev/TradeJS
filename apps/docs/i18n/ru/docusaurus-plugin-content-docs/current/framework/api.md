---
sidebar_position: 5
title: API Framework
---

`@tradejs/framework` — публичный пакет для пользователей, которые хотят расширять TradeJS своими стратегиями и индикаторами.

## Что экспортируется

- `defineConfig(config)`
- `defineStrategyPlugin(plugin)`
- `defineIndicatorPlugin(plugin)`
- runtime-типы из `@tradejs/core/types`

## Как подключить плагины

Создайте `tradejs.config.ts` в корне проекта:

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  strategyPlugins: ['@scope/my-strategy-plugin'],
  indicatorsPlugins: ['@scope/my-indicator-plugin'],
});
```

Поддерживаемые имена файла:

- `tradejs.config.ts`
- `tradejs.config.mts`
- `tradejs.config.js`
- `tradejs.config.mjs`
- `tradejs.config.cjs`

## Реальный пример из проекта: creator для TrendLine

```ts
import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG, TrendLineConfig } from './config';
import { createTrendLineCore } from './core';

export const TrendlineStrategyCreator = createStrategyRuntime<TrendLineConfig>({
  strategyName: 'TrendLine',
  defaults: DEFAULT_CONFIG as TrendLineConfig,
  createCore: createTrendLineCore,
});
```

## Реальный пример: manifest TrendLine

```ts
import { StrategyManifest } from '@types';
import { trendLineAiAdapter } from './adapters/ai';
import { trendLineMlAdapter } from './adapters/ml';
import { trendLineBeforePlaceOrderHook } from './hooks';

export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  hooks: {
    beforePlaceOrder: trendLineBeforePlaceOrderHook,
  },
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
```

## Strategy plugin API

Плагин стратегии экспортирует `strategyEntries`:

```ts
import {
  defineStrategyPlugin,
  type StrategyRegistryEntry,
} from '@tradejs/framework';

const strategyEntries: StrategyRegistryEntry[] = [
  {
    manifest: { name: 'MyStrategy' },
    creator: async () => {
      return async () => 'NO_SIGNAL';
    },
  },
];

export default defineStrategyPlugin({ strategyEntries });
```

## Indicator plugin API

Плагин индикаторов экспортирует `indicatorEntries`:

```ts
import { defineIndicatorPlugin } from '@tradejs/framework';

export default defineIndicatorPlugin({
  indicatorEntries: [
    {
      indicator: { id: 'myIndicator', label: 'My Indicator', enabled: false },
      historyKey: 'myIndicatorHistory',
      compute: ({ data }) => data.at(-1)?.close ?? null,
      renderer: {
        indicatorName: 'MY_INDICATOR',
        shortName: 'MY_IND',
        paneId: 'candle_pane',
        figures: [{ key: 'myIndicator', title: 'MY_IND', type: 'line' }],
      },
    },
  ],
});
```

## Типы, которые чаще всего нужны

- `StrategyCreator`
- `StrategyDecision`
- `StrategyAPI`
- `Signal`
- `Direction`, `Interval`, `Candle`

Контракты лежат в `packages/core/src/types/*`.
