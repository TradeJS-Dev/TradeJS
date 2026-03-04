---
sidebar_position: 11
title: AI Runtime and Configuration
---

## Purpose

AI in TradeJS is a runtime review layer. It evaluates the current strategy signal and can gate order execution in live mode.

Core module:

- `packages/core/src/utils/ai.ts`

## Required Environment

```env
OPENAI_API_KEY=...
OPENAI_API_ENDPOINT=https://api.openai.com/v1
```

## Runtime Behavior

For `entry` decisions with signal:

1. Runtime builds AI payload.
2. AI analysis is written to Redis (`analysis:<symbol>:<signalId>`).
3. In non-backtest mode, order may be blocked if quality is below threshold.

Default minimum quality: `4`.

## Real TrendLine Adapter Example

TrendLine extends shared payload with untrimmed trendline geometry:

```ts
export const trendLineAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    figures: {
      ...basePayload.figures,
      trendline: signal.figures?.trendLine ?? null,
    },
  }),
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<TrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
```

## Real Runtime Gate Logic Pattern

```ts
const minAiQuality = runtime.ai?.minQuality ?? 4;
const shouldMakeOrder =
  makeOrdersEnabled &&
  (!signal || env === 'BACKTEST' || quality == null || quality >= minAiQuality);
```

If gate blocks order, signal is still returned with skip reason.

## AI + ML Together

AI and ML are independent runtime layers merged by strategy runtime policy:

- ML enriches signal metadata/probabilities.
- AI evaluates setup quality and can block execution.
