# @tradejs/connectors

Built-in TradeJS connector package.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## What It Provides

This package contains the built-in connector plugin catalog used by TradeJS runtime:

- exchange connectors
- market data providers
- built-in test connector support used by backtests/runtime flows

## Install

```bash
npm i @tradejs/connectors @tradejs/core
```

## Usage

Most projects should not add this package manually. It is already included by `@tradejs/base`.

If you want to reference it explicitly:

```ts
import { defineConfig } from '@tradejs/core/config';

export default defineConfig({
  connectors: ['@tradejs/connectors'],
});
```

## For Custom Connectors

Use `defineConnectorPlugin(...)` from `@tradejs/core/config` in your own package and add that package to `connectors` in `tradejs.config.ts`.
