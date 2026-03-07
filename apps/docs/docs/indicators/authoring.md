---
title: Write Custom Indicators
---

This guide shows how to add your own indicator and render it in the TradeJS chart.

TradeJS supports two indicator paths:

- TypeScript indicator plugins (this page)
- Pine `plot` indicators inside Pine strategies (`indicators/pine`)

## 1. Create an Indicator Plugin Package

TradeJS loads indicator plugins through `tradejs.config.ts`.

In your plugin package, export `indicatorEntries`:

```ts
import type { IndicatorPluginEntry } from '@tradejs/framework';
import { defineIndicatorPlugin } from '@tradejs/framework';

export const indicatorEntries = defineIndicatorPlugin({
  indicatorEntries: [
    {
      indicator: {
        id: 'sandboxMomentum',
        label: 'Sandbox Momentum',
        enabled: false,
      },
      historyKey: 'sandboxMomentum',
      compute: ({ data }) => {
        const last = data[data.length - 1];
        const prev = data[data.length - 2];
        if (!last || !prev || prev.close === 0) {
          return null;
        }
        return ((last.close - prev.close) / prev.close) * 100;
      },
      renderer: {
        shortName: 'SBX MOM',
        minHeight: 120,
        figures: [
          {
            key: 'sandboxMomentum',
            title: 'Sandbox Momentum: ',
            type: 'line',
            color: '#f59e0b',
          },
          {
            key: 'sandboxMomentumZero',
            title: 'Zero: ',
            type: 'line',
            color: '#94a3b8',
            dashed: true,
            constant: 0,
          },
        ],
      },
    } satisfies IndicatorPluginEntry,
  ],
}).indicatorEntries;
```

Real reference in this repo:

- `examples/sandbox/src/index.ts`

## 2. Connect Plugin in `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  indicatorsPlugins: ['@your-scope/tradejs-indicators-pack'],
});
```

## 3. Start the App

```bash
yarn dev
```

The plugin registry is loaded by core strategy/indicator manifests.  
When app requests chart data, plugin indicator values become part of indicator history.

## 4. Show Indicator in Chart UI

Define `renderer` inside `indicatorEntries`; the UI pipeline then wires it automatically:

1. `GET /api/indicators` returns `renderers` (`apps/app/src/app/api/indicators/route.ts`).
2. Store keeps them in `indicatorRenderers` (`apps/app/src/app/store/indicators.ts`).
3. `usePluginIndicators` registers indicator runtime in chart and draws figures (`apps/app/src/app/components/Dashboard/KlineChart/hooks/usePluginIndicators.ts`).

Minimal working setup:

```ts
{
  historyKey: 'sandboxMomentum',
  compute: ({ data }) => {
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    if (!last || !prev || prev.close === 0) return null;
    return ((last.close - prev.close) / prev.close) * 100;
  },
  renderer: {
    shortName: 'SBX MOM',
    paneId: 'sandbox_momentum_pane',
    minHeight: 120,
    figures: [
      { key: 'sandboxMomentum', type: 'line', color: '#f59e0b' },
      { key: 'sandboxMomentumZero', type: 'line', constant: 0, dashed: true },
    ],
  },
}
```

- `renderer.figures[].key` must match keys present in candles (usually your `historyKey`).
- Use `constant` for horizontal levels so no extra compute output is needed.
- Then just enable the indicator in UI (Indicators); pane and lines are created automatically.

## 5. Debug Checklist

- Indicator does not appear:
  verify plugin package is listed in `indicatorsPlugins`.
- Values are empty:
  check `compute` returns finite numbers and handles warmup bars.
- Draw looks wrong:
  validate `renderer.figures[].key` matches produced history keys.
