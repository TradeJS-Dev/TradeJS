# @tradejs/indicators

MIT-licensed indicator plugin package for the TradeJS framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

This package remains MIT-licensed. Some TradeJS runtime dependencies use the
Business Source License 1.1; see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## What It Provides

This package contains the built-in indicator catalog used by strategies and charts.

It is intended to be connected as an indicator plugin package through `tradejs.config.ts`.

## Install

```bash
npm i @tradejs/indicators @tradejs/core
```

## Usage

Most projects should not add this package manually. It is already included by `@tradejs/base`.

If you want to reference it explicitly:

```ts
import { defineConfig } from '@tradejs/core/config';

export default defineConfig({
  indicators: ['@tradejs/indicators'],
});
```

## For Custom Indicators

Use `defineIndicatorPlugin(...)` from `@tradejs/core/config` in your own package and add that package to `indicators` in `tradejs.config.ts`.
