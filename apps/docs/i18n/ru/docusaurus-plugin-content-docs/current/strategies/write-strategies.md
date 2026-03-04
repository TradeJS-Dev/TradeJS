---
sidebar_position: 7
title: Как писать стратегии
---

Здесь показано, как устроен runtime стратегий в TradeJS, на реальном примере `TrendLine`.

В TradeJS есть два пути написания стратегий:

- TypeScript-стратегия через `StrategyAPI` (`strategies/ma-strategy-step-by-step`)
- Pine-стратегия с отдельным `.pine` исходником (`strategies/pine-strategy-step-by-step`, пример `AdaptiveMomentumRibbon`)

## Типовая структура стратегии

Внутри `packages/core/src/strategy/<Strategy>` обычно есть:

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

Исполнение ордера, AI/ML-enrichment и policy выполняет общий runtime:

- `packages/core/src/utils/strategyRuntime.ts`

## Реальный пример: поток `core.ts` в TrendLine

```ts
return async (candle) => {
  // 1) Считаем трендлайны для текущей свечи
  const lowsTrendlines = getLowsTrendlines.next(candle);
  const highsTrendlines = getHighsTrendlines.next(candle);

  indicatorsState.onBar();

  // 2) Выбираем лучшую линию (с приоритетом low-линии)
  const bestLine =
    lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];
  if (!bestLine) {
    return strategyApi.skip('NO_TRENDLINE');
  }

  // 3) Базовые проверки до входа
  const positionExists = await strategyApi.isCurrentPositionExists();
  if (positionExists) {
    return strategyApi.skip('POSITION_EXISTS');
  }

  if (lastTradeController.isInCooldown(candle.timestamp)) {
    return strategyApi.skip('DEV_TRADE_COOLDOWN');
  }

  const { fullData, timestamp, currentPrice } =
    await strategyApi.getMarketData();
  if (!filterByVeryVolatility(fullData)) {
    return strategyApi.skip('VERY_VOLATILITY');
  }

  // 4) Конфиг направления зависит от режима найденной линии
  const modeConfig = bestLine.mode === 'highs' ? HIGHS : LOWS;
  const { direction, TP, SL, minRiskRatio, enable } = modeConfig;
  if (!enable) {
    return strategyApi.skip('STRATEGY_DISABLED');
  }

  // 5) Общий helper считает TP/SL, риск и qty
  const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
    strategyApi.getDirectionalTpSlPrices({
      price: currentPrice,
      direction,
      takeProfitDelta: TP,
      stopLossDelta: SL,
      unit: 'percent',
      maxLossValue: MAX_LOSS_VALUE,
      feePercent: Number(FEE_PERCENT ?? 0),
    });

  if (!qty || !Number.isFinite(qty) || qty <= 0) {
    return strategyApi.skip('INVALID_QTY');
  }
  if (riskRatio <= minRiskRatio) {
    return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
  }

  const correlation = indicatorsState.latestNumber('correlation');
  if (
    ENV !== 'BACKTEST' &&
    correlation != null &&
    correlation >= MAX_CORRELATION
  ) {
    return strategyApi.skip(`MAX_CORRELATION:${round(correlation)}`);
  }

  lastTradeController.markTrade(timestamp);

  // 6) Возвращаем entry-решение, дальше все делает runtime
  return strategyApi.entry({
    figures: {
      ...buildTrendLineFigures(bestLine),
    },
    direction,
    timestamp,
    prices: {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio,
    },
    indicators: indicatorsState.snapshot(),
    additionalIndicators: {
      touches: bestLine.touches.length + 2,
      distance: bestLine.distance,
      trendLine: bestLine,
    },
    orderPlan: {
      qty,
      takeProfits: [{ rate: 1, price: takeProfitPrice }],
    },
  });
};
```

## Реальный пример: manifest и hook TrendLine

```ts
export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  hooks: {
    beforePlaceOrder: trendLineBeforePlaceOrderHook,
  },
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
```

```ts
export const trendLineBeforePlaceOrderHook = async ({
  connector,
  entryContext,
  config,
}) => {
  const trendLineConfig = config as TrendLineConfig;
  if (!trendLineConfig.CLOSE_OPPOSITE_POSITIONS) {
    return;
  }

  await closeOppositePositionsBeforeOpen({ connector, entryContext });
};
```

## Реальный пример: mapping AI/ML policy

```ts
// AI adapter
mapEntryRuntimeFromConfig: (config) =>
  mapAiRuntimeFromConfig(config as Pick<TrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>),

// ML adapter
mapEntryRuntimeFromConfig: (config) =>
  mapMlRuntimeFromConfig(config as TrendLineMlRuntimeConfig, {
    strategyConfig: toTrendLineMlStrategyConfig(config as TrendLineMlRuntimeConfig),
  }),
```

## Полный пошаговый пример (новый)

Если нужен полный туториал с файлами, Redis-ключами, бэктестом, figures и проверкой в UI:

- `strategies/ma-strategy-step-by-step`
- `strategies/pine-strategy-step-by-step`

## Внешняя стратегия как npm-плагин

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  strategyPlugins: ['@scope/tradejs-strategy-pack'],
});
```

Готовый reference-плагин:

- `examples/sandbox`
