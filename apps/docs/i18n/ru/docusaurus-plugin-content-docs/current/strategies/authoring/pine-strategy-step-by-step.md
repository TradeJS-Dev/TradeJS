---
title: Pine Script стратегия пошагово
---

Этот гайд показывает, как добавить Pine-стратегию в TradeJS как обычный полноценный модуль стратегии.

Ниже приведена полная реализация `AdaptiveMomentumRibbon` (включая `.pine`, runtime-мост, config, figures, adapters и регистрацию).

Если нужен путь без Pine, см. [TypeScript-стратегия через `StrategyAPI`](./typescript-strategy-step-by-step).

## 1. Создайте структуру папки стратегии

Создайте обычный модуль стратегии:

```text
packages/strategies/src/AdaptiveMomentumRibbon/
  adaptiveMomentumRibbon.pine
  config.ts
  core.ts
  figures.ts
  strategy.ts
  manifest.ts
  index.ts
  adapters/
    ai.ts
    ml.ts
```

## 2. Добавьте Pine-скрипт (`adaptiveMomentumRibbon.pine`)

```pine
// © ZakAlgoTrade
//@version=5
indicator("Adaptive Momentum Ribbon", shorttitle="AMR", overlay=true)

length = input.int(20, "Momentum Period", minval=2)
smoothLength = input.int(3, "Butterworth Smoothing", minval=1)
waitClose = input.bool(true, "Confirm Signals on Bar Close")

disp_lvl = input.bool(true, "Show Invalidation Levels")
disp_ch = input.bool(true, "Show Keltner Channel")

lengthkc = input.int(20, "KC Length", minval=1)
kcMaType = input.string(
    "EMA",
    "KC MA Type",
    options=["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"]
)
atrLen = input.int(14, "ATR Length", minval=1)
mult_kc = input.float(2.0, "ATR Multiplier", minval=0.1, maxval=10.0, step=0.1)

f_butterworth(float source, int len) =>
    var float prev1 = na
    var float prev2 = na
    float pi_val = 3.14159265359
    float safe_len = math.max(len, 1)
    float a = math.exp(-math.sqrt(2.0) * pi_val / safe_len)
    float b = 2.0 * a * math.cos(math.sqrt(2.0) * pi_val / safe_len)
    float c2 = b
    float c3 = -a * a
    float c1 = 1.0 - c2 - c3
    float result = na
    if na(prev1) or na(prev2)
        prev1 := source
        prev2 := source
        result := source
    else
        result := c1 * source + c2 * nz(prev1) + c3 * nz(prev2)
    prev2 := prev1
    prev1 := result
    result

ma(float source, int _length, string _type) =>
    _type == "SMA" ? ta.sma(source, _length) :
     _type == "EMA" ? ta.ema(source, _length) :
     _type == "SMMA (RMA)" ? ta.rma(source, _length) :
     _type == "WMA" ? ta.wma(source, _length) :
     ta.vwma(source, _length)

float conf_src = waitClose ? close[1] : close
median_val = ta.percentile_nearest_rank(conf_src, length, 50)
deviation = conf_src - median_val
med_dev = ta.percentile_nearest_rank(math.abs(deviation), length, 50)
mad_scale = med_dev == 0 ? ta.stdev(conf_src, length) : med_dev * 1.4826
raw_osc = mad_scale != 0 ? deviation / mad_scale : 0.0
signal_osc = f_butterworth(raw_osc, smoothLength)

buy_sig = ta.crossover(signal_osc, 0)
sell_sig = ta.crossunder(signal_osc, 0)

var float level_price = na
var bool active_buy = false
var bool active_sell = false

if buy_sig
    level_price := waitClose ? low[1] : low
    active_buy := true
    active_sell := false

if sell_sig
    level_price := waitClose ? high[1] : high
    active_sell := true
    active_buy := false

float check_low = waitClose ? low[1] : low
float check_high = waitClose ? high[1] : high
bool invalidated = false

if active_buy and not na(level_price)
    if check_low < level_price
        invalidated := true

if active_sell and not na(level_price)
    if check_high > level_price
        invalidated := true

if invalidated
    active_buy := false
    active_sell := false

float midline = ma(close, lengthkc, kcMaType)
float atr_val = ta.atr(atrLen)
float upper_kc = midline + mult_kc * atr_val
float lower_kc = midline - mult_kc * atr_val

plot(signal_osc, "signalOsc")
plot(disp_ch ? midline : na, "kcMidline")
plot(disp_ch ? upper_kc : na, "kcUpper")
plot(disp_ch ? lower_kc : na, "kcLower")
plot(disp_lvl ? level_price : na, "invalidationLevel")
plot(active_buy ? 1 : 0, "activeBuy")
plot(active_sell ? 1 : 0, "activeSell")
plot(invalidated ? 1 : 0, "invalidated")
plot(buy_sig ? 1 : 0, "entryLong")
plot(sell_sig ? 1 : 0, "entryShort")
```

