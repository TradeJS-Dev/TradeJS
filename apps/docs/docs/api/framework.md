---
sidebar_position: 5
title: Core API
---

`@tradejs/core` is the public package for strategy and indicator plugin development.

## Main Exports

- `defineConfig(config)`
- `defineStrategyPlugin(plugin)`
- `defineIndicatorPlugin(plugin)`
- Core types re-exported from `@tradejs/core/types`

## Project Config API

Create `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core';

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

## Strategy Plugin API

A strategy plugin exports `strategyEntries`:

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

Each strategy entry uses `manifest` with:

- required `name`
- optional `hooks`
- optional `aiAdapter`
- optional `mlAdapter`

For hook lifecycle details, see [Strategy Hooks](../strategies/authoring/strategy-hooks).

## Indicator Plugin API

An indicator plugin exports `indicatorEntries`:

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

## Runtime Types You Will Use Most

- `StrategyCreator`
- `StrategyDecision`
- `StrategyAPI`
- `Signal`
- `Direction`, `Interval`, `Candle`

See contracts in `@tradejs/core`.
