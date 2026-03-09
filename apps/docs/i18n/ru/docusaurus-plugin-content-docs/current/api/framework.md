---
sidebar_position: 5
title: Core API
---

`@tradejs/core` — публичный пакет для разработки strategy и indicator плагинов в TradeJS.

## Что экспортируется

- `defineConfig(config)`
- `defineStrategyPlugin(plugin)`
- `defineIndicatorPlugin(plugin)`
- runtime-типы из `@tradejs/core/types`

## Как подключить плагины

Создайте `tradejs.config.ts` в корне проекта:

```ts
import { defineConfig } from '@tradejs/core';

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

## Strategy plugin API

Плагин стратегии экспортирует `strategyEntries`:

```ts
import {
  defineStrategyPlugin,
  type StrategyRegistryEntry,
} from '@tradejs/core';

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

## Strategy Manifest

Каждый strategy entry содержит `manifest` с полями:

- обязательное `name`
- опциональные `hooks`
- опциональный `aiAdapter`
- опциональный `mlAdapter`

Подробно про lifecycle-хуки: [Strategy Hooks](../runtime/execution/strategy-hooks).

## Indicator plugin API

Плагин индикаторов экспортирует `indicatorEntries`:

```ts
import { defineIndicatorPlugin } from '@tradejs/core';

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

Контракты лежат в `@tradejs/core`.
