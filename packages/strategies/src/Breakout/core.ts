import _ from 'lodash';

import { BreakoutConfig } from './config';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';
import { createBreakoutEngine } from './engine';
import { buildBreakoutFigures } from './figures';
import {
  Candle,
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  Direction,
  IndicatorSnapshot,
  StrategyConfig,
} from '@tradejs/types';

interface SignalConfig {
  weight: number;
  required?: boolean;
}

type SignalsConfig = { [K in Signal]?: SignalConfig };
type Signals = Record<Signal, boolean>;

export interface BreakoutSetupMetrics {
  direction: Direction;
  bodyAtr: number | null;
  volumeRel20: number | null;
  acceptanceCloses: number | null;
  distanceAtr: number | null;
  trendMoveAtr: number | null;
  rangeAtr: number | null;
  freshLevelCross: boolean;
  directionalBody: boolean;
}

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

type BreakoutSignalIndicators = {
  candle: Candle;
  prevCandle: Candle;
  highLevel: number;
  lowLevel: number;
  maFast: number;
  maSlow: number;
  smaObv: number;
  obv: number;
  atr: number;
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

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

export const getBreakoutSetupMetrics = ({
  direction,
  candle,
  prevCandle,
  breakoutLevel,
  atr,
  baseContext,
  trendMoveAtr,
  rangeAtr,
}: {
  direction: Direction;
  candle: Candle;
  prevCandle: Candle;
  breakoutLevel: number;
  atr: number;
  baseContext?: BaseStrategyContextSnapshot;
  trendMoveAtr?: number | null;
  rangeAtr?: number | null;
}): BreakoutSetupMetrics => {
  const isLong = direction === 'LONG';
  const body = Math.abs(Number(candle.close) - Number(candle.open));
  const distance = isLong
    ? Number(candle.close) - breakoutLevel
    : breakoutLevel - Number(candle.close);

  return {
    direction,
    bodyAtr: atr > 0 && Number.isFinite(body) ? body / atr : null,
    volumeRel20: toFiniteNumberOrNull(
      baseContext?.participation?.volume?.volumeRel20,
    ),
    acceptanceCloses: toFiniteNumberOrNull(
      isLong
        ? baseContext?.structure?.acceptance?.closesAboveHighLevel3
        : baseContext?.structure?.acceptance?.closesBelowLowLevel3,
    ),
    distanceAtr: atr > 0 && Number.isFinite(distance) ? distance / atr : null,
    trendMoveAtr:
      trendMoveAtr == null ? null : isLong ? trendMoveAtr : -trendMoveAtr,
    rangeAtr: rangeAtr ?? null,
    freshLevelCross: isLong
      ? Number(prevCandle.close) <= breakoutLevel &&
        Number(candle.close) > breakoutLevel
      : Number(prevCandle.close) >= breakoutLevel &&
        Number(candle.close) < breakoutLevel,
    directionalBody: isLong
      ? Number(candle.close) > Number(candle.open)
      : Number(candle.close) < Number(candle.open),
  };
};

export const isBreakoutSetupAccepted = (
  config: BreakoutConfig,
  metrics: BreakoutSetupMetrics,
): boolean => {
  const isLong = metrics.direction === 'LONG';
  if (
    (isLong && config.BREAKOUT_LONG_ENABLED === false) ||
    (!isLong && config.BREAKOUT_SHORT_ENABLED === false)
  ) {
    return false;
  }
  if (config.BREAKOUT_REQUIRE_FRESH_LEVEL_CROSS && !metrics.freshLevelCross) {
    return false;
  }
  if (config.BREAKOUT_REQUIRE_DIRECTIONAL_BODY && !metrics.directionalBody) {
    return false;
  }

  const minBodyAtr = Math.max(0, Number(config.BREAKOUT_MIN_BODY_ATR ?? 0));
  if (
    minBodyAtr > 0 &&
    (metrics.bodyAtr == null || metrics.bodyAtr < minBodyAtr)
  ) {
    return false;
  }
  const minVolumeRel20 = Math.max(
    0,
    Number(config.BREAKOUT_MIN_VOLUME_REL20 ?? 0),
  );
  if (
    minVolumeRel20 > 0 &&
    (metrics.volumeRel20 == null || metrics.volumeRel20 < minVolumeRel20)
  ) {
    return false;
  }
  const minAcceptanceCloses = Math.max(
    0,
    Math.floor(Number(config.BREAKOUT_MIN_ACCEPTANCE_CLOSES ?? 0)),
  );
  if (
    minAcceptanceCloses > 0 &&
    (metrics.acceptanceCloses == null ||
      metrics.acceptanceCloses < minAcceptanceCloses)
  ) {
    return false;
  }
  const maxDistanceAtr = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'BREAKOUT_MAX_DISTANCE_ATR',
      direction: metrics.direction,
      fallback: 0,
    }),
  );
  if (
    maxDistanceAtr > 0 &&
    (metrics.distanceAtr == null ||
      metrics.distanceAtr < 0 ||
      metrics.distanceAtr > maxDistanceAtr)
  ) {
    return false;
  }
  const minTrendMoveAtr = Math.max(
    0,
    Number(config.BREAKOUT_MIN_TREND_MOVE_ATR ?? 0),
  );
  if (
    minTrendMoveAtr > 0 &&
    (metrics.trendMoveAtr == null || metrics.trendMoveAtr < minTrendMoveAtr)
  ) {
    return false;
  }
  const minRangeAtr = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'BREAKOUT_MIN_RANGE_ATR',
      direction: metrics.direction,
      fallback: 0,
    }),
  );
  if (
    minRangeAtr > 0 &&
    (metrics.rangeAtr == null || metrics.rangeAtr < minRangeAtr)
  ) {
    return false;
  }
  const maxRangeAtr = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'BREAKOUT_MAX_RANGE_ATR',
      direction: metrics.direction,
      fallback: 0,
    }),
  );
  if (
    maxRangeAtr > 0 &&
    (metrics.rangeAtr == null || metrics.rangeAtr > maxRangeAtr)
  ) {
    return false;
  }

  return true;
};

