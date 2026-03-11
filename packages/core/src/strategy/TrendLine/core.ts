import { round } from '@utils/math';
import { createTrendlineEngine } from '@utils/trendLine/engine';
import {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  TrendLineOptions,
} from '@types';
import { filterByVeryVolatility } from './filters';
import { TrendLineConfig } from './config';
import { buildTrendLineFigures } from './figures';

export const createTrendLineCore: CreateStrategyCore<
  TrendLineConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: cachedData, strategyApi, indicatorsState }) => {
  const {
    ENV,
    TRENDLINE,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    MAX_CORRELATION,
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

    const { fullData, timestamp, currentPrice } =
      await strategyApi.getMarketData();

    if (!filterByVeryVolatility(fullData)) {
      return strategyApi.skip('VERY_VOLATILITY');
    }

    const modeConfig = bestLine.mode === 'highs' ? HIGHS : LOWS;
    const { direction, TP, SL, minRiskRatio, enable } = modeConfig;

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

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: 'TRENDLINE_SIGNAL',
      figures: {
        ...buildTrendLineFigures(bestLine),
      },
      direction,
      indicators,
      additionalIndicators: {
        touches: bestLine.touches.length + 2,
        distance: bestLine.distance,
        trendLine: bestLine,
      },
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
