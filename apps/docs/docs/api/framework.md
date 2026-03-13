---
sidebar_position: 5
title: Core API
---

`@tradejs/core` is the public package for strategy and indicator plugin development.

## Main Exports

- `defineConfig(basePreset, overrides)`
- `defineStrategyPlugin(plugin)`
- `defineIndicatorPlugin(plugin)`
- `defineConnectorPlugin(plugin)`
- Shared types are available from `@tradejs/types`

## Import Rule

- Import config/plugin registration from `@tradejs/core/config`.
- Import runtime/helpers from explicit public subpaths like `@tradejs/node/strategies`, `@tradejs/node/backtest`, `@tradejs/core/indicators`, `@tradejs/core/math`, `@tradejs/core/time`, `@tradejs/node/pine`.
- Import shared types from `@tradejs/types`.
- Do not use internal aliases (`@utils`, `@constants`).
- Do not use non-public deep imports.

## Utilities Convention (Contributors)

- Keep browser-safe helpers inside `@tradejs/core`, Node runtime helpers inside `@tradejs/node`, and infra adapters inside `@tradejs/infra`.
- Keep test-only helpers isolated from runtime code and export only stable APIs.
- Avoid duplicated helper logic across runtime files; extract shared helpers instead.

## Project Config API

Create `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@scope/my-strategy-plugin', './src/plugins/strategy.ts'],
  indicators: ['@scope/my-indicator-plugin', './src/plugins/indicator.ts'],
  connectors: ['@scope/my-connector-plugin', './src/plugins/connector.ts'],
});
```

Each plugin entry is a module specifier string:

- npm package name (for example `@scope/my-plugin`)
- local relative path from project root (for example `./src/plugins/connector.ts`)
- absolute path or `file://` URL

Supported filenames:

- `tradejs.config.ts`
- `tradejs.config.mts`
- `tradejs.config.js`
- `tradejs.config.mjs`
- `tradejs.config.cjs`

## Strategy Plugin API

A strategy plugin exports `strategyEntries`:

```ts
import { defineStrategyPlugin } from '@tradejs/core/config';
import type { StrategyRegistryEntry } from '@tradejs/types';

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

For hook lifecycle details, see [Strategy Runtime Hooks](../strategies/authoring/strategy-hooks).

## Indicator Plugin API

An indicator plugin exports `indicatorEntries`:

```ts
import { defineIndicatorPlugin } from '@tradejs/core/config';

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

## Connector Plugin API

A connector plugin exports `connectorEntries`:

```ts
import { defineConnectorPlugin } from '@tradejs/core/config';
import type { ConnectorRegistryEntry } from '@tradejs/types';

const connectorEntries: ConnectorRegistryEntry[] = [
  {
    name: 'MyExchange',
    providers: ['myexchange', 'mx'],
    creator: async ({ userName }) => {
      return {
        kline: async () => [],
        getTickers: async () => [],
        getPosition: async () => null,
        getPositions: async () => [],
        placeOrder: async () => true,
        closePosition: async () => true,
        getState: async () => ({}),
        setState: async () => {},
      };
    },
  },
];

export default defineConnectorPlugin({ connectorEntries });
```

## Runtime Types You Will Use Most

- `StrategyCreator`
- `StrategyDecision`
- `StrategyAPI`
- `Signal`
- `Direction`, `Interval`, `Candle`

See shared contracts in `@tradejs/types` and public helper/runtime entrypoints in `@tradejs/core/*` and `@tradejs/node/*`.
