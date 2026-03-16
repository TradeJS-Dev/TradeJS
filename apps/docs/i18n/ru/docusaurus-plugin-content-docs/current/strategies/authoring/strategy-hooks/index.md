---
title: Lifecycle-хуки стратегий
---

В этом разделе описан контракт lifecycle-хуков, который использует shared runtime стратегии.

## Порядок вызова

1. [onInit](./on-init) — один раз при создании runtime
2. [afterCoreDecision](./after-core-decision) — на каждой свече
3. [onSkip](./on-skip) — только для `skip`
4. [beforeClosePosition](./before-close-position) — gate, может заблокировать закрытие
5. [afterEnrichMl](./after-enrich-ml) — только когда есть `decision.signal`
6. [afterEnrichAi](./after-enrich-ai) — только когда есть `decision.signal`
7. [beforeEntryGate](./before-entry-gate) — gate, может заблокировать вход
8. [beforePlaceOrder](./before-place-order) — прямо перед вызовом коннектора
9. [afterPlaceOrder](./after-place-order) — после успешной постановки ордера
10. [onRuntimeError](./on-runtime-error) — на любой runtime/hook error

## Канонический shape params

Теперь каждый хук получает stage-specific подмножество одного и того же вложенного объекта:

```ts
{
  ctx?: StrategyHookCtx;
  market?: StrategyHookMarketContext;
  decision?: StrategyDecision;
  entry?: StrategyHookEntryContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
  policy?: StrategyHookPolicyContext;
  order?: StrategyHookOrderContext;
  error?: StrategyHookErrorPayload;
}
```

## Общие вложенные объекты

`ctx`:

```ts
{
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  strategyConfig: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}
```

`market`:

```ts
{
  candle?: KlineChartItem;
  btcCandle?: KlineChartItem;
  data?: KlineChartItem[];
  btcData?: KlineChartItem[];
}
```

`entry`:

```ts
{
  context: StrategyEntrySignalContext;
  orderPlan: StrategyEntryOrderPlan;
  signal?: Signal;
  runtime: {
    raw?: StrategyEntryRuntimeOptions;
    resolved: StrategyEntryRuntimeOptions;
  };
}
```

`ml`:

```ts
{
  config?: StrategyRuntimeMlOptions;
  attempted: boolean;
  applied: boolean;
  result?: Signal['ml'];
  skippedReason?:
    | 'BACKTEST'
    | 'DISABLED'
    | 'NO_RUNTIME'
    | 'NO_STRATEGY_CONFIG'
    | 'NO_THRESHOLD'
    | 'NO_RESULT';
}
```

`ai`:

```ts
{
  config?: StrategyRuntimeAiOptions;
  attempted: boolean;
  applied: boolean;
  quality?: number;
  skippedReason?: 'BACKTEST' | 'DISABLED' | 'NO_RUNTIME' | 'NO_QUALITY';
}
```

`policy`:

```ts
{
  aiQuality?: number;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}
```

`order`:

```ts
{
  result: Signal | string;
}
```

`error`:

```ts
{
  stage: StrategyHookStage;
  cause: unknown;
}
```

Gate-хуки возвращают такой shape, если хотят заблокировать исполнение:

```ts
{
  allow?: boolean;
  reason?: string;
}
```

## Важные замечания

- `entry.runtime.raw` — это raw runtime, который вернул `core.ts` через `strategyApi.entry(...)`.
- `entry.runtime.resolved` — это runtime, который реально использует shared runtime после merge manifest defaults, adapter config и raw decision runtime.
- `afterEnrichMl` описывает именно ML stage, а не только успешный ML. Смотри `ml.attempted`, `ml.applied` и `ml.skippedReason`.
- `afterEnrichAi` использует тот же паттерн через объект `ai`.
- Ошибки non-blocking хуков проглатываются: runtime логирует их, вызывает `onRuntimeError` и продолжает выполнение.
- Ошибки в gate-хуках (`beforeClosePosition`, `beforeEntryGate`) тоже проглатываются; runtime ведет себя так, будто хук вернул `undefined`.
