import _ from 'lodash';
import {
  Candle,
  KlineChartItem,
  CreateStrategyCoreParams,
  StrategyConfig,
  StrategyDecision,
  StrategyCoreRunner,
} from '@types';
import {
  createIndicators,
  IndicatorSnapshot,
} from '@utils/indicators';
import {
  buildEntrySignalDecision,
  buildDefaultIndicatorPeriods,
  getDirectionalTpSlPrices,
} from '@utils/strategyHelpers';
import { config as DEFAULT_CONFIG, BreakoutConfig } from './config';
import { breakoutManifest } from './manifest';

interface SignalConfig {
  weight: number;
  required?: boolean;
}

type SignalsConfig = { [K in Signal]?: SignalConfig };
type Signals = Record<Signal, boolean>;

export enum Signal {
  VOLATILE = 'VOLATILE',
  SMA_UPTREND = 'SMA_UPTREND',
  SMA_DOWNTREND = 'SMA_DOWNTREND',
  OBV_ABOVE_SMA = 'OBV_ABOVE_SMA',
  OBV_BELOW_SMA = 'OBV_BELOW_SMA',
  PREV_HIGH_BREAKOUT = 'PREV_HIGH_BREAKOUT',
  CLOSE_ABOVE_UPPER_BB = 'CLOSE_ABOVE_UPPER_BB',
  CLOSE_ABOVE_HIGH_LEVEL = 'CLOSE_ABOVE_HIGH_LEVEL',
  CLOSE_ABOVE_PREV_CLOSE = 'CLOSE_ABOVE_PREV_CLOSE',
  PREV_LOW_BREAKDOWN = 'PREV_LOW_BREAKDOWN',
  CLOSE_BELOW_LOWER_BB = 'CLOSE_BELOW_LOWER_BB',
  CLOSE_BELOW_LOW_LEVEL = 'CLOSE_BELOW_LOW_LEVEL',
  CLOSE_BELOW_PREV_CLOSE = 'CLOSE_BELOW_PREV_CLOSE',
}

type BreakoutSignalIndicators = Omit<
  IndicatorSnapshot,
  'prevCandle' | 'highLevel' | 'lowLevel'
> & {
  prevCandle: Candle;
  highLevel: number;
  lowLevel: number;
  bb: { upper: number; lower: number };
};

const getSignals = (
  config: StrategyConfig,
  indicators: BreakoutSignalIndicators,
): Signals => {
  const {
    candle,
    prevCandle,
    highLevel,
    lowLevel,
    maFast,
    maSlow,
    smaObv,
    obv,
    bb,
    atr,
  } = indicators;

  const obvAboveSma = obv > smaObv;
  const obvBelowSma = obv < smaObv;

  const smaUptrend = maFast > maSlow;
  const smaDowntrend = maFast < maSlow;

  const prevHighBreakout = prevCandle.high > highLevel;
  const closeAboveUpperBB = candle.close > bb.upper;
  const closeAboveHighLevel = candle.close > highLevel;
  const closeAbovePrevClose = candle.close > prevCandle.close;

  const prevLowBreakdown = prevCandle.low < lowLevel;
  const closeBelowLowerBB = candle.close < bb.lower;
  const closeBelowLowLevel = candle.close < lowLevel;
  const closeBelowPrevClose = candle.close < prevCandle.close;

  const atrThreshold = atr * config.ATR_OPEN;

  const trueRange = Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevCandle.close),
    Math.abs(candle.low - prevCandle.close),
  );

  const isVolatile = trueRange > atrThreshold;

  return {
    [Signal.VOLATILE]: isVolatile,
    [Signal.SMA_UPTREND]: smaUptrend,
    [Signal.SMA_DOWNTREND]: smaDowntrend,
    [Signal.OBV_ABOVE_SMA]: obvAboveSma,
    [Signal.OBV_BELOW_SMA]: obvBelowSma,
    [Signal.PREV_HIGH_BREAKOUT]: prevHighBreakout,
    [Signal.CLOSE_ABOVE_UPPER_BB]: closeAboveUpperBB,
    [Signal.CLOSE_ABOVE_HIGH_LEVEL]: closeAboveHighLevel,
    [Signal.CLOSE_ABOVE_PREV_CLOSE]: closeAbovePrevClose,
    [Signal.PREV_LOW_BREAKDOWN]: prevLowBreakdown,
    [Signal.CLOSE_BELOW_LOWER_BB]: closeBelowLowerBB,
    [Signal.CLOSE_BELOW_LOW_LEVEL]: closeBelowLowLevel,
    [Signal.CLOSE_BELOW_PREV_CLOSE]: closeBelowPrevClose,
  };
};

const checkSignals = (
  config: SignalsConfig,
  minScore: number,
  signals: Signals,
) => {
  let score = 0;

  for (const [signal, rules] of Object.entries(config)) {
    if (rules.required && !signals[signal as Signal]) {
      return false;
    }

    if (signals[signal as Signal]) {
      score += rules.weight;
    }
  }

  return score >= minScore;
};

