---
sidebar_position: 11
title: AI Runtime and Configuration
---

## Purpose

AI in TradeJS is a runtime review layer. It evaluates the current strategy signal and can gate order execution in live mode.

Core module:

- `@tradejs/core`

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

## How to Override Prompt for Your Strategy

Use strategy `aiAdapter` in your strategy plugin manifest.
Runtime keeps the base prompt and appends your add-ons.

```ts
import type { StrategyAiAdapter } from '@tradejs/core/types';

export const myStrategyAiAdapter: StrategyAiAdapter = {
  buildSystemPromptAddon: ({ signal }) => `
Additional rules for ${signal.strategy}:
- Focus on breakout confirmation + volume agreement.
- If volume confirmation is missing, reduce quality to <= 3.
`,
  buildHumanPromptAddon: ({ signal }) => `
Extra context:
- riskRatio=${signal.prices.riskRatio}
- symbol=${signal.symbol}
`,
};
```

Then reference it in strategy manifest:

```ts
import type { StrategyManifest } from '@tradejs/core/types';
import { myStrategyAiAdapter } from './adapters/ai';

export const myStrategyManifest: StrategyManifest = {
  name: 'MyStrategy',
  aiAdapter: myStrategyAiAdapter,
};
```

Notes:

- this is the public way to customize prompt behavior per strategy
- base runtime prompt is still applied; your add-ons are appended to system/human prompts

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
