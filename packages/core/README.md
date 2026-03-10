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
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: ['@your-scope/tradejs-strategies'],
  indicatorsPlugins: ['@your-scope/tradejs-indicators'],
});
```

For CLI commands, use `@tradejs/cli`.
