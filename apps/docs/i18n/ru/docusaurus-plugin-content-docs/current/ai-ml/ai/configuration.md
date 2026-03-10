---
sidebar_position: 11
title: 'AI: как работает и настраивается'
---

AI в TradeJS — это runtime-слой дополнительной проверки сигнала перед исполнением ордера.

## Базовый модуль

- `@tradejs/core`

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

## Пример TrendLine adapter

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

## Как подменить промпт для своей стратегии

Используйте `aiAdapter` в manifest вашей стратегии.
Runtime сохраняет базовый prompt и добавляет ваши add-on блоки.

```ts
import type { StrategyAiAdapter } from '@tradejs/core/types';

export const myStrategyAiAdapter: StrategyAiAdapter = {
  buildSystemPromptAddon: ({ signal }) => `
Дополнительные правила для ${signal.strategy}:
- Делай акцент на подтверждении пробоя + согласовании с объемом.
- Если подтверждения по объему нет, снижай quality до <= 3.
`,
  buildHumanPromptAddon: ({ signal }) => `
Дополнительный контекст:
- riskRatio=${signal.prices.riskRatio}
- symbol=${signal.symbol}
`,
};
```

Затем подключите adapter в manifest:

```ts
import type { StrategyManifest } from '@tradejs/core/types';
import { myStrategyAiAdapter } from './adapters/ai';

export const myStrategyManifest: StrategyManifest = {
  name: 'MyStrategy',
  aiAdapter: myStrategyAiAdapter,
};
```

Важно:

- это публичный способ кастомизировать поведение prompt для конкретной стратегии
- базовый runtime-prompt все равно применяется; ваши add-on просто дописываются в system/human prompt

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
