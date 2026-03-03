---
sidebar_position: 5
title: Framework API
---

`@tradejs/framework` is the public package for end users who want to extend TradeJS.

## Exports

- `defineConfig(config)`
- `defineStrategyPlugin(plugin)`
- `defineIndicatorPlugin(plugin)`
- Core types re-exported from `@tradejs/core/types`

## Project Config API

Create `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  strategyPlugins: ['@scope/my-strategy-plugin'],
  indicatorsPlugins: ['@scope/my-indicator-plugin'],
});
```

Supported filenames:

- `tradejs.config.ts`
- `tradejs.config.mts`
- `tradejs.config.js`
- `tradejs.config.mjs`
- `tradejs.config.cjs`

## Real Built-In Example: TrendLine Runtime Creator

TradeJS itself wires built-in strategies through the same runtime API:

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

## Real Built-In Example: TrendLine Manifest

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

## Strategy Plugin API

A strategy plugin exports `strategyEntries`:

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

## Indicator Plugin API

An indicator plugin exports `indicatorEntries`:

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

## Runtime Types You Will Use Most

- `StrategyCreator`
- `StrategyDecision`
- `StrategyAPI`
- `Signal`
- `Direction`, `Interval`, `Candle`

See contracts in `packages/core/src/types/*`.
