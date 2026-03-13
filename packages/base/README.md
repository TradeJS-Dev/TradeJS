# @tradejs/base

Default TradeJS preset.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## What It Provides

`basePreset` wires the built-in TradeJS packages:

- `@tradejs/strategies`
- `@tradejs/indicators`
- `@tradejs/connectors`

Use it as the starting point for external projects, then append your own plugin packages.

## Install

```bash
npm i @tradejs/base @tradejs/core
```

## Usage

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@your-scope/tradejs-strategies'],
  indicators: ['@your-scope/tradejs-indicators'],
  connectors: ['@your-scope/tradejs-connectors'],
});
```

If you only need the built-in catalog, `defineConfig(basePreset)` is enough.
