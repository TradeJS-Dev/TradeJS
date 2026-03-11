---
sidebar_position: 7
title: Как создавать стратегии
---

Эта страница объясняет базовый контракт стратегии в TradeJS и показывает, где именно размещать логику.

TradeJS поддерживает два пути создания стратегий:

- [TypeScript-стратегия через `StrategyAPI`](./ma-strategy-step-by-step)
- [Pine-стратегия с отдельным `.pine` исходником](./pine-strategy-step-by-step)

## Типовая структура стратегии

Внутри `@tradejs/core` обычно есть:

- `config.ts`
- `core.ts`
- `figures.ts` (если стратегия рисует свои линии/точки/зоны)
- `strategy.ts`
- `manifest.ts`
- `adapters/ai.ts` (опционально)
- `adapters/ml.ts` (опционально)
- `hooks.ts` (опционально)

## Контракт runtime

`core.ts` возвращает один из трех вариантов:

- `skip`
- `entry`
- `exit`

Общий runtime выполняет:

- enrichment сигнала (AI/ML)
- policy-гейты
- исполнение ордера
- lifecycle-хуки

Файлы:

- `@tradejs/core`
- [Strategy Hooks](./strategy-hooks) (каталог lifecycle-хуков)

## Пример минимального `core.ts`

```ts
export const createMyStrategyCore: CreateStrategyCore<
  MyStrategyConfig
> = async ({ strategyApi }) => {
  return async () => {
    const { currentPrice } = await strategyApi.getMarketData();

    const positionExists = await strategyApi.isCurrentPositionExists();
    if (positionExists) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    const { stopLossPrice, takeProfitPrice, qty } =
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
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

`strategyApi.entry(...)` принимает опциональный `code`; если его не передать, код будет сгенерирован автоматически, а `timestamp/currentPrice/takeProfitPrice/riskRatio` вычисляются из market data и `orderPlan`.

## Где задается runtime-поведение

- `manifest.ts`:

  - `entryRuntimeDefaults`
  - `hooks`
  - `aiAdapter`
  - `mlAdapter`

- `adapters/*`:

  - mapping policy из конфига (`mapEntryRuntimeFromConfig`)
  - нормализация payload для AI/ML

## Пошаговые руководства

- [MA Strategy Step by Step](./ma-strategy-step-by-step) — полный путь для TypeScript-стратегии
- [Pine Strategy Step by Step](./pine-strategy-step-by-step) — полный путь для Pine-стратегии

## Внешняя стратегия как npm-плагин

```ts
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: ['@scope/tradejs-strategy-pack'],
});
```

Пример плагина:

- публикуйте стратегию как npm-пакет и подключайте через `strategyPlugins`
