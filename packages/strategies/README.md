# @tradejs/strategies

Built-in strategy plugin package for the TradeJS TypeScript framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

Version 2.0.0 and later is licensed under Business Source License 1.1. The
Additional Use Grant permits internal and other non-competing production use;
providing a competing product or service requires a commercial license.
Earlier releases remain MIT-licensed. See the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## What It Provides

This package contains the built-in strategy plugin catalog.

It is intended to be connected through `tradejs.config.ts` and used by CLI/runtime/app flows.

## Install

```bash
npm i @tradejs/strategies @tradejs/core @tradejs/node
```

## Usage

Most projects should not add this package manually. It is already included by `@tradejs/base`.

If you want to reference it explicitly:

```ts
import { defineConfig } from '@tradejs/core/config';

export default defineConfig({
  strategies: ['@tradejs/strategies'],
});
```

## For Custom Strategies

Use `defineStrategyPlugin(...)` from `@tradejs/core/config` in your own package and add that package to `strategies` in `tradejs.config.ts`.
