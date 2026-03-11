---
title: Как добавить Pine Script индикаторы
---

В TradeJS есть два пути добавления индикаторов:

- TypeScript indicator plugins (рекомендуется для переиспользуемых pane-индикаторов)
- Pine `plot`-линии внутри самостоятельной Pine-стратегии (для strategy-native визуализации/сигналов)

Важно: отдельного Pine indicator plugin (`indicatorsPlugins`) пока нет.
Pine-индикаторы рендерятся из `plot(...)`, которые возвращает Pine-стратегия.

## 1. TypeScript-путь (отдельный pane-индикатор)

Используйте plugin-индикаторы, когда нужен переиспользуемый индикатор вне конкретной стратегии.

См. [Как писать свои индикаторы](./authoring).

## 2. Pine-путь индикаторов (внутри Pine-стратегии)

Для Pine-стратегий (пример: `AdaptiveMomentumRibbon`) линии индикаторов берутся из Pine `plot(...)` и конвертируются в `figures`.

Если вы просто расширяете существующую Pine-стратегию, обычно меняются только:

- `.pine` файл стратегии
- конфиг стратегии (`*_LINE_PLOTS`)

Пример (`AdaptiveMomentumRibbon`):

### `adaptiveMomentumRibbon.pine`

```pinescript
rsiValue = ta.rsi(close, 14)
plot(rsiValue, "rsi")
```

### конфиг стратегии

```json
{
  "AMR_LINE_PLOTS": [
    "kcMidline",
    "kcUpper",
    "kcLower",
    "invalidationLevel",
    "rsi"
  ]
}
```

Далее запуск:

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default
```

или:

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

Новая Pine-линия появится в `figures.lines`.

## 3. Полный набор файлов для кастомного Pine индикатора

Если нужен полностью кастомный пользовательский Pine-индикатор, создается собственный Pine strategy module.

Минимальный набор файлов:

```text
packages/core/src/strategy/MyPineIndicator/
  myPineIndicator.pine
  config.ts
  figures.ts
  core.ts
  strategy.ts
  manifest.ts
  index.ts
```

и одно изменение в реестре:

```text
packages/core/src/strategy/manifests.ts
```

### `myPineIndicator.pine`

```pinescript
//@version=5
indicator("My Pine Indicator", shorttitle="MPI", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
osc = fast - slow

entryLong = ta.crossover(osc, 0)
entryShort = ta.crossunder(osc, 0)
invalidated = false

plot(osc, "myOsc")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
plot(invalidated ? 1 : 0, "invalidated")
```

### `config.ts`

```ts
import { BacktestPriceMode, StrategyConfig } from '@types';

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15',
  BACKTEST_PRICE_MODE: 'mid' as BacktestPriceMode,
  MY_LOOKBACK_BARS: 400,
  MY_LINE_PLOTS: ['myOsc'],
  LONG: { enable: true, direction: 'LONG', TP: 2, SL: 1 },
  SHORT: { enable: true, direction: 'SHORT', TP: 2, SL: 1 },
} as const;

export type MyPineIndicatorConfig = StrategyConfig & typeof config;
```

### `figures.ts`

```ts
import {
  PineContextLike,
  asFiniteNumber,
  getPinePlotSeries,
} from '@utils/pine';
import { StrategyEntryModelFigures } from '@types';

export const buildMyPineFigures = (
  pineContext: PineContextLike,
): StrategyEntryModelFigures => {
  const points = getPinePlotSeries(pineContext, 'myOsc')
    .slice(-180)
    .map((item) => {
      const timestamp = asFiniteNumber(item?.time);
      const value = asFiniteNumber(item?.value);
      if (timestamp == null || value == null) return null;
      return { timestamp, value };
    })
    .filter(Boolean) as { timestamp: number; value: number }[];

  return {
    lines: [
      {
        id: 'my-osc-line',
        kind: 'my_osc',
        points,
        color: '#22d3ee',
        width: 2,
        style: 'solid',
      },
    ],
  };
};
```

### `core.ts`

```ts
import {
  asPineBoolean,
  getLatestPinePlotValue,
  runPineScript,
} from '@utils/pine';
import { CreateStrategyCore } from '@types';
import { MyPineIndicatorConfig } from './config';
import { buildMyPineFigures } from './figures';

export const createMyPineIndicatorCore: CreateStrategyCore<
  MyPineIndicatorConfig
> = async ({ config, symbol, loadPineScript, strategyApi }) => {
  const script = loadPineScript('myPineIndicator.pine');

  return async () => {
    if (!script) {
      return strategyApi.skip('PINE_SCRIPT_EMPTY');
    }

    const { fullData, currentPrice } = await strategyApi.getMarketData();
    const pineContext = await runPineScript({
      candles: fullData.slice(-Number(config.MY_LOOKBACK_BARS ?? 400)),
      script,
      symbol,
      timeframe: String(config.INTERVAL ?? '15'),
    });

    const entryLong = asPineBoolean(
      getLatestPinePlotValue(pineContext, 'entryLong'),
    );
    const entryShort = asPineBoolean(
      getLatestPinePlotValue(pineContext, 'entryShort'),
    );

    if (!entryLong && !entryShort) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const mode = entryLong ? config.LONG : config.SHORT;
    if (!mode.enable) {
      return strategyApi.skip('SIDE_DISABLED');
    }

    const { stopLossPrice, takeProfitPrice, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: mode.direction,
        takeProfitDelta: mode.TP,
        stopLossDelta: mode.SL,
        unit: 'percent',
      });

    if (!qty || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    return strategyApi.entry({
      code: 'MY_PINE_INDICATOR_ENTRY',
      direction: mode.direction,
      figures: buildMyPineFigures(pineContext),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

### `strategy.ts`

```ts
import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config, MyPineIndicatorConfig } from './config';
import { createMyPineIndicatorCore } from './core';

export const MyPineIndicatorStrategyCreator =
  createStrategyRuntime<MyPineIndicatorConfig>({
    strategyName: 'MyPineIndicator',
    defaults: config as MyPineIndicatorConfig,
    createCore: createMyPineIndicatorCore,
  });
```

### `manifest.ts`

```ts
import { StrategyManifest } from '@types';

export const myPineIndicatorManifest: StrategyManifest = {
  name: 'MyPineIndicator',
};
```

### `index.ts`

```ts
export { MyPineIndicatorStrategyCreator } from './strategy';
export { myPineIndicatorManifest } from './manifest';
```

### регистрация в `manifests.ts`

Добавьте в реестр стратегий (`packages/core/src/strategy/manifests.ts`):

```ts
import { myPineIndicatorManifest } from './MyPineIndicator/manifest';
```

```ts
{
  manifest: myPineIndicatorManifest,
  creator: createLazyStrategyCreator(
    () => import('./MyPineIndicator/strategy'),
    'MyPineIndicatorStrategyCreator',
  ),
},
```

## 4. Проверка в backtest/signals

```bash
npx @tradejs/cli backtest --user root --config MyPineIndicator:default
```

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

## 5. Частые проблемы

- Несовпадение имен plot:
  значения в `MY_LINE_PLOTS` должны совпадать с Pine `plot(..., "name")`.
- Нет обязательных runtime-серий:
  в Pine должны быть `entryLong`, `entryShort`, `invalidated`.
- “Плоская” или странная линия:
  увеличьте `MY_LOOKBACK_BARS` и проверьте warmup Pine.

Полный production reference см. в
[Pine Strategy Step by Step](../strategies/authoring/pine-strategy-step-by-step).
