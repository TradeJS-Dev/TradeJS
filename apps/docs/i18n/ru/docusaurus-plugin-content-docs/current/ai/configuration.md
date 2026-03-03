---
sidebar_position: 11
title: 'AI: как работает и настраивается'
---

AI в TradeJS — это runtime-слой дополнительной проверки сигнала перед исполнением ордера.

## Базовый модуль

- `packages/core/src/utils/ai.ts`

## Что нужно в окружении

```env
OPENAI_API_KEY=...
OPENAI_API_ENDPOINT=https://api.openai.com/v1
```

## Поведение runtime

Для `entry` с сигналом:

1. Runtime строит AI payload.
2. Сохраняет анализ в Redis (`analysis:<symbol>:<signalId>`).
3. В non-backtest режиме может заблокировать ордер по quality threshold.

Порог по умолчанию: `4`.

## Реальный пример TrendLine adapter

TrendLine расширяет общий payload полем `trendline` без trim:

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

## Реальный паттерн gate-логики

```ts
const minAiQuality = runtime.ai?.minQuality ?? 4;
const shouldMakeOrder =
  makeOrdersEnabled &&
  (!signal || env === 'BACKTEST' || quality == null || quality >= minAiQuality);
```

Если gate не пройден, сигнал сохраняется, но ордер не отправляется.

## AI + ML в одном runtime

- ML добавляет вероятности/метаданные.
- AI оценивает качество сетапа и может заблокировать исполнение.
