# @tradejs/core

Core TradeJS package for strategy and indicator development.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart
- Core API docs: https://docs.tradejs.dev/api/framework

## Install

```bash
npm i @tradejs/core
```

## Minimal example

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@your-scope/tradejs-strategies'],
  indicators: ['@your-scope/tradejs-indicators'],
  connectors: ['@your-scope/tradejs-connectors'],
});
```

Import rule:

- config/plugin registration should be imported from `@tradejs/core/config`
- runtime/helpers should be imported from explicit public subpaths like `@tradejs/core/strategies`, `@tradejs/core/indicators`, `@tradejs/core/backtest`, `@tradejs/core/math`, `@tradejs/core/time`, `@tradejs/core/pine`
- shared types should be imported from `@tradejs/types`
- avoid internal aliases (`@utils`, `@constants`) and non-public deep imports

Repository conventions for `utils`:

- runtime utilities live under `packages/core/src/utils/*` and `packages/infra/src/*`
- test-only helpers must live under `packages/core/src/utils/testHelpers/*`
- do not keep duplicate helper implementations in production runtime files

For CLI commands, use `@tradejs/cli`.
