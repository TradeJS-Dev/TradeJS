import _ from 'lodash';
import { createIndicators, IndicatorPeriods } from '@utils/indicators';
import { logger } from '@utils/logger';
import { fetchMlThreshold } from '@utils/mlGrpc';
import { askAI } from '@utils/ai';
import { getData, redisKeys } from '@utils/redis';
import { getTimestamp } from '@utils/timestamp';
import {
  Connector,
  Direction,
  Interval,
  KlineChartData,
  KlineChartItem,
  Signal,
  StrategyConfig,
  StrategyResults,
  Tp,
} from '@types';

type IndicatorPeriodsConfig = Partial<
  Record<
    | 'MA_FAST'
    | 'MA_MEDIUM'
    | 'MA_SLOW'
    | 'OBV_SMA'
    | 'ATR'
    | 'ATR_PCT_SHORT'
    | 'ATR_PCT_LONG'
    | 'BB'
    | 'BB_STD'
    | 'MACD_FAST'
    | 'MACD_SLOW'
    | 'MACD_SIGNAL'
    | 'LEVEL_LOOKBACK'
    | 'LEVEL_DELAY',
    number
  >
>;

export const buildDefaultIndicatorPeriods = (
  config: IndicatorPeriodsConfig,
): Partial<IndicatorPeriods> => ({
  maFast: config.MA_FAST,
  maMedium: config.MA_MEDIUM,
  maSlow: config.MA_SLOW,
  obvSma: config.OBV_SMA,
  atr: config.ATR,
  atrPctShort: config.ATR_PCT_SHORT,
  atrPctLong: config.ATR_PCT_LONG,
  bb: config.BB,
  bbStd: config.BB_STD,
  macdFast: config.MACD_FAST,
  macdSlow: config.MACD_SLOW,
  macdSignal: config.MACD_SIGNAL,
  levelLookback: config.LEVEL_LOOKBACK,
  levelDelay: config.LEVEL_DELAY,
});

type IndicatorsController = ReturnType<typeof createIndicators>;

interface StrategyIndicatorsStateParams {
  env: string;
  data: KlineChartData;
  btcData: KlineChartData;
  periods?: Partial<IndicatorPeriods>;
}

export const createStrategyIndicatorsState = ({
  env,
  data,
  btcData,
  periods,
}: StrategyIndicatorsStateParams) => {
  let controller: IndicatorsController | null =
    env === 'BACKTEST' ? createIndicators(data, btcData, { periods }) : null;

  return {
    isInitialized: () => controller != null,

    onBar: (candle: KlineChartData[number], btcCandle: KlineChartData[number]) => {
      if (!controller) return;
      controller.next(candle, btcCandle);
    },

    // Lazy bootstrap for live mode: initialize on history before current bar and then apply current bar once.
    ensureInitializedWithCurrentBar: () => {
      if (controller) return controller;

      controller = createIndicators(data.slice(0, -1), btcData.slice(0, -1), {
        periods,
      });

      const lastCandle = data[data.length - 1];
      const lastBtcCandle = btcData[btcData.length - 1];
      if (lastCandle && lastBtcCandle) {
        controller.next(lastCandle, lastBtcCandle);
      }

      return controller;
    },

    result: () => controller?.result(),
  };
};

export const getStrategyMarketSnapshot = async ({
  env,
  connector,
  symbol,
  interval,
  cachedData,
  preloadStart,
  backtestPriceMode = 'mid',
}: {
  env: string;
  connector: Connector;
  symbol: string;
  interval: Interval;
  cachedData: KlineChartData;
  preloadStart: number;
  backtestPriceMode?: 'mid' | 'close';
}): Promise<{
  fullData: KlineChartData;
  lastCandle: KlineChartItem;
  currentPrice: number;
}> => {
  const fullData =
    env === 'BACKTEST'
      ? cachedData
      : await connector.kline({
          symbol,
          start: preloadStart,
          end: getTimestamp(),
          cacheOnly: false,
          interval,
        });

  const lastCandle = fullData[fullData.length - 1];
  const currentPrice =
    env === 'BACKTEST' && backtestPriceMode === 'mid'
      ? (lastCandle.open + lastCandle.close) / 2
      : lastCandle.close;

  return { fullData, lastCandle, currentPrice };
};

interface ResolveStrategyConfigParams<TConfig extends StrategyConfig> {
  strategyName: string;
  userName: string;
  symbol: string;
  baseConfig: Record<string, any>;
  defaults: TConfig;
}

export const resolveStrategyConfig = async <TConfig extends StrategyConfig>({
  strategyName,
  userName,
  symbol,
  baseConfig,
  defaults,
}: ResolveStrategyConfigParams<TConfig>): Promise<{
  config: TConfig;
  configFromBacktest: boolean;
}> => {
  let config = {
    ...defaults,
    ...baseConfig,
  } as TConfig;

  let configFromBacktest = false;

  if (config.ENV !== 'BACKTEST') {
    const userConfig = (await getData(
      redisKeys.strategyConfig(userName, strategyName),
      {},
    )) as TConfig;

    if (!_.isEmpty(userConfig)) {
      config = {
        ...config,
        ...userConfig,
      };
    }

    const results = (await getData(
      redisKeys.strategyResults(userName, strategyName),
      {},
    )) as StrategyResults;

    const backtestResult = results?.[symbol];
    if (backtestResult && !_.isEmpty(backtestResult.config)) {
      config = {
        ...config,
        ...backtestResult.config,
      };
      configFromBacktest = true;
    }
  }

  return { config, configFromBacktest };
};

