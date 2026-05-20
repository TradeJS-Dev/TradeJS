import type { BaseStrategyContextSnapshot, Candle } from '@tradejs/types';
import { ML_BASE_CANDLES_WINDOW } from '../constants';
import {
  createNumericHistoryBuffer,
  materializeNumericHistory,
  type NumericHistoryBuffer,
} from './indicatorHistory';
import {
  averageLastN,
  calculateLineSlope,
  calculateRangePosition,
  calculateZScore,
  getRelativeChange,
  getLastFiniteValue,
  percentChange,
  safeDivide,
  toMlCandle,
  toNullable,
} from './indicatorMath';
import type { IndicatorPeriods } from './indicators';

export type CloseStreakRuntimeState = {
  up: number;
  down: number;
};

export type BreakoutRuntimeState = {
  side: 'high' | 'low' | null;
  barsSinceBreakout: number | null;
};

const SESSION_WINDOWS: Array<{
  name: 'asia' | 'europe' | 'us';
  startMinuteUtc: number;
  endMinuteUtc: number;
}> = [
  { name: 'asia', startMinuteUtc: 0, endMinuteUtc: 8 * 60 },
  { name: 'europe', startMinuteUtc: 7 * 60, endMinuteUtc: 16 * 60 },
  { name: 'us', startMinuteUtc: 13 * 60, endMinuteUtc: 22 * 60 },
];

const FUNDING_WINDOW_STEP_MINUTES = 8 * 60;
const FUNDING_WINDOW_NEARBY_MINUTES = 60;

const isInsideSession = (
  minuteUtc: number,
  startMinuteUtc: number,
  endMinuteUtc: number,
) =>
  startMinuteUtc <= endMinuteUtc
    ? minuteUtc >= startMinuteUtc && minuteUtc < endMinuteUtc
    : minuteUtc >= startMinuteUtc || minuteUtc < endMinuteUtc;

export const buildSessionContext = (timestamp: number) => {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const minuteUtc = utcHour * 60 + utcMinute;
  const activeSessions = SESSION_WINDOWS.filter((session) =>
    isInsideSession(minuteUtc, session.startMinuteUtc, session.endMinuteUtc),
  ).map((session) => session.name);

  const primarySession = activeSessions.includes('us')
    ? 'us'
    : activeSessions.includes('europe')
      ? 'europe'
      : activeSessions.includes('asia')
        ? 'asia'
        : 'off_hours';

  const primaryWindow = SESSION_WINDOWS.find(
    (session) => session.name === primarySession,
  );
  const minutesFromSessionOpen =
    primaryWindow != null ? minuteUtc - primaryWindow.startMinuteUtc : null;
  const minutesToFundingWindow =
    (FUNDING_WINDOW_STEP_MINUTES - (minuteUtc % FUNDING_WINDOW_STEP_MINUTES)) %
    FUNDING_WINDOW_STEP_MINUTES;

  return {
    primarySession,
    isOverlap: activeSessions.length > 1,
    minutesFromSessionOpen,
    minutesToFundingWindow,
    fundingWindowNearby:
      minutesToFundingWindow <= FUNDING_WINDOW_NEARBY_MINUTES,
  };
};

type BaseResultSnapshot = {
  maFast: number | null;
  maMedium: number | null;
  maSlow: number | null;
  atr: number | null;
  atrPct: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  obv: number | null;
  smaObv: number | null;
  macd: number | null | undefined;
  macdSignal: number | null | undefined;
  macdHistogram: number | null | undefined;
  price24hPcnt: number;
  price1hPcnt: number;
  highPrice1h: number | null;
  lowPrice1h: number | null;
  volume1h: number | null;
  highPrice24h: number | null;
  lowPrice24h: number | null;
  volume24h: number | null;
  highLevel: number | null;
  lowLevel: number | null;
  prevClose: number | null;
  correlation: number;
  spread: number | null;
};