## 3. Добавьте конфиг стратегии (`config.ts`)

```ts
import {
  type BacktestPriceMode,
  type Direction,
  type Interval,
  type StrategyConfig,
} from '@tradejs/types';
import { asPositiveInt, asPositiveNumber } from '@tradejs/core/math';

export type AdaptiveMomentumRibbonKcMaType =
  | 'SMA'
  | 'EMA'
  | 'SMMA (RMA)'
  | 'WMA'
  | 'VWMA';

export interface AdaptiveMomentumRibbonSideConfig {
  enable: boolean;
  direction: Direction;
  TP: number;
  SL: number;
}

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'mid' as const,
  AI_ENABLED: false,
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 3,
  AMR_LOOKBACK_BARS: 400,
  AMR_MOMENTUM_PERIOD: 20,
  AMR_BUTTERWORTH_SMOOTHING: 3,
  AMR_WAIT_CLOSE: true,
  AMR_SHOW_INVALIDATION_LEVELS: true,
  AMR_SHOW_KELTNER_CHANNEL: true,
  AMR_KC_LENGTH: 20,
  AMR_KC_MA_TYPE: 'EMA' as AdaptiveMomentumRibbonKcMaType,
  AMR_ATR_LENGTH: 14,
  AMR_ATR_MULTIPLIER: 2,
  AMR_EXIT_ON_INVALIDATION: true,
  AMR_LINE_PLOTS: ['kcMidline', 'kcUpper', 'kcLower', 'invalidationLevel'],
  LONG: {
    enable: true,
    direction: 'LONG',
    TP: 2,
    SL: 1,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    TP: 2,
    SL: 1,
  },
} as const;

export type AdaptiveMomentumRibbonConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT' | 'AMR_LINE_PLOTS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    AMR_LINE_PLOTS: readonly string[];
    LONG: AdaptiveMomentumRibbonSideConfig;
    SHORT: AdaptiveMomentumRibbonSideConfig;
  };
```

## 4. Добавьте построитель figures (`figures.ts`)

```ts
import {
  PineContextLike,
  asFiniteNumber,
  getPinePlotSeries,
} from '@tradejs/core/pine';
import {
  type Direction,
  type StrategyEntryModelFigures,
  type StrategyFigureLine,
  type StrategyFigurePoint,
} from '@tradejs/types';

interface BuildAdaptiveMomentumRibbonFiguresParams {
  pineContext: PineContextLike;
  linePlots: string[];
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  maxPoints?: number;
}

type LineStyleDescriptor = Pick<
  StrategyFigureLine,
  'color' | 'width' | 'style'
>;

const DEFAULT_COLORS = ['#2962ff', '#f23645', '#089981', '#f59e0b'] as const;

const LINE_STYLE_BY_PLOT: Record<string, LineStyleDescriptor> = {
  kcMidline: {
    color: '#2962ff',
    width: 2,
    style: 'solid',
  },
  kcUpper: {
    color: '#f23645',
    width: 2,
    style: 'solid',
  },
  kcLower: {
    color: '#089981',
    width: 2,
    style: 'solid',
  },
  invalidationLevel: {
    color: '#f59e0b',
    width: 1,
    style: 'dashed',
  },
};

const toFigurePoints = (
  series: ReturnType<typeof getPinePlotSeries>,
  maxPoints: number,
): StrategyFigurePoint[] => {
  const start = Math.max(0, series.length - maxPoints);
  const points: StrategyFigurePoint[] = [];

  for (let i = start; i < series.length; i += 1) {
    const item = series[i];
    const timestamp = asFiniteNumber(item?.time);
    const value = asFiniteNumber(item?.value);
    if (timestamp == null || value == null) continue;
    points.push({
      timestamp,
      value,
    });
  }

  return points;
};

export const buildAdaptiveMomentumRibbonFigures = ({
  pineContext,
  linePlots,
  direction,
  entryTimestamp,
  entryPrice,
  maxPoints = 180,
}: BuildAdaptiveMomentumRibbonFiguresParams): StrategyEntryModelFigures => {
  const lines = linePlots
    .map((plotName, index) => {
      const series = getPinePlotSeries(pineContext, plotName);
      const points = toFigurePoints(series, maxPoints);
      if (!points.length) {
        return null;
      }

      const fallbackStyle: LineStyleDescriptor = {
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        width: 2,
        style: 'solid',
      };

      const style = LINE_STYLE_BY_PLOT[plotName] || fallbackStyle;

      return {
        id: `amr-line-${plotName}`,
        kind: 'amr_plot_line',
        points,
        ...style,
      } as StrategyFigureLine;
    })
    .filter(Boolean) as NonNullable<StrategyEntryModelFigures['lines']>;

  return {
    lines,
    points: [
      {
        id: `amr-entry-${entryTimestamp}`,
        kind: 'amr_entry',
        points: [{ timestamp: entryTimestamp, value: entryPrice }],
        color: direction === 'LONG' ? '#22c55e' : '#ef4444',
        radius: 4,
      },
    ],
  };
};
```

