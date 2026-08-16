# @tradejs/core

MIT-licensed browser-safe public API for TradeJS: config, strategy authoring helpers, indicators, figures, math, and shared utilities.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart
- Core API docs: https://docs.tradejs.dev/api/framework

## License

This package remains MIT-licensed. Some TradeJS runtime dependencies use the
Business Source License 1.1; see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## Install

```bash
npm i @tradejs/core @tradejs/types
```

Add `@tradejs/node` when you need server/runtime execution helpers.

## Public Surface

Import only explicit public subpaths:

- `@tradejs/core/config`
- `@tradejs/core/strategies`
- `@tradejs/core/indicators`
- `@tradejs/core/backtest`
- `@tradejs/core/math`
- `@tradejs/core/time`
- `@tradejs/core/api`
- `@tradejs/core/figures`
- `@tradejs/core/constants`
- `@tradejs/core/data`
- `@tradejs/core/async`
- `@tradejs/core/http`
- `@tradejs/core/runtimeTrades`
- `@tradejs/core/tickers`

There is no root `@tradejs/core` import surface.

## Minimal Example

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@your-scope/tradejs-strategies'],
  indicators: ['@your-scope/tradejs-indicators'],
  connectors: ['@your-scope/tradejs-connectors'],
});
```

## Import Rules

- import plugin/config helpers from `@tradejs/core/config`
- import browser-safe authoring helpers from explicit `@tradejs/core/*` subpaths
- import shared contracts from `@tradejs/types`
- do not use non-public deep imports like `@tradejs/core/src/*`

For runtime execution, Pine strategy loading, plugin registries, and backtest orchestration, use `@tradejs/node`.
