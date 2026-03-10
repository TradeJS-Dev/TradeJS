---
title: Хуки runtime стратегий
---

В manifest стратегии можно задавать lifecycle-хуки, чтобы расширять runtime без усложнения `core.ts`.

## Source of Truth

- Контракты хуков и типы контекстов: `packages/core/src/types/strategyAdapters.ts`
- Порядок выполнения и stage-имена в runtime: `packages/core/src/utils/strategyRuntime.ts`
- Shared helper-хуки: `packages/core/src/utils/strategyHooks.ts`

## Полная типизация (`StrategyManifest['hooks']`)

```ts
type StrategyManifestHooks = {
  onInit?: (params: StrategyHookInitContext) => Promise<void> | void;
  afterCoreDecision?: (
    params: StrategyHookAfterDecisionContext,
  ) => Promise<void> | void;
  onSkip?: (params: StrategyHookSkipContext) => Promise<void> | void;
  beforeClosePosition?: (
    params: StrategyHookBeforeCloseContext,
  ) => Promise<StrategyHookGateResult | void> | StrategyHookGateResult | void;
  afterEnrichMl?: (params: StrategyHookEnrichContext) => Promise<void> | void;
  afterEnrichAi?: (params: StrategyHookAfterAiContext) => Promise<void> | void;
  beforeEntryGate?: (
    params: StrategyHookBeforeEntryGateContext,
  ) => Promise<StrategyHookGateResult | void> | StrategyHookGateResult | void;
  beforePlaceOrder?: (
    params: StrategyHookBeforePlaceOrderContext,
  ) => Promise<void> | void;
  afterPlaceOrder?: (
    params: StrategyHookAfterPlaceOrderContext,
  ) => Promise<void> | void;
  onRuntimeError?: (params: StrategyHookErrorContext) => Promise<void> | void;
};
```

## Каталог хуков

| Хук                   | Тип параметров                        | Тип возврата                                                                | Stage в runtime       | Может блокировать       |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------- | --------------------- | ----------------------- |
| `onInit`              | `StrategyHookInitContext`             | `void \| Promise<void>`                                                     | `onInit`              | Нет                     |
| `afterCoreDecision`   | `StrategyHookAfterDecisionContext`    | `void \| Promise<void>`                                                     | `afterCoreDecision`   | Нет                     |
| `onSkip`              | `StrategyHookSkipContext`             | `void \| Promise<void>`                                                     | `onSkip`              | Нет                     |
| `beforeClosePosition` | `StrategyHookBeforeCloseContext`      | `StrategyHookGateResult \| void \| Promise<StrategyHookGateResult \| void>` | `beforeClosePosition` | Да (`{ allow: false }`) |
| `afterEnrichMl`       | `StrategyHookEnrichContext`           | `void \| Promise<void>`                                                     | `afterEnrichMl`       | Нет                     |
| `afterEnrichAi`       | `StrategyHookAfterAiContext`          | `void \| Promise<void>`                                                     | `afterEnrichAi`       | Нет                     |
| `beforeEntryGate`     | `StrategyHookBeforeEntryGateContext`  | `StrategyHookGateResult \| void \| Promise<StrategyHookGateResult \| void>` | `beforeEntryGate`     | Да (`{ allow: false }`) |
| `beforePlaceOrder`    | `StrategyHookBeforePlaceOrderContext` | `void \| Promise<void>`                                                     | `beforePlaceOrder`    | Нет                     |
| `afterPlaceOrder`     | `StrategyHookAfterPlaceOrderContext`  | `void \| Promise<void>`                                                     | `afterPlaceOrder`     | Нет                     |
| `onRuntimeError`      | `StrategyHookErrorContext`            | `void \| Promise<void>`                                                     | `onRuntimeError`      | Нет                     |

## Типы контекстов

### Базовый контекст

| Тип                       | Поля                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `StrategyHookBaseContext` | `connector`, `strategyName`, `userName`, `symbol`, `config`, `env`, `isConfigFromBacktest` |

### Расширения контекста для хуков

| Тип                                   | Наследует                          | Дополнительные поля                                                                      |
| ------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `StrategyHookInitContext`             | `StrategyHookBaseContext`          | `data`, `btcData`                                                                        |
| `StrategyHookAfterDecisionContext`    | `StrategyHookBaseContext`          | `decision`, `candle`, `btcCandle`                                                        |
| `StrategyHookSkipContext`             | `StrategyHookAfterDecisionContext` | `decision` сужен до `Extract<StrategyDecision, { kind: 'skip' }>`                        |
| `StrategyHookBeforeCloseContext`      | `StrategyHookBaseContext`          | `decision` сужен до `Extract<StrategyDecision, { kind: 'exit' }>`                        |
| `StrategyHookEnrichContext`           | `StrategyHookBaseContext`          | `decision` сужен до `Extract<StrategyDecision, { kind: 'entry' }>`, `runtime`, `signal?` |
| `StrategyHookAfterAiContext`          | `StrategyHookEnrichContext`        | `quality?`                                                                               |
| `StrategyHookBeforeEntryGateContext`  | `StrategyHookAfterAiContext`       | `makeOrdersEnabled`, `minAiQuality`                                                      |
| `StrategyHookBeforePlaceOrderContext` | `StrategyHookBaseContext`          | `entryContext`, `runtime`, `decision` сужен до entry, `signal?`                          |
| `StrategyHookAfterPlaceOrderContext`  | `StrategyHookEnrichContext`        | `orderResult`                                                                            |
| `StrategyHookErrorContext`            | `StrategyHookBaseContext`          | `stage`, `error`, `decision?`, `signal?`                                                 |
| `StrategyHookGateResult`              | -                                  | `{ allow?: boolean; reason?: string }`                                                   |

## Порядок выполнения в runtime (entry/exit)

| Порядок | Хук                   | Комментарий                                           |
| ------- | --------------------- | ----------------------------------------------------- |
| 1       | `onInit`              | Вызывается один раз при создании runtime              |
| 2       | `afterCoreDecision`   | Вызывается для каждого решения из `core.ts`           |
| 3       | `onSkip`              | Только для `skip`                                     |
| 4       | `beforeClosePosition` | Только в exit path, перед `connector.closePosition`   |
| 5       | `afterEnrichMl`       | Только в entry path, после ML-enrichment              |
| 6       | `afterEnrichAi`       | Только в entry path, после AI-enrichment              |
| 7       | `beforeEntryGate`     | Только в entry path, после стандартной runtime-policy |
| 8       | `beforePlaceOrder`    | Только в entry path, прямо перед постановкой ордера   |
| 9       | `afterPlaceOrder`     | Только в entry path, после успешной постановки ордера |
| \*      | `onRuntimeError`      | Вызывается при перехваченных runtime-ошибках          |

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

## Reusable helper-хук

Built-in helper, который используется в `TrendLine` и `VolumeDivergence`:

- `createCloseOppositeBeforePlaceOrderHook`
- source: `packages/core/src/utils/strategyHooks.ts`

## Примечания

- Ошибки в хуках по умолчанию не валят runtime: runtime их перехватывает, логирует и передает в `onRuntimeError`.
- Gate-хуки только два: `beforeClosePosition` и `beforeEntryGate`; блокируют flow через `{ allow: false }`.
- `beforeClosePosition` влияет только на фактическое закрытие позиции (`MAKE_ORDERS=true`).