## 5. Добавьте runtime-мост (`core.ts`)

```ts
import {
  PineContextLike,
  asPineBoolean,
  asFiniteNumber,
  getLatestPinePlotValue,
  runPineScript,
} from '@tradejs/core/pine';
import type { CreateStrategyCore } from '@tradejs/types';
import { AdaptiveMomentumRibbonConfig } from './config';
import { buildAdaptiveMomentumRibbonFigures } from './figures';

const AMR_PINE_FILE_NAME = 'adaptiveMomentumRibbon.pine';

const asPositiveInt = (value: unknown, fallback: number): number => {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const asPositiveNumber = (value: unknown, fallback: number): number => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const asKcMaType = (
  value: unknown,
): AdaptiveMomentumRibbonConfig['AMR_KC_MA_TYPE'] => {
  if (
    value === 'SMA' ||
    value === 'EMA' ||
    value === 'SMMA (RMA)' ||
    value === 'WMA' ||
    value === 'VWMA'
  ) {
    return value;
  }

  return 'EMA';
};

const resolveAmrInputs = (
  config: AdaptiveMomentumRibbonConfig,
): Record<string, unknown> => ({
  'Momentum Period': asPositiveInt(config.AMR_MOMENTUM_PERIOD, 20),
  'Butterworth Smoothing': asPositiveInt(config.AMR_BUTTERWORTH_SMOOTHING, 3),
  'Confirm Signals on Bar Close': Boolean(config.AMR_WAIT_CLOSE),
  'Show Invalidation Levels': Boolean(config.AMR_SHOW_INVALIDATION_LEVELS),
  'Show Keltner Channel': Boolean(config.AMR_SHOW_KELTNER_CHANNEL),
  'KC Length': asPositiveInt(config.AMR_KC_LENGTH, 20),
  'KC MA Type': asKcMaType(config.AMR_KC_MA_TYPE),
  'ATR Length': asPositiveInt(config.AMR_ATR_LENGTH, 14),
  'ATR Multiplier': asPositiveNumber(config.AMR_ATR_MULTIPLIER, 2),
});

const resolveLinePlots = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
};

const getLookbackCandles = <TCandle>(
  candles: TCandle[],
  lookbackBars: number,
) => {
  if (lookbackBars <= 0) {
    return candles;
  }

  return candles.slice(-lookbackBars);
};

const readBooleanPlot = (
  pineContext: PineContextLike,
  plotName: string,
): boolean => asPineBoolean(getLatestPinePlotValue(pineContext, plotName));

const readNumericPlot = (
  pineContext: PineContextLike,
  plotName: string,
): number | null =>
  asFiniteNumber(getLatestPinePlotValue(pineContext, plotName)) ?? null;

const readAmrSnapshot = (pineContext: PineContextLike, linePlots: string[]) => {
  const lineValues = Object.fromEntries(
    linePlots.map((plotName) => [
      plotName,
      readNumericPlot(pineContext, plotName),
    ]),
  );

  return {
    entryLong: readBooleanPlot(pineContext, 'entryLong'),
    entryShort: readBooleanPlot(pineContext, 'entryShort'),
    invalidated: readBooleanPlot(pineContext, 'invalidated'),
    activeBuy: readBooleanPlot(pineContext, 'activeBuy'),
    activeSell: readBooleanPlot(pineContext, 'activeSell'),
    signalOsc: readNumericPlot(pineContext, 'signalOsc'),
    kcMidline: readNumericPlot(pineContext, 'kcMidline'),
    kcUpper: readNumericPlot(pineContext, 'kcUpper'),
    kcLower: readNumericPlot(pineContext, 'kcLower'),
    invalidationLevel: readNumericPlot(pineContext, 'invalidationLevel'),
    lineValues,
  };
};

export const createAdaptiveMomentumRibbonCore: CreateStrategyCore<
  AdaptiveMomentumRibbonConfig
> = async ({ config, symbol, loadPineScript, strategyApi }) => {
  const script = loadPineScript(AMR_PINE_FILE_NAME);
  const { LONG, SHORT, AMR_EXIT_ON_INVALIDATION } = config;
  const linePlots = resolveLinePlots(config.AMR_LINE_PLOTS);
  const lookbackBars = asPositiveInt(config.AMR_LOOKBACK_BARS, 0);
  const pineInputs = resolveAmrInputs(config);
  const timeframe = String(config.INTERVAL ?? '15');

  return async () => {
    if (!script) {
      return strategyApi.skip('AMR_SCRIPT_EMPTY');
    }

    const { fullData, currentPrice, timestamp } =
      await strategyApi.getMarketData();
    if (fullData.length < 2) {
      return strategyApi.skip('WAIT_DATA');
    }

    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );

    const candles = getLookbackCandles(fullData, lookbackBars);

    let pineContext;
    try {
      pineContext = await runPineScript({
        candles,
        script,
        symbol,
        timeframe,
        inputs: pineInputs,
      });
    } catch (error) {
      if (typeof globalThis.setImmediate === 'function') {
        console.warn(
          'AdaptiveMomentumRibbon pine run failed for %s: %s',
          symbol,
          String(error),
        );
      }
      return strategyApi.skip('AMR_SCRIPT_FAILED');
    }

    const amr = readAmrSnapshot(pineContext, linePlots);

    if (amr.entryLong && amr.entryShort) {
      return strategyApi.skip('AMR_SIGNAL_CONFLICT');
    }

    if (positionExists && position) {
      if (
        (position.direction === 'LONG' && amr.entryShort) ||
        (position.direction === 'SHORT' && amr.entryLong)
      ) {
        return {
          kind: 'exit',
          code: 'CLOSE_BY_AMR_SIGNAL',
          closePlan: {
            price: currentPrice,
            timestamp,
            direction: position.direction,
          },
        };
      }

      if (Boolean(AMR_EXIT_ON_INVALIDATION) && amr.invalidated) {
        return {
          kind: 'exit',
          code: 'CLOSE_BY_AMR_INVALIDATION',
          closePlan: {
            price: currentPrice,
            timestamp,
            direction: position.direction,
          },
        };
      }

      return strategyApi.skip('POSITION_HELD');
    }

    if (!amr.entryLong && !amr.entryShort) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const modeConfig = amr.entryLong ? LONG : SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { stopLossPrice, takeProfitPrice } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: modeConfig.direction,
        takeProfitDelta: modeConfig.TP,
        stopLossDelta: modeConfig.SL,
        unit: 'percent',
      });

    return strategyApi.entry({
      direction: modeConfig.direction,
      figures: buildAdaptiveMomentumRibbonFigures({
        pineContext,
        linePlots,
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      additionalIndicators: {
        amr,
      },
      orderPlan: {
        qty: 1,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

## 6. Добавьте runtime entrypoint стратегии (`strategy.ts`)

```ts
import { createStrategyRuntime } from '@tradejs/core/strategies';
import {
  AdaptiveMomentumRibbonConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createAdaptiveMomentumRibbonCore } from './core';

