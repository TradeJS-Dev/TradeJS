import { round } from '@utils/math';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import {
  CreateStrategyCoreWithSnapshot,
  IndicatorsHistorySnapshot,
  TrendLineOptions,
} from '@types';
import { filterByVeryVolatility } from './filters';
import { TrendLineConfig } from './config';

export const createTrendLineCore: CreateStrategyCoreWithSnapshot<
  TrendLineConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: cachedData, strategyApi, indicatorsState }) => {
  const {
    ENV,
    TRENDLINE,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    MAX_CORRELATION,
    ALLOW_LONG,
    ALLOW_SHORT,
    HIGHS,
    LOWS,
  } = config;

  const lastTradeController = strategyApi.createLastTradeController();

  const trendlineOptions: Partial<TrendLineOptions> = {
    bestLines: 1,
    capture: true,
    ...TRENDLINE,
  };

  const getLowsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'lows',
    ...trendlineOptions,
  });

  const getHighsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'highs',
    ...trendlineOptions,
  });

  return async (candle) => {
    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

    indicatorsState.onBar();

    const bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

    if (!bestLine) {
      return strategyApi.skip('NO_TRENDLINE');
    }

    const positionExists = await strategyApi.isCurrentPositionExists();

    if (positionExists) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const { fullData, lastCandle, currentPrice } =
      await strategyApi.getMarketData();

    if (!filterByVeryVolatility(fullData)) {
      return strategyApi.skip('VERY_VOLATILITY');
    }

    const modeConfig = bestLine.mode === 'highs' ? HIGHS : LOWS;
    const { direction, TP, SL, minRiskRatio, enable } = modeConfig;

    if (direction === 'LONG' && !ALLOW_LONG) {
      return strategyApi.skip('LONG_NOT_ALLOWED');
    }

    if (direction === 'SHORT' && !ALLOW_SHORT) {
      return strategyApi.skip('SHORT_NOT_ALLOWED');
    }

    if (!enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

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

    const indicators = indicatorsState.snapshot();
    const correlation = indicatorsState.latestNumber('correlation');

    if (
      ENV !== 'BACKTEST' &&
      correlation != null &&
      correlation >= MAX_CORRELATION
    ) {
      return strategyApi.skip(`MAX_CORRELATION:${round(correlation)}`);
    }

    lastTradeController.markTrade(lastCandle.timestamp);

    const prices = {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio,
    };

    return strategyApi.entry({
      figures: {
        trendLine: bestLine,
      },
      direction,
      timestamp: lastCandle.timestamp,
      prices,
      indicators,
      additionalIndicators: {
        touches: bestLine.touches.length + 2,
        distance: bestLine.distance,
      },
      orderPlan: {
        qty,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