interface BuildStrategySignalParams {
  signalId: string;
  strategy: Signal['strategy'];
  symbol: string;
  interval: Signal['interval'];
  direction: Direction;
  timestamp: number;
  prices: Signal['prices'];
  figures?: Signal['figures'];
  indicators?: Signal['indicators'];
  additionalIndicators?: NonNullable<Signal['additionalIndicators']>;
  configFromBacktest?: boolean;
}

export const buildStrategySignal = ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  prices,
  figures = {},
  indicators = {},
  additionalIndicators,
  configFromBacktest,
}: BuildStrategySignalParams): Signal => ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  figures,
  prices,
  indicators,
  additionalIndicators,
  configFromBacktest,
});

export const calculateRiskRatio = ({
  direction,
  currentPrice,
  takeProfitPrice,
  stopLossPrice,
}: {
  direction: Direction;
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
}): number => {
  const isLong = direction === 'LONG';

  const reward = isLong
    ? takeProfitPrice - currentPrice
    : currentPrice - takeProfitPrice;
  const risk = isLong
    ? currentPrice - stopLossPrice
    : stopLossPrice - currentPrice;

  return risk > 0 ? reward / risk : 0;
};

export const getDirectionalTpSlPrices = ({
  price,
  direction,
  takeProfitDelta,
  stopLossDelta,
  unit = 'percent',
  maxLossValue,
  feePercent = 0,
}: {
  price: number;
  direction: Direction;
  takeProfitDelta: number;
  stopLossDelta: number;
  unit?: 'percent' | 'ratio';
  maxLossValue?: number;
  feePercent?: number;
}) => {
  const deltaFactor = unit === 'percent' ? 100 : 1;
  const tp = takeProfitDelta / deltaFactor;
  const sl = stopLossDelta / deltaFactor;
  const isLong = direction === 'LONG';
  const stopLossPrice = isLong ? price * (1 - sl) : price * (1 + sl);
  const takeProfitPrice = isLong ? price * (1 + tp) : price * (1 - tp);
  const riskRatio = calculateRiskRatio({
    direction,
    currentPrice: price,
    takeProfitPrice,
    stopLossPrice,
  });

  const slPercent = unit === 'percent' ? stopLossDelta : stopLossDelta * 100;
  const qty =
    typeof maxLossValue === 'number' &&
    Number.isFinite(maxLossValue) &&
    maxLossValue > 0
      ? maxLossValue / ((price * (slPercent + feePercent)) / 100)
      : undefined;

  return {
    stopLossPrice,
    takeProfitPrice,
    riskRatio,
    qty,
  };
};

interface MlEnrichmentOptions {
  strategyName: string;
  strategyConfig: StrategyConfig;
  symbol: string;
  mlThreshold: number;
}

interface EnrichSignalWithMlAiParams {
  signal: Signal;
  symbol: string;
  direction: Direction;
  env: string;
  ml?: MlEnrichmentOptions;
  aiEnabled?: boolean;
}

export const enrichSignalWithMlAi = async ({
  signal,
  symbol,
  direction,
  env,
  ml,
  aiEnabled = true,
}: EnrichSignalWithMlAiParams): Promise<number | undefined> => {
  if (env !== 'BACKTEST' && ml) {
    const mlResult = await fetchMlThreshold(signal, {
      strategyName: ml.strategyName,
      strategyConfig: ml.strategyConfig,
      symbol: ml.symbol,
      ML_THRESHOLD: ml.mlThreshold,
    });

    if (mlResult) {
      signal.ml = mlResult;
    }
  }

  if (env === 'BACKTEST' || !aiEnabled) {
    return undefined;
  }

  try {
    const analysis = await askAI(signal);
    const aiApprovedCurrentTrade = analysis?.direction === direction;
    if (aiApprovedCurrentTrade && typeof analysis?.quality === 'number') {
      return Math.round(analysis.quality);
    }
  } catch (err) {
    logger.error('AI analysis error: %s %s', symbol, err);
  }

  return undefined;
};

interface ExecuteEntryOrderParams {
  connector: Connector;
  symbol: string;
  direction: Direction;
  qty: number;
  currentPrice: number;
  timestamp: number;
  takeProfits: Tp[];
  stopLossPrice: number | null;
  signal: Signal;
  beforePlaceOrder?: () => Promise<void>;
}

export const executeEntryOrder = async ({
  connector,
  symbol,
  direction,
  qty,
  currentPrice,
  timestamp,
  takeProfits,
  stopLossPrice,
  signal,
  beforePlaceOrder,
}: ExecuteEntryOrderParams): Promise<number> => {
  await beforePlaceOrder?.();

  const orderPlaced = await connector.placeOrder(
    {
      symbol,
      qty,
      price: currentPrice,
      isLimit: false,
      timestamp,
      direction,
      signal,
    },
    takeProfits,
    stopLossPrice,
  );

  signal.orderStatus = orderPlaced ? 'completed' : 'failed';

  const currentPosition = await connector.getPosition(symbol);
  if (currentPosition?.price) {
    signal.prices.currentPrice = currentPosition.price;
    return currentPosition.price;
  }

  return currentPrice;
};
