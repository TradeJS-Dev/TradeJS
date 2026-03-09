---
title: MaStrategy Пошагово
---

В этой статье полный путь: создать MA crossover-стратегию, зарегистрировать ее как плагин, добавить Redis-конфиги, запустить бэктесты и разобрать результаты.

## 1. Создаем файлы стратегии

Создайте папку:

- `src/strategies/MaStrategy`

Рекомендуемая структура:

- `config.ts`
- `core.ts`
- `figures.ts`
- `strategy.ts`
- `manifest.ts`
- `adapters/ai.ts`
- `adapters/ml.ts`
- `index.ts`

## 2. Добавляем конфиг (`config.ts`)

```ts
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/core';

export interface MaStrategySideConfig {
  enable: boolean;
  direction: Direction;
  TP: number;
  SL: number;
  minRiskRatio: number;
}

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  BACKTEST_PRICE_MODE: 'mid' as const,
  AI_ENABLED: false,
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 3,
  FEE_PERCENT: 0.005,
  MAX_LOSS_VALUE: 10,
  MAX_CORRELATION: 0.45,
  TRADE_COOLDOWN_MS: 0,
  MA_FAST: 21,
  MA_SLOW: 55,
  LONG: { enable: true, direction: 'LONG', TP: 2, SL: 1, minRiskRatio: 1.5 },
  SHORT: { enable: true, direction: 'SHORT', TP: 2, SL: 1, minRiskRatio: 1.5 },
} as const;

export type MaStrategyConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: MaStrategySideConfig;
    SHORT: MaStrategySideConfig;
  };
```

## 3. Добавляем builder фигур (`figures.ts`)

```ts
import {
  KlineChartData,
  StrategyEntryModelFigures,
  StrategyFigurePoint,
} from '@tradejs/core';

const toLinePoints = (
  candles: KlineChartData,
  values: number[],
  limit = 120,
): StrategyFigurePoint[] => {
  const points: StrategyFigurePoint[] = [];
  const seriesOffset = Math.max(0, candles.length - values.length);
  const start = Math.max(0, values.length - limit);

  for (let i = start; i < values.length; i += 1) {
    const candle = candles[seriesOffset + i];
    const value = values[i];
    if (!candle || !Number.isFinite(value)) continue;
    points.push({ timestamp: candle.timestamp, value });
  }

  return points;
};

export const buildMaStrategyFigures = ({
  fullData,
  maFast,
  maSlow,
  crossTimestamp,
  crossPrice,
  crossKind,
}: {
  fullData: KlineChartData;
  maFast: number[];
  maSlow: number[];
  crossTimestamp: number;
  crossPrice: number;
  crossKind: 'bullish' | 'bearish';
}): StrategyEntryModelFigures => ({
  // Две линии скользящих на графике.
  lines: [
    {
      id: 'ma-fast',
      kind: 'ma_fast',
      points: toLinePoints(fullData, maFast),
      color: '#22d3ee',
      width: 2,
      style: 'solid',
    },
    {
      id: 'ma-slow',
      kind: 'ma_slow',
      points: toLinePoints(fullData, maSlow),
      color: '#f59e0b',
      width: 2,
      style: 'solid',
    },
  ],
  // Точка пересечения.
  points: [
    {
      id: `ma-cross-${crossTimestamp}`,
      kind: 'ma_cross',
      points: [{ timestamp: crossTimestamp, value: crossPrice }],
      color: crossKind === 'bullish' ? '#22c55e' : '#ef4444',
      radius: 4,
    },
  ],
});
```

## 4. Добавляем core-логику (`core.ts`)

