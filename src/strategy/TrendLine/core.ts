import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { uuid } from '@utils/uuid';
import { round } from '@utils/math';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import {
  buildDefaultIndicatorPeriods,
  createStrategyIndicatorsState,
  getStrategyMarketSnapshot,
  getDirectionalTpSlPrices,
} from '@utils/strategyHelpers';
import {
  CreateStrategyCoreParams,
  StrategyCoreRunner,
  StrategyDecision,
} from '@utils/strategyRuntime';
import { KlineChartItem, StrategyConfig, TrendLineOptions } from '@types';
import { filterByVeryVolatility } from './filters';
import {
  buildTrendlineEntryDecision,
  buildTrendlineSignal,
} from './coreHelpers';

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);

export const createTrendLineCore = async ({
  symbol,
  config,
  configFromBacktest,
  connector,
  data: cachedData,
  btcData: btcCachedData,
}: CreateStrategyCoreParams<StrategyConfig>): Promise<StrategyCoreRunner> => {
  const ONE_DAY_MS = 86_400_000;
  let lastTradeTimestamp: number | null = null;

  const {
    ENV,
    INTERVAL,
    BACKTEST_PRICE_MODE,
    TRENDLINE,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    HIGHS,
    LOWS,
  } = config;

  const indicatorPeriods = buildDefaultIndicatorPeriods(config);

  const indicatorsState = createStrategyIndicatorsState({
    env: String(ENV),
    data: cachedData,
    btcData: btcCachedData,
    periods: indicatorPeriods,
  });

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

  return async (
    candle: KlineChartItem,
    btcCandle: KlineChartItem,
  ): Promise<StrategyDecision> => {
    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

    indicatorsState.onBar(candle, btcCandle);

    const bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

    if (!bestLine) {
      return { kind: 'skip', code: 'NO_TRENDLINE' };
    }

    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position) && position.qty > 0;

    if (positionExists) {
      return { kind: 'skip', code: 'POSITION_EXISTS' };
    }

    if (
      ENV === 'BACKTEST' &&
      lastTradeTimestamp &&
      candle.timestamp <= lastTradeTimestamp + ONE_DAY_MS
    ) {
      return { kind: 'skip', code: 'DEV_TRADE_COOLDOWN' };
    }

    const { fullData, lastCandle, currentPrice } =
      await getStrategyMarketSnapshot({
        env: String(ENV),
        connector,
        symbol,
        interval: INTERVAL,
        cachedData,
        preloadStart: PRELOAD_START,
        backtestPriceMode:
          BACKTEST_PRICE_MODE === 'close' ? 'close' : 'mid',
      });

    if (!filterByVeryVolatility(fullData)) {
      return { kind: 'skip', code: 'VERY_VOLATILITY' };
    }

    const modeConfig = bestLine.mode === 'highs' ? HIGHS : LOWS;
    const { direction, TP, SL, minRiskRatio, enable } = modeConfig;

    if (!enable) {
      return { kind: 'skip', code: 'STRATEGY_DISABLED' };
    }

    const {
      stopLossPrice,
      takeProfitPrice,
      riskRatio,
      qty,
    } = getDirectionalTpSlPrices({
      price: currentPrice,
      direction,
      takeProfitDelta: TP,
      stopLossDelta: SL,
      unit: 'percent',
      maxLossValue: MAX_LOSS_VALUE,
      feePercent: Number(FEE_PERCENT ?? 0),
    });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return { kind: 'skip', code: 'INVALID_QTY' };
    }

    if (riskRatio <= minRiskRatio) {
      return { kind: 'skip', code: `RISK_RATIO:${round(riskRatio)}` };
    }

    const indicatorsController = indicatorsState.ensureInitializedWithCurrentBar();
    const indicatorHistory = indicatorsController.result();

    const signal = buildTrendlineSignal({
      signalId: uuid(),
      symbol,
      interval: INTERVAL,
      direction,
      timestamp: lastCandle.timestamp,
      bestLine,
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio,
      indicatorHistory,
      configFromBacktest,
    });

    if (ENV === 'BACKTEST') {
      lastTradeTimestamp = lastCandle.timestamp;
    }

    return buildTrendlineEntryDecision({
      signal,
      qty,
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      direction,
      timestamp: lastCandle.timestamp,
      connector,
      symbol,
      config,
    });
  };
};
