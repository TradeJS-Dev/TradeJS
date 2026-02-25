# Strategy API

Актуально для текущей архитектуры framework (shared runtime + strategy manifests/adapters).

## Цель

Этот документ фиксирует API/контракты для написания новых стратегий:
- что делает `core.ts`
- что делает `strategyRuntime`
- где живут AI/ML/hook расширения
- какой shape у `StrategyDecision`

## Структура стратегии

Минимальный набор файлов для стратегии:

- `src/strategy/<Strategy>/config.ts`
- `src/strategy/<Strategy>/core.ts`
- `src/strategy/<Strategy>/strategy.ts`
- `src/strategy/<Strategy>/manifest.ts`
- `src/strategy/<Strategy>/adapters/ai.ts` (optional)
- `src/strategy/<Strategy>/adapters/ml.ts` (optional)
- `src/strategy/<Strategy>/hooks.ts` (optional)

## Роли слоев

### `core.ts`

Стратегия должна:
- читать `config`, `data`, `btcData`, `connector`
- считать условия входа/выхода
- возвращать `StrategyDecision`

В `core.ts` допустимо:
- собирать `signal` через `buildEntrySignalDecision(...)`
- формировать `entryContext`, `figures`, `indicators`, `additionalIndicators`, `orderPlan`

В `core.ts` не нужно:
- вызывать `askAI`
- вызывать ML gRPC
- исполнять ордера (`placeOrder` / `closePosition`) напрямую

### `strategy.ts`

Тонкая обертка, которая подключает стратегию к shared runtime:
- `createStrategyRuntime(...)`
- `defaults`
- `createCore`

### `manifest.ts`

Manifest стратегии подключает strategy-local расширения:
- `name`
- `entryRuntimeDefaults` (опциональные дефолты runtime policy)
- `hooks.beforePlaceOrder` (опционально)
- `aiAdapter`
- `mlAdapter`

### `src/utils/strategyRuntime.ts`

Shared runtime:
- резолвит config
- вызывает `core`
- обогащает `signal` через ML/AI
- применяет runtime policy (из manifest/adapters + decision overrides)
- исполняет ордера
- возвращает внешний контракт (`string | Signal`)

## `StrategyDecision`

Внутренний контракт стратегии (упрощенно):

- `skip`
- `entry`
- `exit`

### `skip`

Возвращается, когда сигнала нет или стратегия пропускает бар.

Пример:

```ts
return { kind: 'skip', code: 'NO_SIGNAL' };
```

### `entry`

Основной формат для открытия позиции.

Ключевые части:
- `entryContext` — source of truth для runtime
- `orderPlan` — только execution-specific данные
- `signal` — обычно собирается через `buildEntrySignalDecision(...)`
- `runtime` — optional overrides (редкие кейсы; обычно policy идет из adapters/manifests)

`entryContext` содержит:
- `strategy`
- `symbol`
- `interval`
- `direction`
- `timestamp`
- `prices`
- `configFromBacktest`

`orderPlan` содержит:
- `qty`
- `takeProfits`

### `exit`

Для закрытия позиции:

```ts
return {
  kind: 'exit',
  code: 'CLOSE_POSITION_BY_RULE',
  closePlan: { price, timestamp, direction },
};
```

## `buildEntrySignalDecision(...)`

Shared helper для сборки `entry` решения и `signal`.

Используется прямо в `core.ts`.

Что передаем:
- `code`
- `entryContext`
- `figures`
- `indicators`
- `additionalIndicators`
- `orderPlan`
- `runtime` (optional)

Что он делает:
- создает `signal`
- возвращает `StrategyDecision` вида `kind: 'entry'`

## Runtime policy: AI/ML

### Где задавать AI/ML policy

Предпочтительно:
- в strategy adapters (`mapEntryRuntimeFromConfig`)
- в manifest defaults (`entryRuntimeDefaults`)

Допустимо (редкие случаи):
- в `decision.runtime` как override

### Merge-порядок в shared runtime

Shared runtime собирает policy так:

1. `manifest.entryRuntimeDefaults`
2. `manifest.aiAdapter/mlAdapter.mapEntryRuntimeFromConfig(config)`
3. `decision.runtime` (если стратегия явно переопределила)

Это позволяет:
- держать дефолты/маппинг рядом со стратегией
- не дублировать `AI_ENABLED`, `ML_ENABLED`, `MIN_AI_QUALITY`, `ML_THRESHOLD` в `core.ts`

## AI/ML adapters

### `aiAdapter`

Используется для:
- `buildPayload` (payload override)
- `buildSystemPromptAddon`
- `buildHumanPromptAddon`
- `mapEntryRuntimeFromConfig(config)` (runtime AI policy)

### `mlAdapter`

Используется для:
- `normalizeSignal`
- `normalizeStrategyConfig`
- `mapEntryRuntimeFromConfig(config)` (runtime ML policy)

## Hooks

### `beforePlaceOrder`

Strategy-level pre-order поведение задается через manifest hook:

- `manifest.hooks.beforePlaceOrder({ connector, entryContext, config, runtime })`

Пример use-case:
- `closeOppositePositionsBeforeOpen(...)`

Важно:
- `decision.runtime.beforePlaceOrder` оставлен как дополнительная расширяемая точка для будущих стратегий/нестандартных кейсов.

## Рекомендации для новых стратегий

1. Сначала собрать `entryContext` в `core.ts`
2. Явно разделять:
   - `indicators` (общие/base/runtime indicators)
   - `additionalIndicators` (strategy-specific)
3. Возвращать `buildEntrySignalDecision(...)`, а не руками собирать `signal`
4. AI/ML policy уносить в adapters/manifests, а не в `core.ts`
5. Держать `core.ts` сфокусированным на условиях стратегии

## Смежные файлы

- `src/types/strategy.ts` — основные типы (`StrategyDecision`, `entryContext`, `orderPlan`)
- `src/types/strategyAdapters.ts` — контракты adapters/manifests
- `src/utils/strategyRuntime.ts` — shared runtime pipeline
- `src/utils/strategyHelpers/signalBuilders.ts` — `buildEntrySignalDecision(...)`