export const createBreakoutCore = async ({
  symbol,
  config,
  configFromBacktest,
  connector,
  data,
  btcData,
}: CreateStrategyCoreParams<BreakoutConfig>): Promise<StrategyCoreRunner> => {
  const indicatorPeriods = buildDefaultIndicatorPeriods(config);

  const indicatorsController = createIndicators(data, btcData ?? [], {
    periods: indicatorPeriods,
  });

  return async (
    candle: KlineChartItem,
    btcCandle: KlineChartItem,
  ): Promise<StrategyDecision> => {
    if (_.isEmpty(candle)) return { kind: 'skip', code: 'NO_DATA' };

    const indicatorValues = indicatorsController.next(candle, btcCandle);
    if (!indicatorValues) {
      return { kind: 'skip', code: 'NO_INDICATORS' };
    }

    if (
      !indicatorValues.prevCandle ||
      indicatorValues.highLevel == null ||
      indicatorValues.lowLevel == null
    ) {
      return { kind: 'skip', code: 'WAIT_DATA' };
    }

    const { close: price, timestamp } = candle;
    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position) && position.qty > 0;
    const qty = config.LIMIT / price;

    const signals = getSignals(config, {
      ...indicatorValues,
      prevCandle: indicatorValues.prevCandle,
      highLevel: indicatorValues.highLevel,
      lowLevel: indicatorValues.lowLevel,
      bb: {
        upper: indicatorValues.bbUpper,
        lower: indicatorValues.bbLower,
      },
    });

    const shouldOpenLong = checkSignals(
      config.SIGNALS_LONG,
      config.REQUIRED_SCORE_LONG,
      signals,
    );
    const shouldOpenShort = checkSignals(
      config.SIGNALS_SHORT,
      config.REQUIRED_SCORE_SHORT,
      signals,
    );

    if (!positionExists) {
      if (shouldOpenLong) {
        const { stopLossPrice: slPrice, takeProfitPrice } =
          getDirectionalTpSlPrices({
            price,
            direction: 'LONG',
            takeProfitDelta: config.TP_LONG?.[0]?.profit ?? 0,
            stopLossDelta: config.SL_LONG,
            unit: 'ratio',
          });

        return buildEntrySignalDecision({
          code: 'OPEN_LONG',
          entryContext: {
            strategy: breakoutManifest.name,
            symbol,
            interval: config.INTERVAL ?? '15',
            direction: 'LONG',
            timestamp,
            prices: {
              currentPrice: price,
              takeProfitPrice,
              stopLossPrice: slPrice,
              riskRatio: 0,
            },
            configFromBacktest: Boolean(configFromBacktest),
          },
          figures: {},
          indicators: {
            maFast: indicatorValues.maFast,
            maSlow: indicatorValues.maSlow,
            obv: indicatorValues.obv,
            smaObv: indicatorValues.smaObv,
            atr: indicatorValues.atr,
            bbUpper: indicatorValues.bbUpper,
            bbLower: indicatorValues.bbLower,
            correlation: indicatorValues.correlation,
          },
          additionalIndicators: {
            highLevel: indicatorValues.highLevel,
            lowLevel: indicatorValues.lowLevel,
            signals,
          },
          orderPlan: {
            qty,
            takeProfits: config.TP_LONG.map(({ rate, profit }) => ({
              rate,
              price: price * (1 + profit),
            })),
          },
        });
      }

      if (shouldOpenShort) {
        const { stopLossPrice: slPrice, takeProfitPrice } =
          getDirectionalTpSlPrices({
            price,
            direction: 'SHORT',
            takeProfitDelta: config.TP_SHORT?.[0]?.profit ?? 0,
            stopLossDelta: config.SL_SHORT,
            unit: 'ratio',
          });

        return buildEntrySignalDecision({
          code: 'OPEN_SHORT',
          entryContext: {
            strategy: breakoutManifest.name,
            symbol,
            interval: config.INTERVAL ?? '15',
            direction: 'SHORT',
            timestamp,
            prices: {
              currentPrice: price,
              takeProfitPrice,
              stopLossPrice: slPrice,
              riskRatio: 0,
            },
            configFromBacktest: Boolean(configFromBacktest),
          },
          figures: {},
          indicators: {
            maFast: indicatorValues.maFast,
            maSlow: indicatorValues.maSlow,
            obv: indicatorValues.obv,
            smaObv: indicatorValues.smaObv,
            atr: indicatorValues.atr,
            bbUpper: indicatorValues.bbUpper,
            bbLower: indicatorValues.bbLower,
            correlation: indicatorValues.correlation,
          },
          additionalIndicators: {
            highLevel: indicatorValues.highLevel,
            lowLevel: indicatorValues.lowLevel,
            signals,
          },
          orderPlan: {
            qty,
            takeProfits: config.TP_SHORT.map(({ rate, profit }) => ({
              rate,
              price: price * (1 - profit),
            })),
          },
        });
      }

      return { kind: 'skip', code: 'NO_SIGNAL' };
    }

    const isLong = position.direction === 'LONG';
    const isShort = position.direction === 'SHORT';
    const direction = isLong ? 'LONG' : 'SHORT';

    if ((isLong && shouldOpenShort) || (isShort && shouldOpenLong)) {
      return {
        kind: 'exit',
        code: 'CLOSE_POSITION_BY_OPEN_SIGNAL',
        closePlan: { price, timestamp, direction },
      };
    }

    if ((isLong && signals.SMA_DOWNTREND) || (isShort && signals.SMA_UPTREND)) {
      return {
        kind: 'exit',
        code: 'CLOSE_POSITION_BY_SMA',
        closePlan: { price, timestamp, direction },
      };
    }

    return { kind: 'skip', code: 'POSITION_HELD' };
  };
};
