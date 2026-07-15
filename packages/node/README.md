# @tradejs/node

Node-only runtime package for the TradeJS open-source framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## Where It Fits

`@tradejs/node` is the server/runtime half of TradeJS.

Use it together with:

- `@tradejs/core` for browser-safe/public authoring helpers
- `@tradejs/types` for shared contracts
- `@tradejs/cli` for operational commands
- `@tradejs/app` if you want the installable web UI

## Standard External Install Flow

In a normal external TradeJS project you usually install the full runtime set:

```bash
npm i @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
```

And create `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset);
```

## What It Provides

`@tradejs/node` contains server-only runtime helpers that do not belong in browser-safe `@tradejs/core`:

- strategy runtime execution
- connector/plugin registries
- backtest orchestration helpers
- Pine-backed strategy loading/runtime helpers
- runtime-side operational helpers used by CLI/app

## Public Surface

Import only explicit subpaths:

- `@tradejs/node/strategies`
- `@tradejs/node/backtest`
- `@tradejs/node/pine`
- `@tradejs/node/registry`
- `@tradejs/node/connectors`
- `@tradejs/node/cli`
- `@tradejs/node/constants`

There is no root `@tradejs/node` import surface.

## Minimal Example

```ts
import { createStrategyRuntime } from '@tradejs/node/strategies';
```

## Notes

- `@tradejs/node` is server-only.
- Do not import it into browser/client bundles.
- For plugin/config declaration and browser-safe helpers, use `@tradejs/core`.
- For shared contracts, use `@tradejs/types`.