export type BuildBaseContextParams = {
  candle: Candle;
  prevCandle: Candle | null;
  baseResult: BaseResultSnapshot;
  candlesHistory: Candle[];
  btcCandlesHistory: Candle[];
  closeSeries: number[];
  volumeSeries: number[];
  btcCloseSeries: number[];
  coinResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  btcResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  indicatorHistory: Record<string, NumericHistoryBuffer>;
  indicatorPeriods: IndicatorPeriods;
  closeStreaks: CloseStreakRuntimeState;
  breakoutState: BreakoutRuntimeState;
};

export const buildBaseContextMtfSnapshot = ({
  candlesHistory,
  btcCandlesHistory,
  coinResampledCandles,
  btcResampledCandles,
}: Pick<
  BuildBaseContextParams,
  | 'candlesHistory'
  | 'btcCandlesHistory'
  | 'coinResampledCandles'
  | 'btcResampledCandles'
>) => ({
  candles: {
    m15: candlesHistory.slice(-ML_BASE_CANDLES_WINDOW).map(toMlCandle),
    h1: coinResampledCandles.h1.slice(-ML_BASE_CANDLES_WINDOW),
    h4: coinResampledCandles.h4.slice(-ML_BASE_CANDLES_WINDOW),
    d1: coinResampledCandles.d1.slice(-ML_BASE_CANDLES_WINDOW),
  },
  benchmarkCandles: {
    m15: btcCandlesHistory.slice(-ML_BASE_CANDLES_WINDOW).map(toMlCandle),
    h1: btcResampledCandles.h1.slice(-ML_BASE_CANDLES_WINDOW),
    h4: btcResampledCandles.h4.slice(-ML_BASE_CANDLES_WINDOW),
    d1: btcResampledCandles.d1.slice(-ML_BASE_CANDLES_WINDOW),
  },
});