```ts
export const createMaStrategyCore: CreateStrategyCore<
  MaStrategyConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi, indicatorsState }) => {
  const {
    ENV,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    MAX_CORRELATION,
    TRADE_COOLDOWN_MS,
    LONG,
    SHORT,
  } = config;

  const lastTradeController = strategyApi.createLastTradeController({
    enabled: Number(TRADE_COOLDOWN_MS ?? 0) > 0,
    cooldownMs: Number(TRADE_COOLDOWN_MS ?? 0),
  });

  return async () => {
    indicatorsState.onBar();

    // 1) Читаем MA-серии из общего indicator state.
    const indicators = indicatorsState.snapshot();
    const maFast = Array.isArray(indicators?.maFast) ? indicators.maFast : [];
    const maSlow = Array.isArray(indicators?.maSlow) ? indicators.maSlow : [];
    if (maFast.length < 2 || maSlow.length < 2) {
      return strategyApi.skip('WAIT_MA_DATA');
    }

    // 2) Ищем пересечение по предыдущей и текущей точке.
    const maFastPrev = maFast[maFast.length - 2];
    const maFastCurrent = maFast[maFast.length - 1];
    const maSlowPrev = maSlow[maSlow.length - 2];
    const maSlowCurrent = maSlow[maSlow.length - 1];
    const bullish = maFastPrev <= maSlowPrev && maFastCurrent > maSlowCurrent;
    const bearish = maFastPrev >= maSlowPrev && maFastCurrent < maSlowCurrent;

    // 3) Если позиция уже открыта, закрываем на противоположном пересечении.
    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );
    if (positionExists && position) {
      if (
        (position.direction === 'LONG' && bearish) ||
        (position.direction === 'SHORT' && bullish)
      ) {
        const { currentPrice, timestamp } = await strategyApi.getMarketData();
        return {
          kind: 'exit',
          code: 'CLOSE_BY_OPPOSITE_MA_CROSS',
          closePlan: {
            price: currentPrice,
            timestamp,
            direction: position.direction,
          },
        };
      }
      return strategyApi.skip('POSITION_HELD');
    }

    if (!bullish && !bearish) {
      return strategyApi.skip('NO_CROSS');
    }

    const modeConfig = bullish ? LONG : SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { fullData, timestamp, currentPrice } =
      await strategyApi.getMarketData();
    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('TRADE_COOLDOWN');
    }

    // 4) Общий helper считает TP/SL, риск и qty.
    const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: modeConfig.direction,
        takeProfitDelta: modeConfig.TP,
        stopLossDelta: modeConfig.SL,
        unit: 'percent',
        maxLossValue: MAX_LOSS_VALUE,
        feePercent: Number(FEE_PERCENT ?? 0),
      });

    if (!qty || !Number.isFinite(qty) || qty <= 0)
      return strategyApi.skip('INVALID_QTY');
    if (riskRatio <= modeConfig.minRiskRatio)
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);

    const correlation = indicatorsState.latestNumber('correlation');
    if (
      ENV !== 'BACKTEST' &&
      correlation != null &&
      correlation >= MAX_CORRELATION
    ) {
      return strategyApi.skip(`MAX_CORRELATION:${round(correlation)}`);
    }

    lastTradeController.markTrade(timestamp);

    // 5) Возвращаем entry-решение, дальше AI/ML и policy делает runtime.
    return strategyApi.entry({
      code: bullish ? 'MA_BULLISH_CROSS' : 'MA_BEARISH_CROSS',
      direction: modeConfig.direction,
      timestamp,
      prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
      figures: buildMaStrategyFigures({
        fullData,
        maFast,
        maSlow,
        crossTimestamp: timestamp,
        crossPrice: currentPrice,
        crossKind: bullish ? 'bullish' : 'bearish',
      }),
      indicators,
      additionalIndicators: {
        crossKind: bullish ? 'bullish' : 'bearish',
        maFastPrev,
        maFastCurrent,
        maSlowPrev,
        maSlowCurrent,
      },
      orderPlan: {
        qty,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
```

## 5. Подключаем runtime и manifest

`strategy.ts`:

```ts
export const MaStrategyCreator = createStrategyRuntime<MaStrategyConfig>({
  strategyName: 'MaStrategy',
  defaults: DEFAULT_CONFIG as MaStrategyConfig,
  createCore: createMaStrategyCore,
});
```