export const AdaptiveMomentumRibbonStrategyCreator =
  createStrategyRuntime<AdaptiveMomentumRibbonConfig>({
    strategyName: 'AdaptiveMomentumRibbon',
    defaults: DEFAULT_CONFIG as AdaptiveMomentumRibbonConfig,
    createCore: createAdaptiveMomentumRibbonCore,
  });
```

## 7. Добавьте adapters + manifest + публичные экспорты

### `adapters/ai.ts`

```ts
import type { StrategyAiAdapter } from '@tradejs/types';
import { AdaptiveMomentumRibbonConfig } from '../config';

export const adaptiveMomentumRibbonAiAdapter: StrategyAiAdapter = {
  mapEntryRuntimeFromConfig: (config) => {
    const typedConfig = config as Pick<
      AdaptiveMomentumRibbonConfig,
      'AI_ENABLED' | 'MIN_AI_QUALITY'
    >;

    return {
      enabled: Boolean(typedConfig.AI_ENABLED),
      minQuality: Number(typedConfig.MIN_AI_QUALITY ?? 4),
    };
  },
};
```

### `adapters/ml.ts`

```ts
import type { StrategyMlAdapter } from '@tradejs/types';
import { AdaptiveMomentumRibbonConfig } from '../config';

export const adaptiveMomentumRibbonMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) => {
    const typedConfig = config as Pick<
      AdaptiveMomentumRibbonConfig,
      'ML_ENABLED' | 'ML_THRESHOLD'
    >;

    return {
      enabled: Boolean(typedConfig.ML_ENABLED),
      mlThreshold: Number(typedConfig.ML_THRESHOLD ?? 0.1),
      strategyConfig: config,
    };
  },
};
```

### `manifest.ts`

```ts
import type { StrategyManifest } from '@tradejs/types';
import { adaptiveMomentumRibbonAiAdapter } from './adapters/ai';
import { adaptiveMomentumRibbonMlAdapter } from './adapters/ml';