export const buildBaseContextSnapshot = ({
  candle,
  prevCandle,
  baseResult,
  candlesHistory,
  btcCandlesHistory,
  closeSeries,
  volumeSeries,
  btcCloseSeries,
  coinResampledCandles,
  btcResampledCandles,
  indicatorHistory,
  indicatorPeriods,
  closeStreaks,
  breakoutState: breakoutRuntimeState,
}: BuildBaseContextParams): BaseStrategyContextSnapshot => {
  const atr = toNullable(baseResult.atr);
  const bbWidthPct =
    baseResult.bbUpper != null &&
    baseResult.bbLower != null &&
    baseResult.bbMiddle != null &&
    baseResult.bbMiddle !== 0
      ? ((baseResult.bbUpper - baseResult.bbLower) / baseResult.bbMiddle) * 100
      : null;
  const atrPctSeries = materializeNumericHistory(
    indicatorHistory.atrPct ?? createNumericHistoryBuffer(),
  );
  const macdHistogramSeries = materializeNumericHistory(
    indicatorHistory.macdHistogram ?? createNumericHistoryBuffer(),
  );
  const spreadSeries = materializeNumericHistory(
    indicatorHistory.spread ?? createNumericHistoryBuffer(),
  );
  const recent20 = candlesHistory.slice(-20);
  const session = buildSessionContext(candle.timestamp);
  const recent20High =
    recent20.length > 0 ? Math.max(...recent20.map((item) => item.high)) : null;
  const recent20Low =
    recent20.length > 0 ? Math.min(...recent20.map((item) => item.low)) : null;
  const avgVolume20 =
    recent20.length > 0
      ? recent20.reduce((sum, item) => sum + item.volume, 0) / recent20.length
      : null;
  const avgTurnover20 =
    recent20.length > 0
      ? recent20.reduce((sum, item) => sum + item.turnover, 0) / recent20.length
      : null;
  const volumeRel20 = safeDivide(candle.volume, avgVolume20);
  const turnoverRel20 = safeDivide(candle.turnover, avgTurnover20);
  const effortVsResult = safeDivide(
    volumeRel20,
    Math.abs(getRelativeChange(candle.close, prevCandle?.close ?? null) ?? 0) ||
      null,
  );
  const priceDistanceToMaFastAtr = safeDivide(
    baseResult.maFast == null ? null : candle.close - baseResult.maFast,
    atr,
  );
  const priceDistanceToMaSlowAtr = safeDivide(
    baseResult.maSlow == null ? null : candle.close - baseResult.maSlow,
    atr,
  );
  const distanceToHighLevelAtr = safeDivide(
    baseResult.highLevel == null ? null : candle.close - baseResult.highLevel,
    atr,
  );
  const distanceToLowLevelAtr = safeDivide(
    baseResult.lowLevel == null ? null : candle.close - baseResult.lowLevel,
    atr,
  );
  const maStackScore =
    baseResult.maFast == null ||
    baseResult.maMedium == null ||
    baseResult.maSlow == null
      ? null
      : Math.sign(baseResult.maFast - baseResult.maMedium) +
        Math.sign(baseResult.maMedium - baseResult.maSlow);
  const trendBias =
    maStackScore == null
      ? 'neutral'
      : maStackScore > 0
        ? 'bull'
        : maStackScore < 0
          ? 'bear'
          : 'neutral';
  const persistenceWindow = closeSeries.slice(-10);
  const directionalMoves = persistenceWindow
    .slice(1)
    .map((value, index) => value - persistenceWindow[index]);
  const persistence =
    directionalMoves.length === 0
      ? null
      : directionalMoves.filter((delta) =>
          trendBias === 'bull'
            ? delta > 0
            : trendBias === 'bear'
              ? delta < 0
              : delta === 0,
        ).length / directionalMoves.length;
  const atrPctZScore = calculateZScore(
    atrPctSeries,
    toNullable(baseResult.atrPct),
  );
  const compressionScore = safeDivide(
    toNullable(baseResult.atrPct),
    getLastFiniteValue(atrPctSeries.slice(0, -1)),
  );
  const expansionScore =
    compressionScore == null || compressionScore === 0
      ? null
      : 1 / compressionScore;
  const volatilityState =
    compressionScore == null
      ? 'unknown'
      : compressionScore <= 0.9
        ? 'compressed'
        : compressionScore >= 1.1
          ? 'expanded'
          : 'normal';
  const highLowRange = candle.high - candle.low;
  const bodyStrength =
    highLowRange > 0
      ? Math.abs(candle.close - candle.open) / highLowRange
      : null;
  const closeLocationInRange =
    highLowRange > 0 ? (candle.close - candle.low) / highLowRange : null;
  const breakoutState =
    baseResult.highLevel == null || baseResult.lowLevel == null
      ? 'unknown'
      : candle.close > baseResult.highLevel
        ? prevCandle != null && prevCandle.close <= baseResult.highLevel
          ? 'above_high_level'
          : 'failed_high_breakout'
        : candle.close < baseResult.lowLevel
          ? prevCandle != null && prevCandle.close >= baseResult.lowLevel
            ? 'below_low_level'
            : 'failed_low_breakout'
          : 'inside_range';
  const touchTolerance =
    atr != null && Number.isFinite(atr) && atr > 0 ? atr * 0.15 : null;
  const highLevel = baseResult.highLevel;
  const lowLevel = baseResult.lowLevel;
  const highTouchCount20 =
    highLevel == null || touchTolerance == null
      ? null
      : recent20.filter(
          (item) => Math.abs(item.high - highLevel) <= touchTolerance,
        ).length;
  const lowTouchCount20 =
    lowLevel == null || touchTolerance == null
      ? null
      : recent20.filter(
          (item) => Math.abs(item.low - lowLevel) <= touchTolerance,
        ).length;
  const dominantTouchCount20 =
    highTouchCount20 == null && lowTouchCount20 == null
      ? null
      : Math.max(highTouchCount20 ?? 0, lowTouchCount20 ?? 0);
  const upperWick =
    highLowRange > 0
      ? (candle.high - Math.max(candle.open, candle.close)) / highLowRange
      : null;
  const lowerWick =
    highLowRange > 0
      ? (Math.min(candle.open, candle.close) - candle.low) / highLowRange
      : null;
  const breakoutRetestQuality =
    breakoutRuntimeState.side == null ||
    breakoutRuntimeState.barsSinceBreakout == null ||
    breakoutRuntimeState.barsSinceBreakout < 1 ||
    breakoutRuntimeState.barsSinceBreakout > 4 ||
    atr == null
      ? null
      : breakoutRuntimeState.side === 'high'
        ? highLevel == null
          ? null
          : (() => {
              const retestDistance = Math.abs(candle.low - highLevel);
              const wickSupport = lowerWick ?? 0;
              const closeAcceptance = candle.close > highLevel ? 1 : 0;
              const distanceScore = Math.max(0, 1 - retestDistance / atr);
              return Math.min(
                1,
                distanceScore * 0.45 +
                  wickSupport * 0.25 +
                  closeAcceptance * 0.3,
              );
            })()
        : lowLevel == null
          ? null
          : (() => {
              const retestDistance = Math.abs(candle.high - lowLevel);
              const wickSupport = upperWick ?? 0;
              const closeAcceptance = candle.close < lowLevel ? 1 : 0;
              const distanceScore = Math.max(0, 1 - retestDistance / atr);
              return Math.min(
                1,
                distanceScore * 0.45 +
                  wickSupport * 0.25 +
                  closeAcceptance * 0.3,
              );
            })();
  const rejectionWickScore =
    trendBias === 'bull'
      ? lowerWick
      : trendBias === 'bear'
        ? upperWick
        : Math.max(upperWick ?? 0, lowerWick ?? 0);
  const benchmarkMaFast = averageLastN(btcCloseSeries, indicatorPeriods.maFast);
  const benchmarkMaSlow = averageLastN(btcCloseSeries, indicatorPeriods.maSlow);
  const btc1h = btcResampledCandles.h1;
  const btc4h = btcResampledCandles.h4;
  const btc1d = btcResampledCandles.d1;
  const coin4h = coinResampledCandles.h4;
  const coin1d = coinResampledCandles.d1;
  const relativeStrength1h = getRelativeChange(
    baseResult.price1hPcnt,
    btc1h.length >= 2
      ? percentChange(
          btc1h[btc1h.length - 1].close,
          btc1h[Math.max(0, btc1h.length - 2)].close,
        )
      : null,
  );
  const relativeStrength4h = getRelativeChange(
    coin4h.length >= 2
      ? percentChange(
          coin4h[coin4h.length - 1].close,
          coin4h[coin4h.length - 2].close,
        )
      : null,
    btc4h.length >= 2
      ? percentChange(
          btc4h[btc4h.length - 1].close,
          btc4h[btc4h.length - 2].close,
        )
      : null,
  );
  const relativeStrength1d = getRelativeChange(
    coin1d.length >= 2
      ? percentChange(
          coin1d[coin1d.length - 1].close,
          coin1d[coin1d.length - 2].close,
        )
      : null,
    btc1d.length >= 2
      ? percentChange(
          btc1d[btc1d.length - 1].close,
          btc1d[btc1d.length - 2].close,
        )
      : null,
  );
  const benchmarkBias =
    btc1h.length >= 2
      ? btc1h[btc1h.length - 1].close > btc1h[btc1h.length - 2].close
        ? 'bull'
        : btc1h[btc1h.length - 1].close < btc1h[btc1h.length - 2].close
          ? 'bear'
          : 'neutral'
      : 'neutral';
  const trendAlignment =
    trendBias === 'neutral' || benchmarkBias === 'neutral'
      ? 'neutral'
      : trendBias === benchmarkBias
        ? trendBias === 'bull'
          ? 'aligned_bull'
          : 'aligned_bear'
        : 'against_benchmark';
  const benchmarkTrendBias =
    benchmarkMaFast == null || benchmarkMaSlow == null
      ? 'neutral'
      : benchmarkMaFast > benchmarkMaSlow
        ? 'bull'
        : benchmarkMaFast < benchmarkMaSlow
          ? 'bear'
          : 'neutral';
  const snapshot = {
    candle,
    prevCandle,
    raw: {
      trend: {
        maFast: baseResult.maFast,
        maMedium: baseResult.maMedium,
        maSlow: baseResult.maSlow,
      },
      volatility: {
        atr,
        atrPct: toNullable(baseResult.atrPct),
        bbUpper: baseResult.bbUpper,
        bbMiddle: baseResult.bbMiddle,
        bbLower: baseResult.bbLower,
        bbWidthPct,
      },
      momentum: {
        macd: toNullable(baseResult.macd),
        macdSignal: toNullable(baseResult.macdSignal),
        macdHistogram: toNullable(baseResult.macdHistogram),
      },
      volume: {
        volume: candle.volume,
        turnover: candle.turnover,
        obv: baseResult.obv,
        obvSma: baseResult.smaObv,
        volume1h: baseResult.volume1h,
        volume24h: baseResult.volume24h,
      },
      price: {
        prevClose: baseResult.prevClose,
        price1hPct: baseResult.price1hPcnt,
        price24hPct: baseResult.price24hPcnt,
        highPrice1h: baseResult.highPrice1h,
        lowPrice1h: baseResult.lowPrice1h,
        highPrice24h: baseResult.highPrice24h,
        lowPrice24h: baseResult.lowPrice24h,
      },
      levels: {
        highLevel: baseResult.highLevel,
        lowLevel: baseResult.lowLevel,
      },
      crossAsset: {
        btcCorrelation: baseResult.correlation,
      },
    },
    regime: {
      trend: {
        bias: trendBias,
        maStackScore,
        priceDistanceToMaFastAtr,
        priceDistanceToMaSlowAtr,
        persistence,
      },
      volatility: {
        atrPctZScore,
        bbWidthPct,
        compressionScore,
        expansionScore,
        state: volatilityState,
      },
      momentum: {
        roc1h: baseResult.price1hPcnt,
        roc4h:
          coin4h.length >= 2
            ? percentChange(
                coin4h[coin4h.length - 1].close,
                coin4h[coin4h.length - 2].close,
              )
            : null,
        roc1d:
          coin1d.length >= 2
            ? percentChange(
                coin1d[coin1d.length - 1].close,
                coin1d[coin1d.length - 2].close,
              )
            : null,
        macdHistogramSlope: calculateLineSlope(macdHistogramSeries, 5),
        bodyStrength,
        closeLocationInRange,
        upCloseStreak: closeStreaks.up,
        downCloseStreak: closeStreaks.down,
      },
      session,
    },
    structure: {
      localRange: {
        rangePosition20: calculateRangePosition(
          candle.close,
          recent20Low,
          recent20High,
        ),
        distanceToHighLevelAtr,
        distanceToLowLevelAtr,
        breakoutState,
        barsSinceBreakout: breakoutRuntimeState.barsSinceBreakout,
        breakoutRetestQuality,
      },
      levels: {
        highTouchCount20,
        lowTouchCount20,
        dominantTouchCount20,
      },
      candleQuality: {
        upperWickPct: upperWick,
        lowerWickPct: lowerWick,
        rejectionWickScore,
      },
    },
    participation: {
      volume: {
        volumeRel20,
        turnoverRel20,
        volumeTrendSlope: calculateLineSlope(volumeSeries, 5),
        obvSlope: calculateLineSlope(
          materializeNumericHistory(
            indicatorHistory.obv ?? createNumericHistoryBuffer(),
          ),
          5,
        ),
        effortVsResult,
      },
    },
    relative: {
      benchmark: {
        maFast: benchmarkMaFast,
        maSlow: benchmarkMaSlow,
        bias: benchmarkTrendBias,
        relativeStrength1h,
        relativeStrength4h,
        relativeStrength1d,
        trendAlignment,
      },
      execution: {
        venueSpread: baseResult.spread,
        venueSpreadZScore: calculateZScore(
          spreadSeries,
          toNullable(baseResult.spread),
        ),
      },
    },
  } as Omit<BaseStrategyContextSnapshot, 'mtf'> & {
    mtf?: BaseStrategyContextSnapshot['mtf'];
  };

  let cachedMtfSnapshot: BaseStrategyContextSnapshot['mtf'] | null = null;
  Object.defineProperty(snapshot, 'mtf', {
    configurable: true,
    enumerable: true,
    get() {
      if (!cachedMtfSnapshot) {
        cachedMtfSnapshot = buildBaseContextMtfSnapshot({
          candlesHistory,
          btcCandlesHistory,
          coinResampledCandles,
          btcResampledCandles,
        });
      }

      return cachedMtfSnapshot;
    },
  });

  return snapshot as BaseStrategyContextSnapshot;
};
