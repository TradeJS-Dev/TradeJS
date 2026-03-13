---
title: Add Pine Script Indicators
---

TradeJS supports two indicator authoring paths:

- TypeScript indicator plugins (recommended for reusable pane indicators)
- Pine plots inside standalone Pine strategies (for strategy-native visuals/signals)

Important: a standalone Pine indicator plugin (`indicators`) is not supported yet.
Pine indicators are rendered from `plot(...)` series produced by a Pine strategy.

## 1. TypeScript Indicator Path (Standalone Pane Indicator)

Use plugin indicators when you need reusable chart panes independent of one strategy.

See [Write Custom Indicators](./authoring).

## 2. Pine Indicator Path (Inside Pine Strategy)

For Pine strategies (example: `AdaptiveMomentumRibbon`), indicator lines come from Pine `plot(...)` outputs and are converted to `figures`.

If you only extend an existing Pine strategy, you usually edit:

- strategy `.pine` file
- strategy config (`*_LINE_PLOTS`)

Example (`AdaptiveMomentumRibbon`):

### `adaptiveMomentumRibbon.pine`

```pinescript
rsiValue = ta.rsi(close, 14)
plot(rsiValue, "rsi")
```

### strategy config

```json
{
  "AMR_LINE_PLOTS": [
    "kcMidline",
    "kcUpper",
    "kcLower",
    "invalidationLevel",
    "rsi"
  ]
}
```

Then run:

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default
```

or:

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

The new Pine plot appears in `figures.lines`.

## 3. Full Custom Pine Indicator Module (All Files)

If you want a fully custom user Pine indicator, create a custom Pine strategy module.

Minimal file set (user project):

```text
src/strategies/MyPineIndicator/
  myPineIndicator.pine
  config.ts
  figures.ts
  core.ts
  strategy.ts
  manifest.ts
src/plugins/myPineIndicator.plugin.ts
tradejs.config.ts
```

### `myPineIndicator.pine`

```pinescript
//@version=5
indicator("My Pine Indicator", shorttitle="MPI", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
osc = fast - slow

entryLong = ta.crossover(osc, 0)
entryShort = ta.crossunder(osc, 0)
invalidated = false

plot(osc, "myOsc")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
plot(invalidated ? 1 : 0, "invalidated")
```

### `config.ts`

```ts
import type { BacktestPriceMode, StrategyConfig } from '@tradejs/types';

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15',
  BACKTEST_PRICE_MODE: 'mid' as BacktestPriceMode,
  MY_LOOKBACK_BARS: 400,
  MY_LINE_PLOTS: ['myOsc'],
  LONG: { enable: true, direction: 'LONG', TP: 2, SL: 1 },
  SHORT: { enable: true, direction: 'SHORT', TP: 2, SL: 1 },
} as const;

export type MyPineIndicatorConfig = StrategyConfig & typeof config;
```

### `figures.ts`

```ts
import {
  PineContextLike,
  asFiniteNumber,
  getPinePlotSeries,
} from '@tradejs/core/pine';
import type { StrategyEntryModelFigures } from '@tradejs/types';

export const buildMyPineFigures = (
  pineContext: PineContextLike,
): StrategyEntryModelFigures => {
  const points = getPinePlotSeries(pineContext, 'myOsc')
    .slice(-180)
    .map((item) => {
      const timestamp = asFiniteNumber(item?.time);
      const value = asFiniteNumber(item?.value);
      if (timestamp == null || value == null) return null;
      return { timestamp, value };
    })
    .filter(Boolean) as { timestamp: number; value: number }[];

  return {
    lines: [
      {
        id: 'my-osc-line',
        kind: 'my_osc',
        points,
        color: '#22d3ee',
        width: 2,
        style: 'solid',
      },
    ],
  };
};
```

### `core.ts`

```ts
import {
  asPineBoolean,
  getLatestPinePlotValue,
  runPineScript,
} from '@tradejs/core/pine';
import type { CreateStrategyCore } from '@tradejs/types';
import { MyPineIndicatorConfig } from './config';
import { buildMyPineFigures } from './figures';

export const createMyPineIndicatorCore: CreateStrategyCore<
  MyPineIndicatorConfig
> = async ({ config, symbol, loadPineScript, strategyApi }) => {
  const script = loadPineScript('myPineIndicator.pine');

  return async () => {
    if (!script) {
      return strategyApi.skip('PINE_SCRIPT_EMPTY');
    }

    const { fullData, currentPrice } = await strategyApi.getMarketData();
    const pineContext = await runPineScript({
      candles: fullData.slice(-Number(config.MY_LOOKBACK_BARS ?? 400)),
      script,
      symbol,
      timeframe: String(config.INTERVAL ?? '15'),
    });

    const entryLong = asPineBoolean(
      getLatestPinePlotValue(pineContext, 'entryLong'),
    );
    const entryShort = asPineBoolean(
      getLatestPinePlotValue(pineContext, 'entryShort'),
    );

    if (!entryLong && !entryShort) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const mode = entryLong ? config.LONG : config.SHORT;
    if (!mode.enable) {
      return strategyApi.skip('SIDE_DISABLED');
    }

    const { stopLossPrice, takeProfitPrice } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: mode.direction,
        takeProfitDelta: mode.TP,
        stopLossDelta: mode.SL,
        unit: 'percent',
      });

    return strategyApi.entry({
      code: 'MY_PINE_INDICATOR_ENTRY',
      direction: mode.direction,
      figures: buildMyPineFigures(pineContext),
      orderPlan: {
        qty: 1,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

### `strategy.ts`

```ts
import { createStrategyRuntime } from '@tradejs/core/strategies';
import { config, MyPineIndicatorConfig } from './config';
import { createMyPineIndicatorCore } from './core';
import { myPineIndicatorManifest } from './manifest';

export const MyPineIndicatorStrategyCreator =
  createStrategyRuntime<MyPineIndicatorConfig>({
    strategyName: 'MyPineIndicator',
    defaults: config as MyPineIndicatorConfig,
    createCore: createMyPineIndicatorCore,
    manifest: myPineIndicatorManifest,
    strategyDirectory: __dirname,
  });
```

### `manifest.ts`

```ts
import type { StrategyManifest } from '@tradejs/types';

export const myPineIndicatorManifest: StrategyManifest = {
  name: 'MyPineIndicator',
};
```

### `src/plugins/myPineIndicator.plugin.ts`

```ts
import { defineStrategyPlugin } from '@tradejs/core/config';
import { myPineIndicatorManifest } from '../strategies/MyPineIndicator/manifest';
import { MyPineIndicatorStrategyCreator } from '../strategies/MyPineIndicator/strategy';

export default defineStrategyPlugin({
  strategyEntries: [
    {
      manifest: myPineIndicatorManifest,
      creator: MyPineIndicatorStrategyCreator,
    },
  ],
});
```

### `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['./src/plugins/myPineIndicator.plugin.ts'],
});
```

## 4. Validate in Backtest/Signals

```bash
npx @tradejs/cli backtest --user root --config MyPineIndicator:default
```

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

## 5. Common Pitfalls

- Plot name mismatch:
  config `MY_LINE_PLOTS` names must match Pine `plot(..., "name")`.
- Missing required runtime plots:
  your Pine script must expose `entryLong`, `entryShort`, `invalidated`.
- Flat/incorrect line:
  increase lookback (`MY_LOOKBACK_BARS`) and check Pine warmup.

For a full production-ready reference, see
[Pine Strategy Step by Step](../strategies/authoring/pine-strategy-step-by-step).
