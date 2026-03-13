---
sidebar_position: 7
title: Как создавать стратегии
---

Эта страница объясняет базовый контракт стратегии в TradeJS и показывает, где именно размещать логику.

TradeJS поддерживает два пути создания стратегий:

- [TypeScript-стратегия через `StrategyAPI`](./typescript-strategy-step-by-step)
- [Pine-стратегия с отдельным `.pine` исходником](./pine-strategy-step-by-step)

## Типовая структура стратегии

В пакете стратегии (built-in в `packages/strategies`, пользовательская в `src/strategies`) обычно есть:

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

- `@tradejs/node/strategies`
- `@tradejs/core/strategies`
- [Strategy Runtime Hooks](./strategy-hooks) (каталог lifecycle-хуков)

Правило импортов:

- импортируйте Node runtime wiring из `@tradejs/node/strategies`
- импортируйте pure strategy helper’ы из `@tradejs/core/strategies`
- импортируйте общие контракты из `@tradejs/types`
- избегайте внутренних алиасов (`@utils`, `@types`, `@constants`) и непубличных deep-imports

## Пример минимального `core.ts`

```ts
export const createMyStrategyCore: CreateStrategyCore<
  MyStrategyConfig
> = async ({ strategyApi }) => {
  return async () => {
    const positionExists = await strategyApi.isCurrentPositionExists();
    if (positionExists) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    const { currentPrice } = await strategyApi.getMarketData();

    const { stopLossPrice, takeProfitPrice } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: 'LONG',
        takeProfitDelta: 2,
        stopLossDelta: 1,
        unit: 'percent',
      });

    return strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

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

- [TypeScript Strategy Step by Step](./typescript-strategy-step-by-step) — полный путь для TypeScript-стратегии
- [Pine Strategy Step by Step](./pine-strategy-step-by-step) — полный путь для Pine-стратегии

## Внешняя стратегия как npm-плагин

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@scope/tradejs-strategy-pack'],
});
```

Пример плагина:

- публикуйте стратегию как npm-пакет и подключайте через `strategies`