export const createBreakoutCore: CreateStrategyCore<
  BreakoutConfig,
  IndicatorSnapshot | undefined,
  IndicatorSnapshot | undefined
> = async ({ config, data: initialData, strategyApi }) => {
  const useEngine = Boolean(config.BREAKOUT_USE_ENGINE);
  const detectorState = useEngine
    ? strategyApi.createStateController<
        { engine: ReturnType<typeof createBreakoutEngine> },
        ReturnType<ReturnType<typeof createBreakoutEngine>['next']>,
        ReturnType<ReturnType<typeof createBreakoutEngine>['getState']>
      >(
        'Breakout',
        () => ({
          engine: createBreakoutEngine({ config, initialCandles: initialData }),
        }),
        {
          configKey: JSON.stringify({
            lookback: config.BREAKOUT_ENGINE_LOOKBACK,
            delay: config.BREAKOUT_ENGINE_DELAY,
            trendLookback: config.BREAKOUT_TREND_LOOKBACK,
            entryMode: config.BREAKOUT_ENTRY_MODE,
            confirmationBars: config.BREAKOUT_CONFIRMATION_BARS,
            retestMaxBars: config.BREAKOUT_RETEST_MAX_BARS,
            retestToleranceAtr: config.BREAKOUT_RETEST_TOLERANCE_ATR,
            retestToleranceAtrLong: config.BREAKOUT_RETEST_TOLERANCE_ATR_LONG,
            retestToleranceAtrShort: config.BREAKOUT_RETEST_TOLERANCE_ATR_SHORT,
          }),
          snapshot: (state) => state.engine.getState(),
        },
      )
    : null;
  const cooldownMs =
    Math.max(0, Number(config.BREAKOUT_COOLDOWN_HOURS ?? 0)) * 60 * 60 * 1000;
  const lastTradeController = strategyApi.createLastTradeController({
    enabled: cooldownMs > 0,
    cooldownMs,
  });

  return async (candle) => {
    if (_.isEmpty(candle)) {
      return strategyApi.skip('NO_DATA');
    }
    const engineRuntime = detectorState?.oncePerTimestamp(
      candle.timestamp,
      (state) => state.engine.next(candle),
    );
    const engineSnapshot = engineRuntime?.snapshot ?? null;
    const engineSignal = engineRuntime?.signal ?? null;
    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );

    if (
      useEngine &&
      !engineSignal &&
      !positionExists &&
      engineSnapshot?.previousCandle &&
      engineSnapshot.highLevel != null &&
      engineSnapshot.lowLevel != null &&
      engineSnapshot.atr != null
    ) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const baseContext = strategyApi.getBaseContext();
    if (!baseContext && !useEngine) {
      return strategyApi.skip('NO_INDICATORS');
    }

    const highLevel = baseContext?.raw.levels.highLevel ?? null;
    const lowLevel = baseContext?.raw.levels.lowLevel ?? null;
    const maFast = baseContext?.raw.trend.maFast ?? null;
    const maSlow = baseContext?.raw.trend.maSlow ?? null;
    const obv = baseContext?.raw.volume.obv ?? null;
    const smaObv = baseContext?.raw.volume.obvSma ?? null;
    const atr = baseContext?.raw.volatility.atr ?? engineSnapshot?.atr ?? null;
    const bbUpper = baseContext?.raw.volatility.bbUpper ?? null;
    const bbLower = baseContext?.raw.volatility.bbLower ?? null;
    const correlation = baseContext?.raw.crossAsset.btcCorrelation ?? null;
    const effectiveHighLevel = useEngine
      ? engineSnapshot?.highLevel ?? null
      : highLevel;
    const effectiveLowLevel = useEngine
      ? engineSnapshot?.lowLevel ?? null
      : lowLevel;
    const prevCandle =
      baseContext?.prevCandle ?? engineSnapshot?.previousCandle ?? null;

    if (
      !prevCandle ||
      effectiveHighLevel == null ||
      effectiveLowLevel == null ||
      atr == null ||
      (!useEngine &&
        (maFast == null ||
          maSlow == null ||
          obv == null ||
          smaObv == null ||
          bbUpper == null ||
          bbLower == null))
    ) {
      return strategyApi.skip('WAIT_DATA');
    }

    const signals = getSignals(config, {
      candle,
      prevCandle,
      highLevel: effectiveHighLevel,
      lowLevel: effectiveLowLevel,
      maFast: maFast ?? Number.NaN,
      maSlow: maSlow ?? Number.NaN,
      obv: obv ?? Number.NaN,
      smaObv: smaObv ?? Number.NaN,
      atr,
      bb: {
        upper: bbUpper ?? Number.POSITIVE_INFINITY,
        lower: bbLower ?? Number.NEGATIVE_INFINITY,
      },
    });

    const longSetupMetrics = getBreakoutSetupMetrics({
      direction: 'LONG',
      candle,
      prevCandle,
      breakoutLevel:
        engineSignal?.direction === 'LONG'
          ? engineSignal.breakoutLevel
          : effectiveHighLevel,
      atr,
      baseContext,
      trendMoveAtr: engineSnapshot?.trendMoveAtr,
      rangeAtr: engineSnapshot?.rangeAtr,
    });
    const shortSetupMetrics = getBreakoutSetupMetrics({
      direction: 'SHORT',
      candle,
      prevCandle,
      breakoutLevel:
        engineSignal?.direction === 'SHORT'
          ? engineSignal.breakoutLevel
          : effectiveLowLevel,
      atr,
      baseContext,
      trendMoveAtr: engineSnapshot?.trendMoveAtr,
      rangeAtr: engineSnapshot?.rangeAtr,
    });
    const shouldOpenLong =
      (useEngine
        ? engineSignal?.direction === 'LONG'
        : checkSignals(
            config.SIGNALS_LONG,
            config.REQUIRED_SCORE_LONG,
            signals,
          )) && isBreakoutSetupAccepted(config, longSetupMetrics);
    const shouldOpenShort =
      (useEngine
        ? engineSignal?.direction === 'SHORT'
        : checkSignals(
            config.SIGNALS_SHORT,
            config.REQUIRED_SCORE_SHORT,
            signals,
          )) && isBreakoutSetupAccepted(config, shortSetupMetrics);

    if (!positionExists || !position) {
      if (shouldOpenLong) {
        const { currentPrice, timestamp } =
          await strategyApi.getDecisionPriceContext();
        if (lastTradeController?.isInCooldown(timestamp)) {
          return strategyApi.skip('TRADE_COOLDOWN');
        }
        const qty = config.LIMIT / currentPrice;
        const { stopLossPrice, takeProfitPrice } =
          strategyApi.getDirectionalTpSlPrices({
            price: currentPrice,
            direction: 'LONG',
            takeProfitDelta: config.TP_LONG?.[0]?.profit ?? 0,
            stopLossDelta: config.SL_LONG,
            unit: 'ratio',
          });

        lastTradeController?.markTrade(timestamp);
        return strategyApi.entry({
          code: 'OPEN_LONG',
          direction: 'LONG',
          figures: buildBreakoutFigures({
            direction: 'LONG',
            entryTimestamp: timestamp,
            entryPrice: currentPrice,
            stopLossPrice,
            takeProfitPrice,
            referenceTimestamp: prevCandle.timestamp,
            breakoutLevel:
              engineSignal?.direction === 'LONG'
                ? engineSignal.breakoutLevel
                : effectiveHighLevel,
            volatilityBand: bbUpper ?? effectiveHighLevel,
            signals,
            signalRules: config.SIGNALS_LONG,
            requiredScore: config.REQUIRED_SCORE_LONG,
          }),
          indicators: {
            maFast,
            maSlow,
            obv,
            smaObv,
            atr,
            bbUpper,
            bbLower,
            correlation,
            baseContext,
          },
          additionalIndicators: {
            highLevel: effectiveHighLevel,
            lowLevel: effectiveLowLevel,
            signals,
            breakoutSetup: longSetupMetrics,
            breakoutEngine: engineSnapshot,
          },
          orderPlan: {
            qty,
            stopLossPrice,
            takeProfits:
              config.TP_LONG.length > 0
                ? config.TP_LONG.map(({ rate, profit }) => ({
                    rate,
                    price: currentPrice * (1 + profit),
                  }))
                : [{ rate: 1, price: takeProfitPrice }],
          },
        });
      }

      if (shouldOpenShort) {
        const { currentPrice, timestamp } =
          await strategyApi.getDecisionPriceContext();
        if (lastTradeController?.isInCooldown(timestamp)) {
          return strategyApi.skip('TRADE_COOLDOWN');
        }
        const qty = config.LIMIT / currentPrice;
        const { stopLossPrice, takeProfitPrice } =
          strategyApi.getDirectionalTpSlPrices({
            price: currentPrice,
            direction: 'SHORT',
            takeProfitDelta: config.TP_SHORT?.[0]?.profit ?? 0,
            stopLossDelta: config.SL_SHORT,
            unit: 'ratio',
          });

        lastTradeController?.markTrade(timestamp);
        return strategyApi.entry({
          code: 'OPEN_SHORT',
          direction: 'SHORT',
          figures: buildBreakoutFigures({
            direction: 'SHORT',
            entryTimestamp: timestamp,
            entryPrice: currentPrice,
            stopLossPrice,
            takeProfitPrice,
            referenceTimestamp: prevCandle.timestamp,
            breakoutLevel:
              engineSignal?.direction === 'SHORT'
                ? engineSignal.breakoutLevel
                : effectiveLowLevel,
            volatilityBand: bbLower ?? effectiveLowLevel,
            signals,
            signalRules: config.SIGNALS_SHORT,
            requiredScore: config.REQUIRED_SCORE_SHORT,
          }),
          indicators: {
            maFast,
            maSlow,
            obv,
            smaObv,
            atr,
            bbUpper,
            bbLower,
            correlation,
            baseContext,
          },
          additionalIndicators: {
            highLevel: effectiveHighLevel,
            lowLevel: effectiveLowLevel,
            signals,
            breakoutSetup: shortSetupMetrics,
            breakoutEngine: engineSnapshot,
          },
          orderPlan: {
            qty,
            stopLossPrice,
            takeProfits:
              config.TP_SHORT.length > 0
                ? config.TP_SHORT.map(({ rate, profit }) => ({
                    rate,
                    price: currentPrice * (1 - profit),
                  }))
                : [{ rate: 1, price: takeProfitPrice }],
          },
        });
      }

      return strategyApi.skip('NO_SIGNAL');
    }

    const isLong = position.direction === 'LONG';
    const isShort = position.direction === 'SHORT';
    const direction = isLong ? 'LONG' : 'SHORT';

    if ((isLong && shouldOpenShort) || (isShort && shouldOpenLong)) {
      return strategyApi.exit({
        code: 'CLOSE_POSITION_BY_OPEN_SIGNAL',
        direction,
      });
    }

    if ((isLong && signals.SMA_DOWNTREND) || (isShort && signals.SMA_UPTREND)) {
      return strategyApi.exit({
        code: 'CLOSE_POSITION_BY_SMA',
        direction,
      });
    }

    return strategyApi.skip('POSITION_HELD');
  };
};
