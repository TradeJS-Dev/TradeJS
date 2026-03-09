---
title: MaStrategy Step by Step
---

This tutorial shows the full flow: create a new MA crossover strategy, register it as a plugin, configure Redis keys, run backtests, and inspect results.

## 1. Create Strategy Files

Create a new folder:

- `src/strategies/MaStrategy`

Recommended structure:

- `config.ts`
- `core.ts`
- `figures.ts`
- `strategy.ts`
- `manifest.ts`
- `adapters/ai.ts`
- `adapters/ml.ts`
- `index.ts`

## 2. Add Config (`config.ts`)

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

## 3. Add Figure Builder (`figures.ts`)

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
  // Two MA lines on chart.
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
  // Cross marker.
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

## 4. Add Core Logic (`core.ts`)

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

    // 1) Read MA series from shared indicator state.
    const indicators = indicatorsState.snapshot();
    const maFast = Array.isArray(indicators?.maFast) ? indicators.maFast : [];
    const maSlow = Array.isArray(indicators?.maSlow) ? indicators.maSlow : [];
    if (maFast.length < 2 || maSlow.length < 2) {
      return strategyApi.skip('WAIT_MA_DATA');
    }

    // 2) Detect cross using previous and current MA points.
    const maFastPrev = maFast[maFast.length - 2];
    const maFastCurrent = maFast[maFast.length - 1];
    const maSlowPrev = maSlow[maSlow.length - 2];
    const maSlowCurrent = maSlow[maSlow.length - 1];
    const bullish = maFastPrev <= maSlowPrev && maFastCurrent > maSlowCurrent;
    const bearish = maFastPrev >= maSlowPrev && maFastCurrent < maSlowCurrent;

    // 3) If position exists, close it on opposite cross.
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

    // 4) Shared helper computes TP/SL, risk ratio, and qty.
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

    // 5) Return entry decision; runtime handles AI/ML enrichment and execution policy.
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

## 5. Wire Runtime and Manifest

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

Register in your strategy plugin package:

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

## 6. Add Redis Configs (Required)

TradeJS reads runtime and backtest configs from Redis.

Set runtime config:

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

Set backtest grid config:

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

Important: backtest key name must start with strategy name (`MaStrategy:*`), because CLI derives strategy from `--config`.

## 7. Run Backtests

```bash
npx @tradejs/cli backtest --user root --config MaStrategy:quickstart --connector bybit --tests 300 --parallel 4
```

## 8. Inspect Backtest Results

Use `results` commands for a quick review:

```bash
npx @tradejs/cli results --strategy MaStrategy --coverage --user root
npx @tradejs/cli results --strategy MaStrategy --merge --user root
```

If your deployment has TradeJS UI, you can also inspect the same run there (orders, chart, metrics).

## 9. How to Show `figures`

Attach `figures` in `strategyApi.entry(...)` from `core.ts`, and chart UIs render them as overlays.

If strategy entry returns `lines` / `points` / `zones`, they appear on the chart.

## 10. Which Backtest Metrics Are Collected

Metrics are produced by the backtest engine and available in `results` output (and UI cards, if your deployment includes UI).

Main metrics:

- `periodDays`, `periodMonths`, `orders`, `ordersPerMonth`, `exposure`
- `amount`, `netProfit`, `totalReturn`, `cagr`
- `maxDrawdown`, `calmar`, `sharpeRatio`
- `winRate`, `riskRewardRatio`, `expectancy`
- `maxConsecutiveWins`, `maxConsecutiveLosses`

Where to see them:

- `npx @tradejs/cli results --strategy MaStrategy --coverage --user root`
- backtest result card in TradeJS UI (if available in your deployment)