`manifest.ts`:

```ts
export const maStrategyManifest: StrategyManifest = {
  name: 'MaStrategy',
  aiAdapter: maStrategyAiAdapter,
  mlAdapter: maStrategyMlAdapter,
};
```

Регистрируем в вашем strategy plugin package:

```ts
import { defineStrategyPlugin } from '@tradejs/core';
import { maStrategyManifest } from './MaStrategy/manifest';
import { MaStrategyCreator } from './MaStrategy/strategy';

export default defineStrategyPlugin({
  strategyEntries: [
    {
      manifest: maStrategyManifest,
      creator: MaStrategyCreator,
    },
  ],
});
```

## 6. Добавляем Redis-конфиги (обязательно)

TradeJS читает runtime и backtest-конфиги из Redis.

Runtime config:

```bash
redis-cli JSON.SET users:root:strategies:MaStrategy:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "MA_FAST": 21,
  "MA_SLOW": 55,
  "LONG": {"enable": true, "direction": "LONG", "TP": 2, "SL": 1, "minRiskRatio": 1.5},
  "SHORT": {"enable": true, "direction": "SHORT", "TP": 2, "SL": 1, "minRiskRatio": 1.5},
  "FEE_PERCENT": 0.005,
  "MAX_LOSS_VALUE": 10,
  "MAX_CORRELATION": 0.45,
  "TRADE_COOLDOWN_MS": 0,
  "AI_ENABLED": false,
  "ML_ENABLED": false,
  "ML_THRESHOLD": 0.1,
  "MIN_AI_QUALITY": 3
}'
```

Backtest grid config:

```bash
redis-cli JSON.SET users:root:backtests:configs:MaStrategy:quickstart '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "MA_FAST": [14, 21],
  "MA_SLOW": [50, 55],
  "LONG": [{"enable": true, "direction": "LONG", "TP": 2, "SL": 1, "minRiskRatio": 1.5}],
  "SHORT": [{"enable": true, "direction": "SHORT", "TP": 2, "SL": 1, "minRiskRatio": 1.5}],
  "FEE_PERCENT": [0.005],
  "MAX_LOSS_VALUE": [10],
  "MAX_CORRELATION": [0.45],
  "TRADE_COOLDOWN_MS": [0],
  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

Важно: имя backtest-конфига должно начинаться со стратегии (`MaStrategy:*`), потому что CLI берет `strategyName` из `--config`.

## 7. Запускаем бэктесты

```bash
npx @tradejs/cli backtest --user root --config MaStrategy:quickstart --connector bybit --tests 300 --parallel 4
```

## 8. Разбираем результаты бэктеста

Для быстрого разбора используйте `results`:

```bash
npx @tradejs/cli results --strategy MaStrategy --coverage --user root
npx @tradejs/cli results --strategy MaStrategy --merge --user root
```

Если в вашем deployment есть TradeJS UI, те же результаты можно посмотреть и там (ордера, график, метрики).

## 9. Как выводить `figures`

`figures` формируются в `strategyApi.entry(...)` внутри `core.ts`, после чего chart UI рисует их как overlay.

Если стратегия возвращает `lines` / `points` / `zones`, они появляются на графике.

## 10. Какие метрики бэктеста считаются

Метрики считает backtest engine, а смотреть их можно в выводе `results` (и в UI-карточках, если UI есть в вашем deployment).

Основные метрики:

- `periodDays`, `periodMonths`, `orders`, `ordersPerMonth`, `exposure`
- `amount`, `netProfit`, `totalReturn`, `cagr`
- `maxDrawdown`, `calmar`, `sharpeRatio`
- `winRate`, `riskRewardRatio`, `expectancy`
- `maxConsecutiveWins`, `maxConsecutiveLosses`

Где смотреть:

- `npx @tradejs/cli results --strategy MaStrategy --coverage --user root`
- карточка результата бэктеста в TradeJS UI (если доступен в вашем deployment)