export const adaptiveMomentumRibbonManifest: StrategyManifest = {
  name: 'AdaptiveMomentumRibbon',
  aiAdapter: adaptiveMomentumRibbonAiAdapter,
  mlAdapter: adaptiveMomentumRibbonMlAdapter,
};
```

### `index.ts`

```ts
export { AdaptiveMomentumRibbonStrategyCreator } from './strategy';
export { adaptiveMomentumRibbonManifest } from './manifest';
```

## 8. Регистрируйте через plugin + `tradejs.config.ts`

Создайте plugin entry (например, в `packages/strategies/src/index.ts`):

```ts
import { defineStrategyPlugin } from '@tradejs/core/config';
import { adaptiveMomentumRibbonManifest } from './AdaptiveMomentumRibbon/manifest';
import { AdaptiveMomentumRibbonStrategyCreator } from './AdaptiveMomentumRibbon/strategy';

export const strategyEntries = [
  {
    manifest: adaptiveMomentumRibbonManifest,
    creator: AdaptiveMomentumRibbonStrategyCreator,
  },
];

export default defineStrategyPlugin({ strategyEntries });
```

Далее подключите этот plugin в корневом `tradejs.config.ts`:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['./src/plugins/adaptiveMomentumRibbon.plugin.ts'],
});
```

После этого `AdaptiveMomentumRibbon` доступна runtime/backtest как обычная plugin-стратегия.

## 9. Runtime config в Redis

```bash
redis-cli JSON.SET users:root:strategies:AdaptiveMomentumRibbon:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "AMR_MOMENTUM_PERIOD": 20,
  "AMR_BUTTERWORTH_SMOOTHING": 3,
  "AMR_WAIT_CLOSE": true,
  "AMR_SHOW_INVALIDATION_LEVELS": true,
  "AMR_SHOW_KELTNER_CHANNEL": true,
  "AMR_KC_LENGTH": 20,
  "AMR_KC_MA_TYPE": "EMA",
  "AMR_ATR_LENGTH": 14,
  "AMR_ATR_MULTIPLIER": 2,
  "AMR_EXIT_ON_INVALIDATION": true,
  "AMR_LOOKBACK_BARS": 400,
  "AMR_LINE_PLOTS": ["kcMidline", "kcUpper", "kcLower", "invalidationLevel"],
  "LONG": {"enable": true, "direction": "LONG", "TP": 2, "SL": 1},
  "SHORT": {"enable": true, "direction": "SHORT", "TP": 2, "SL": 1},
  "AI_ENABLED": false,
  "ML_ENABLED": false,
  "ML_THRESHOLD": 0.1,
  "MIN_AI_QUALITY": 3
}'
```

## 10. Backtest grid config

```bash
redis-cli JSON.SET users:root:backtests:configs:AdaptiveMomentumRibbon:amr-default '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "AMR_MOMENTUM_PERIOD": [20],
  "AMR_BUTTERWORTH_SMOOTHING": [3],
  "AMR_WAIT_CLOSE": [true],
  "AMR_SHOW_INVALIDATION_LEVELS": [true],
  "AMR_SHOW_KELTNER_CHANNEL": [true],
  "AMR_KC_LENGTH": [20],
  "AMR_KC_MA_TYPE": ["EMA"],
  "AMR_ATR_LENGTH": [14],
  "AMR_ATR_MULTIPLIER": [2],
  "AMR_EXIT_ON_INVALIDATION": [true],
  "AMR_LOOKBACK_BARS": [400],
  "AMR_LINE_PLOTS": [["kcMidline", "kcUpper", "kcLower", "invalidationLevel"]],
  "LONG": [{"enable": true, "direction": "LONG", "TP": 2, "SL": 1}],
  "SHORT": [{"enable": true, "direction": "SHORT", "TP": 2, "SL": 1}],
  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

Важно: имя backtest-конфига должно начинаться со стратегии (`AdaptiveMomentumRibbon:*`).

## 11. Запуск и проверка

Бэктест:

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --tests 200 --parallel 4
```

Сигналы:

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

В UI (`/routes/backtest`) проверьте:

- события входа/выхода AMR
- Pine-figures (`kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`)
