---
title: Хуки runtime стратегий
---

В manifest стратегии можно задавать lifecycle-хуки, чтобы расширять runtime без усложнения `core.ts`.

Контракт хуков:

- `@tradejs/core`

Выполнение хуков в runtime:

- `@tradejs/core`

## Доступные хуки

### Инициализация и decision flow

- `onInit`

  - вызывается один раз при создании runtime стратегии
  - подходит для warmup-проверок и setup

- `afterCoreDecision`

  - вызывается после возврата `skip|entry|exit` из `core.ts`
  - подходит для диагностики и телеметрии

- `onSkip`
  - вызывается для `skip` решений
  - удобно для аналитики skip-кодов

### Хук для выхода

- `beforeClosePosition`
  - вызывается до `connector.closePosition`
  - может вернуть `{ allow: false, reason?: string }`, чтобы заблокировать close

### Enrich и entry-gate

- `afterEnrichMl`

  - вызывается после ML-enrichment сигнала

- `afterEnrichAi`

  - вызывается после AI-enrichment сигнала
  - получает `quality`

- `beforeEntryGate`
  - вызывается перед исполнением ордера после стандартных runtime-проверок
  - может вернуть `{ allow: false, reason?: string }`, чтобы заблокировать entry

### Хуки исполнения ордеров

- `beforePlaceOrder`

  - вызывается непосредственно перед постановкой ордера
  - существующий хук сохранен, но с расширенным контекстом

- `afterPlaceOrder`
  - вызывается после успешного исполнения ордера
  - получает `orderResult`

### Хук ошибок

- `onRuntimeError`
  - единая точка обработки runtime-ошибок (ошибки хуков, enrich, order/close)
  - получает `stage`, `error`, optional `decision/signal`

## Пример manifest

```ts
import { StrategyManifest } from '@tradejs/core';

export const myStrategyManifest: StrategyManifest = {
  name: 'MyStrategy',
  hooks: {
    onInit: async ({ strategyName, symbol }) => {
      console.log('init', strategyName, symbol);
    },
    beforeEntryGate: async ({ signal }) => {
      if (!signal) return;
      return { allow: true };
    },
    onRuntimeError: async ({ stage, error }) => {
      console.error('runtime hook error', stage, error);
    },
  },
};
```

## Reusable hook helpers

Для устранения дублирования можно использовать shared helper-хуки.

Текущий helper:

- `createCloseOppositeBeforePlaceOrderHook`
  - файл: `@tradejs/core`
  - используется в `TrendLine` и `VolumeDivergence`

## Примечания

- Ошибки в хуках по умолчанию не валят runtime: они логируются и прокидываются в `onRuntimeError`.
- `beforeEntryGate` вызывается только если базовая runtime-policy уже разрешила исполнение.
- `beforeClosePosition` вызывается только когда close разрешен (`MAKE_ORDERS=true`).
