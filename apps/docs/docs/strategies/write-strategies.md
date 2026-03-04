---
sidebar_position: 7
title: Writing Strategies
---

This page explains how strategy runtime is organized in TradeJS with real code from `TrendLine`.

TradeJS supports two strategy authoring paths:

- TypeScript strategy with `StrategyAPI` (`strategies/ma-strategy-step-by-step`)
- Pine strategy with dedicated `.pine` source (`strategies/pine-strategy-step-by-step`, `AdaptiveMomentumRibbon` example)

## Typical Strategy Layout

Each strategy in `packages/core/src/strategy/<Strategy>` usually has:

- `config.ts`
- `core.ts`
- `figures.ts` (if you draw custom lines/points/zones)
- `strategy.ts`
- `manifest.ts`
- `adapters/ai.ts` (optional)
- `adapters/ml.ts` (optional)
- `hooks.ts` (optional)

## Runtime Contract

`core.ts` returns one of three decisions:

- `skip`
- `entry`
- `exit`

Shared runtime handles signal enrichment and order execution:

- `packages/core/src/utils/strategyRuntime.ts`

## Real Example: TrendLine `core.ts` Flow

The snippet below follows the real `TrendLine` flow. It is shortened only for constants/imports, but all control branches are preserved.

```ts
return async (candle) => {
  // 1) Build candidate trendlines for the current bar
  const lowsTrendlines = getLowsTrendlines.next(candle);
  const highsTrendlines = getHighsTrendlines.next(candle);

  indicatorsState.onBar();

  // 2) Pick the best line (prefer lows)
  const bestLine =
    lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];
  if (!bestLine) {
    return strategyApi.skip('NO_TRENDLINE');
  }

  // 3) Hard guards before entry
  const positionExists = await strategyApi.isCurrentPositionExists();
  if (positionExists) {
    return strategyApi.skip('POSITION_EXISTS');
  }

  if (lastTradeController.isInCooldown(candle.timestamp)) {
    return strategyApi.skip('DEV_TRADE_COOLDOWN');
  }

  const { fullData, timestamp, currentPrice } =
    await strategyApi.getMarketData();
  if (!filterByVeryVolatility(fullData)) {
    return strategyApi.skip('VERY_VOLATILITY');
  }

  // 4) Resolve mode config from line direction
  const modeConfig = bestLine.mode === 'highs' ? HIGHS : LOWS;
  const { direction, TP, SL, minRiskRatio, enable } = modeConfig;
  if (!enable) {
    return strategyApi.skip('STRATEGY_DISABLED');
  }

  // 5) Compute TP/SL, risk ratio and qty in one shared helper
  const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
    strategyApi.getDirectionalTpSlPrices({
      price: currentPrice,
      direction,
      takeProfitDelta: TP,
      stopLossDelta: SL,
      unit: 'percent',
      maxLossValue: MAX_LOSS_VALUE,
      feePercent: Number(FEE_PERCENT ?? 0),
    });

  if (!qty || !Number.isFinite(qty) || qty <= 0) {
    return strategyApi.skip('INVALID_QTY');
  }
  if (riskRatio <= minRiskRatio) {
    return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
  }

  const correlation = indicatorsState.latestNumber('correlation');
  if (
    ENV !== 'BACKTEST' &&
    correlation != null &&
    correlation >= MAX_CORRELATION
  ) {
    return strategyApi.skip(`MAX_CORRELATION:${round(correlation)}`);
  }

  lastTradeController.markTrade(timestamp);

  // 6) Return structured entry decision; runtime does AI/ML and order execution
  return strategyApi.entry({
    figures: {
      ...buildTrendLineFigures(bestLine),
    },
    direction,
    timestamp,
    prices: {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio,
    },
    indicators: indicatorsState.snapshot(),
    additionalIndicators: {
      touches: bestLine.touches.length + 2,
      distance: bestLine.distance,
      trendLine: bestLine,
    },
    orderPlan: {
      qty,
      takeProfits: [{ rate: 1, price: takeProfitPrice }],
    },
  });
};
```

## Real Example: TrendLine Manifest and Hook

```ts
export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  hooks: {
    beforePlaceOrder: trendLineBeforePlaceOrderHook,
  },
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
```

And the hook:

```ts
export const trendLineBeforePlaceOrderHook = async ({
  connector,
  entryContext,
  config,
}) => {
  const trendLineConfig = config as TrendLineConfig;
  if (!trendLineConfig.CLOSE_OPPOSITE_POSITIONS) {
    return;
  }

  await closeOppositePositionsBeforeOpen({ connector, entryContext });
};
```

## Real Example: AI/ML Runtime Policy Mapping

```ts
// AI adapter
mapEntryRuntimeFromConfig: (config) =>
  mapAiRuntimeFromConfig(config as Pick<TrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>),

// ML adapter
mapEntryRuntimeFromConfig: (config) =>
  mapMlRuntimeFromConfig(config as TrendLineMlRuntimeConfig, {
    strategyConfig: toTrendLineMlStrategyConfig(config as TrendLineMlRuntimeConfig),
  }),
```

## Full Step-by-Step Example (New)

If you want a full tutorial with all files, Redis keys, backtest flow, figures, and UI checks:

- `strategies/ma-strategy-step-by-step`
- `strategies/pine-strategy-step-by-step`

## External Plugin Strategy

You can publish a strategy as npm package and connect it through `tradejs.config.ts`:

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  strategyPlugins: ['@scope/tradejs-strategy-pack'],
});
```

Reference plugin example:

- `examples/sandbox`
