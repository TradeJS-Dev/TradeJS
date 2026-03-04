---
sidebar_position: 7
title: Creating Strategies
---

This page explains the core strategy contract in TradeJS and where to place strategy logic.

TradeJS supports two strategy creation paths:

- TypeScript strategy with `StrategyAPI` (`strategies/authoring/ma-strategy-step-by-step`)
- Pine strategy with a dedicated `.pine` source (`strategies/authoring/pine-strategy-step-by-step`)

## Typical Strategy Layout

Each strategy in `packages/core/src/strategy/<Strategy>` usually has:

- `config.ts`
- `core.ts`
- `figures.ts` (if strategy draws custom lines/points/zones)
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

Shared runtime handles:

- signal enrichment (AI/ML)
- policy gates
- order execution
- lifecycle hooks

Files:

- `packages/core/src/utils/strategyRuntime.ts`
- `runtime/execution/strategy-hooks` (full lifecycle hooks catalog)

## Minimal `core.ts` Example

```ts
export const createMyStrategyCore: CreateStrategyCore<
  MyStrategyConfig
> = async ({ strategyApi }) => {
  return async () => {
    const { currentPrice, timestamp } = await strategyApi.getMarketData();

    const positionExists = await strategyApi.isCurrentPositionExists();
    if (positionExists) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: 'LONG',
        takeProfitDelta: 2,
        stopLossDelta: 1,
        unit: 'percent',
      });

    if (!qty || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    return strategyApi.entry({
      direction: 'LONG',
      timestamp,
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio,
      },
      orderPlan: {
        qty,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

## Where Runtime Behavior Is Defined

- `manifest.ts`:

  - `entryRuntimeDefaults`
  - `hooks`
  - `aiAdapter`
  - `mlAdapter`

- `adapters/*`:

  - runtime policy mapping from config (`mapEntryRuntimeFromConfig`)
  - AI/ML payload normalization

## Step-by-Step Guides

- `strategies/authoring/ma-strategy-step-by-step` — full TypeScript strategy walkthrough
- `strategies/authoring/pine-strategy-step-by-step` — full Pine strategy walkthrough

## External Strategy as an npm Plugin

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  strategyPlugins: ['@scope/tradejs-strategy-pack'],
});
```

Plugin example:

- `examples/sandbox`
