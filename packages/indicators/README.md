# @tradejs/indicators

Use built-in indicators on TradeJS charts or in your strategies.
For example, a moving average smooths recent candles to make the price
trend easier to see.

[See indicators and setup examples in the TradeJS Marketplace](https://tradejs.dev/marketplace/indicators).

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

This package remains MIT-licensed. Some TradeJS runtime dependencies use the
Business Source License 1.1; see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## What It Provides

Open **Indicators** on a TradeJS chart to see the registered indicators.
Adding an indicator to the chart leaves the strategy’s trading rules as
configured. Register indicator packages in `tradejs.config.ts`.

It also exposes strategy-neutral, replay-safe indicator engines through explicit
subpaths. These modules are libraries and do not register plugin entries by
themselves.

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

For a causal range detector that only uses candles available at each call:

```ts
import { createCausalRangeGeometryEngine } from '@tradejs/indicators/range-geometry';
```

`@tradejs/indicators/range-geometry` is the public owner of the shared range
geometry used by the Grid strategy family. It does not depend on either
strategy or on StrategyAPI.

## For Custom Indicators

Use `defineIndicatorPlugin(...)` from `@tradejs/core/config` in your own package and add that package to `indicators` in `tradejs.config.ts`.

Keywords: ai, claude, codex.
