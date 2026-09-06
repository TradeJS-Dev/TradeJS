import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import { ML_BASE_CANDLES_WINDOW } from '../constants';
import {
  createNumericHistoryBuffer,
  materializeNumericHistory,
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
import {
  calculateRecentAtrPctSeries,
  calculateRecentBbWidthPctSeries,
  calculateRecentRangeExpansionSeries,
  calculateRecentRealizedVolatilitySeries,
  calculateRealizedVolatility,
} from './indicatorBaseContextVolatility';

export type {
  BreakoutRuntimeState,
  CloseStreakRuntimeState,
} from './indicatorControllerContracts';
export {
  buildPsychologicalLevelAssetContext,
  buildSessionContext,
  buildTargetVsBtcContext,
  buildTargetVsEthContext,
} from './indicatorBaseContextRelative';
import {
  buildPsychologicalLevelAssetContext,
  buildSessionContext,
  buildTargetVsBtcContext,
  buildTargetVsEthContext,
} from './indicatorBaseContextRelative';

export type {
  BaseContextAdaptiveChannelInput,
  BaseContextContextMaInput,
  BaseContextMaLayerInput,
  BaseContextPsarInput,
  BuildBaseContextParams,
} from './indicatorBaseContextContracts';
export { BASE_CONTEXT_MA_LAYER_PERIODS } from './indicatorBaseContextContracts';
import type { BuildBaseContextParams } from './indicatorBaseContextContracts';
import {
  buildAdxContext,
  buildAdaptiveChannelContext,
  buildContextMaContext,
  buildMaLayersContext,
  buildMtfSummary,
  buildRsiContext,
  buildTrendFollowContext,
  calculateAdxContext,
  calculatePercentRank,
  calculateRsiContext,
} from './indicatorBaseContextTrend';
import {
  buildPivotContext,
  buildPriceZones,
  buildSrZonesContext,
  buildStructureZonesContext,
  buildSwingContext,
  detectConfirmedPivots,
  getNearestZone,
} from './indicatorBaseContextStructure';
import {
  buildLiquidityTailsContext,
  buildLiquidityZonesContext,
} from './indicatorBaseContextLiquidity';
import {
  buildDeltaContext,
  buildPriceVolumeProfileContext,
  buildVolumeStructureContext,
} from './indicatorBaseContextParticipation';

const STRUCTURE_LOOKBACK = 80;
export const BASE_CONTEXT_CANDLE_WINDOW = 256;

export const buildBaseContextMtfSnapshot = ({
  candlesHistory,
  btcCandlesHistory,
  coinResampledCandles,
  btcResampledCandles,
  currentTrendBias,
}: Pick<
  BuildBaseContextParams,
  | 'candlesHistory'
  | 'btcCandlesHistory'
  | 'coinResampledCandles'
  | 'btcResampledCandles'
> & {
  currentTrendBias?: 'bull' | 'bear' | 'neutral';
}) => ({
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
  summary: buildMtfSummary(coinResampledCandles, currentTrendBias),
});

export const buildBaseContextSnapshot = ({
  candle,
  prevCandle,
  baseResult,
  candlesHistory: fullCandlesHistory,
  btcCandlesHistory: fullBtcCandlesHistory,
  ethCandlesHistory: fullEthCandlesHistory = [],
  closeSeries: fullCloseSeries,
  volumeSeries: fullVolumeSeries,
  btcCloseSeries: fullBtcCloseSeries,
  coinResampledCandles,
  btcResampledCandles,
  ethResampledCandles,
  indicatorHistory,
  indicatorPeriods,
  closeStreaks,
  breakoutState: breakoutRuntimeState,
  rsiValue,
  adxValue,
  maLayers: precomputedMaLayers,
  contextMa: precomputedContextMa,
  adaptiveChannel: precomputedAdaptiveChannel,
  psar: precomputedPsar,
}: BuildBaseContextParams): BaseStrategyContextSnapshot => {
  const candlesHistory = fullCandlesHistory.slice(-BASE_CONTEXT_CANDLE_WINDOW);
  const btcCandlesHistory = fullBtcCandlesHistory.slice(
    -BASE_CONTEXT_CANDLE_WINDOW,
  );
  const ethCandlesHistory = fullEthCandlesHistory.slice(
    -BASE_CONTEXT_CANDLE_WINDOW,
  );
  const closeSeries = fullCloseSeries.slice(-BASE_CONTEXT_CANDLE_WINDOW);
  const volumeSeries = fullVolumeSeries.slice(-BASE_CONTEXT_CANDLE_WINDOW);
  const btcCloseSeries = fullBtcCloseSeries.slice(-BASE_CONTEXT_CANDLE_WINDOW);
  const atr = toNullable(baseResult.atr);
  const bbWidthPct =
    baseResult.bbUpper != null &&
    baseResult.bbLower != null &&
    baseResult.bbMiddle != null &&
    baseResult.bbMiddle !== 0
      ? ((baseResult.bbUpper - baseResult.bbLower) / baseResult.bbMiddle) * 100
      : null;
  const recent20 = candlesHistory.slice(-20);
  const prior20 = candlesHistory.slice(-21, -1);
  const structureWindow = candlesHistory.slice(-STRUCTURE_LOOKBACK);
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
  const highLowRange = candle.high - candle.low;
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
  const coin4h = coinResampledCandles.h4;
  const coin1d = coinResampledCandles.d1;
  const buildRelativeSnapshot = (): BaseStrategyContextSnapshot['relative'] => {
    const spreadSeries = materializeNumericHistory(
      indicatorHistory.spread ?? createNumericHistoryBuffer(),
    );
    const benchmarkMaFast = averageLastN(
      btcCloseSeries,
      indicatorPeriods.maFast,
    );
    const benchmarkMaSlow = averageLastN(
      btcCloseSeries,
      indicatorPeriods.maSlow,
    );
    const coin1h = coinResampledCandles.h1;
    const btc1h = btcResampledCandles.h1;
    const btc4h = btcResampledCandles.h4;
    const btc1d = btcResampledCandles.d1;
    const eth1h = ethResampledCandles?.h1 ?? [];
    const eth4h = ethResampledCandles?.h4 ?? [];
    const eth1d = ethResampledCandles?.d1 ?? [];
    const targetVsBtc = buildTargetVsBtcContext({
      coin1h,
      btc1h,
      coin4h,
      btc4h,
      coin1d,
      btc1d,
      coinCandles: candlesHistory,
      btcCandles: btcCandlesHistory,
    });
    const targetVsEth =
      ethCandlesHistory.length >= 2
        ? buildTargetVsEthContext({
            coin1h,
            eth1h,
            coin4h,
            eth4h,
            coin1d,
            eth1d,
            coinCandles: candlesHistory,
            ethCandles: ethCandlesHistory,
          })
        : null;
    const btcPsychologicalLevels = buildPsychologicalLevelAssetContext(
      btcCandlesHistory,
      1_000,
    );
    const ethPsychologicalLevels = buildPsychologicalLevelAssetContext(
      ethCandlesHistory,
      100,
    );
    const referencePsychologicalLevels =
      btcPsychologicalLevels != null || ethPsychologicalLevels != null
        ? {
            ...(btcPsychologicalLevels != null
              ? { BTCUSDT: btcPsychologicalLevels }
              : {}),
            ...(ethPsychologicalLevels != null
              ? { ETHUSDT: ethPsychologicalLevels }
              : {}),
          }
        : null;
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

    return {
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
      targetVsBtc,
      ...(targetVsEth != null ? { targetVsEth } : {}),
      ...(referencePsychologicalLevels != null
        ? { referencePsychologicalLevels }
        : {}),
    } as BaseStrategyContextSnapshot['relative'];
  };
  const buildStructureSnapshot =
    (): BaseStrategyContextSnapshot['structure'] => {
      const structurePivots = detectConfirmedPivots(structureWindow, atr);
      const structureZones = buildPriceZones(
        structureWindow,
        structurePivots,
        atr,
      );
      const swingContext = buildSwingContext(structurePivots);
      const pivotContext = buildPivotContext(
        structurePivots,
        structureWindow.length,
        atr,
      );
      const nearestSupport = getNearestZone(
        structureZones,
        'support',
        candle.close,
      );
      const nearestResistance = getNearestZone(
        structureZones,
        'resistance',
        candle.close,
      );
      const totalStructureVolume = structureWindow.reduce(
        (sum, item) => sum + item.volume,
        0,
      );
      const priceInSupportZone =
        nearestSupport == null
          ? null
          : candle.close >= nearestSupport.lower &&
            candle.close <= nearestSupport.upper;
      const priceInResistanceZone =
        nearestResistance == null
          ? null
          : candle.close >= nearestResistance.lower &&
            candle.close <= nearestResistance.upper;
      const activeZoneType = priceInSupportZone
        ? 'support'
        : priceInResistanceZone
          ? 'resistance'
          : null;
      const priceInZone =
        priceInSupportZone == null && priceInResistanceZone == null
          ? null
          : Boolean(priceInSupportZone || priceInResistanceZone);
      const resistanceVolumeShare = safeDivide(
        nearestResistance?.volume ?? null,
        totalStructureVolume,
      );
      const supportVolumeShare = safeDivide(
        nearestSupport?.volume ?? null,
        totalStructureVolume,
      );
      const sweepState =
        nearestResistance == null && nearestSupport == null
          ? 'unknown'
          : nearestResistance != null &&
              candle.high > nearestResistance.upper &&
              candle.close < nearestResistance.level
            ? 'swept_high'
            : nearestSupport != null &&
                candle.low < nearestSupport.lower &&
                candle.close > nearestSupport.level
              ? 'swept_low'
              : nearestResistance != null &&
                  candle.close > nearestResistance.upper
                ? 'broken_high'
                : nearestSupport != null && candle.close < nearestSupport.lower
                  ? 'broken_low'
                  : 'none';
      const liquiditySide =
        sweepState === 'swept_high' || sweepState === 'broken_high'
          ? 'high'
          : sweepState === 'swept_low' || sweepState === 'broken_low'
            ? 'low'
            : null;
      const referenceZoneSide =
        liquiditySide === 'high'
          ? 'resistance'
          : liquiditySide === 'low'
            ? 'support'
            : null;
      const prior20High =
        prior20.length > 0
          ? Math.max(...prior20.map((item) => item.high))
          : null;
      const prior20Low =
        prior20.length > 0
          ? Math.min(...prior20.map((item) => item.low))
          : null;
      const sweepHigh20 =
        prior20High == null
          ? null
          : candle.high > prior20High && candle.close < prior20High;
      const sweepLow20 =
        prior20Low == null
          ? null
          : candle.low < prior20Low && candle.close > prior20Low;
      const closeBackInsideRange =
        sweepHigh20 == null && sweepLow20 == null
          ? null
          : Boolean(sweepHigh20 || sweepLow20);
      const stopRunDirection = sweepHigh20 ? 'up' : sweepLow20 ? 'down' : null;
      const sweepWickPct =
        stopRunDirection === 'up'
          ? upperWick
          : stopRunDirection === 'down'
            ? lowerWick
            : null;
      const recent3 = candlesHistory.slice(-3);
      const recent5 = candlesHistory.slice(-5);
      const closesAboveHighLevel3 =
        highLevel == null
          ? null
          : recent3.filter((item) => item.close > highLevel).length;
      const closesBelowLowLevel3 =
        lowLevel == null
          ? null
          : recent3.filter((item) => item.close < lowLevel).length;
      const failedAcceptanceBars =
        highLevel == null || lowLevel == null
          ? null
          : recent5.filter(
              (item) =>
                (item.high > highLevel && item.close <= highLevel) ||
                (item.low < lowLevel && item.close >= lowLevel),
            ).length;
      const acceptanceScore =
        closesAboveHighLevel3 == null || closesBelowLowLevel3 == null
          ? null
          : (closesAboveHighLevel3 - closesBelowLowLevel3) /
            Math.max(1, recent3.length);
      const breakoutBodyAtr = safeDivide(
        Math.abs(candle.close - candle.open),
        atr,
      );
      const srZones = buildSrZonesContext(
        structureWindow,
        candle.close,
        prevCandle?.close ?? null,
        atr,
      );
      const liquidityZones = buildLiquidityZonesContext(
        candlesHistory.slice(-180),
        candle.close,
        prevCandle?.close ?? null,
        atr,
      );
      const liquidityTails = buildLiquidityTailsContext(
        candlesHistory.slice(-180),
        candle.close,
        atr,
      );
      const structureZonesContext = buildStructureZonesContext(
        swingContext,
        pivotContext,
        candle.close,
        atr,
        structureWindow,
      );

      return {
        swing: swingContext,
        zones: {
          support: {
            level: nearestSupport?.level ?? null,
            lower: nearestSupport?.lower ?? null,
            upper: nearestSupport?.upper ?? null,
            touches: nearestSupport?.touches ?? null,
            ageBars: nearestSupport?.ageBars ?? null,
            volumeShare: supportVolumeShare,
            distanceAtr: safeDivide(
              nearestSupport == null
                ? null
                : candle.close - nearestSupport.level,
              atr,
            ),
          },
          resistance: {
            level: nearestResistance?.level ?? null,
            lower: nearestResistance?.lower ?? null,
            upper: nearestResistance?.upper ?? null,
            touches: nearestResistance?.touches ?? null,
            ageBars: nearestResistance?.ageBars ?? null,
            volumeShare: resistanceVolumeShare,
            distanceAtr: safeDivide(
              nearestResistance == null
                ? null
                : nearestResistance.level - candle.close,
              atr,
            ),
          },
          active: {
            side: activeZoneType,
            priceInZone,
          },
        },
        srZones,
        liquidity: {
          sweepState,
          side: liquiditySide,
          referenceZoneSide,
          sweepHigh20,
          sweepLow20,
          closeBackInsideRange,
          stopRunDirection,
          sweepWickPct,
        },
        liquidityZones,
        liquidityTails,
        structureZones: structureZonesContext,
        pivots: pivotContext,
        acceptance: {
          closesAboveHighLevel3,
          closesBelowLowLevel3,
          failedAcceptanceBars,
          acceptanceScore,
          breakoutBodyAtr,
        },
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
      } as BaseStrategyContextSnapshot['structure'];
    };

  const buildRegimeSnapshot = (): BaseStrategyContextSnapshot['regime'] => {
    const atrPctSeries = materializeNumericHistory(
      indicatorHistory.atrPct ?? createNumericHistoryBuffer(),
    );
    const macdHistogramSeries = materializeNumericHistory(
      indicatorHistory.macdHistogram ?? createNumericHistoryBuffer(),
    );
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
    const atrSlope = calculateLineSlope(atrPctSeries, 5);
    const compressionScore = safeDivide(
      toNullable(baseResult.atrPct),
      getLastFiniteValue(atrPctSeries.slice(0, -1)),
    );
    const expansionScore =
      compressionScore == null || compressionScore === 0
        ? null
        : 1 / compressionScore;
    const bbWidthPctSeries = calculateRecentBbWidthPctSeries(closeSeries, 100);
    const rawAtrPctSeries = calculateRecentAtrPctSeries(candlesHistory, 100);
    const rawAtrPct = safeDivide(atr, candle.close);
    const realizedVolatility = calculateRealizedVolatility(closeSeries);
    const realizedVolatilitySeries = calculateRecentRealizedVolatilitySeries(
      closeSeries,
      100,
    );
    const rangeExpansionSeries = calculateRecentRangeExpansionSeries(
      candlesHistory,
      20,
    );
    const rangeExpansion =
      rangeExpansionSeries[rangeExpansionSeries.length - 1] ?? null;
    const volatilityState =
      compressionScore == null
        ? 'unknown'
        : compressionScore <= 0.9
          ? 'compressed'
          : compressionScore >= 1.1
            ? 'expanded'
            : 'normal';
    const bodyStrength =
      highLowRange > 0
        ? Math.abs(candle.close - candle.open) / highLowRange
        : null;
    const closeLocationInRange =
      highLowRange > 0 ? (candle.close - candle.low) / highLowRange : null;
    const recentFalseBreakoutDensity =
      highLevel == null || lowLevel == null || recent20.length < 2
        ? null
        : recent20.reduce((count, item, index) => {
            if (index === 0) return count;
            const prevItem = recent20[index - 1];
            if (!prevItem) return count;
            if (prevItem.close > highLevel && item.close <= highLevel) {
              return count + 1;
            }
            if (prevItem.close < lowLevel && item.close >= lowLevel) {
              return count + 1;
            }
            return count;
          }, 0) /
          (recent20.length - 1);
    const adxContext =
      buildAdxContext(adxValue) ?? calculateAdxContext(candlesHistory);
    const rsiContext =
      buildRsiContext(rsiValue) ?? calculateRsiContext(closeSeries);
    const trendFollow = buildTrendFollowContext(
      candlesHistory.slice(-220),
      candle.close,
      atr,
    );
    const hl2Series =
      precomputedMaLayers === undefined
        ? candlesHistory.map((item) => (item.high + item.low) / 2)
        : [];
    const maLayers = buildMaLayersContext(hl2Series, precomputedMaLayers);
    const contextMa = buildContextMaContext(
      closeSeries,
      candle.close,
      atr,
      precomputedContextMa,
    );
    const adaptiveChannel = buildAdaptiveChannelContext(
      candlesHistory,
      candle.close,
      atr,
      precomputedAdaptiveChannel,
    );

    return {
      trend: {
        bias: trendBias,
        maStackScore,
        priceDistanceToMaFastAtr,
        priceDistanceToMaSlowAtr,
        persistence,
        adx: adxContext,
        maLayers,
        contextMa,
        adaptiveChannel,
        trendFollow,
        psar: precomputedPsar ?? {
          value: null,
          direction: 'unknown',
          rawBuySignal: null,
          rawSellSignal: null,
          buySignal: null,
          sellSignal: null,
          emaFilter: null,
          trendLongOk: null,
          trendShortOk: null,
          adxOk: null,
          candleLongOk: null,
          candleShortOk: null,
          cooldownOk: null,
          barsSinceSignal: null,
        },
      },
      volatility: {
        atrSlope,
        atrPctZScore,
        bbWidthPct,
        compressionScore,
        expansionScore,
        state: volatilityState,
        percentiles: {
          atrPctRank100: calculatePercentRank(rawAtrPctSeries, rawAtrPct, 100),
          bbWidthRank100: calculatePercentRank(
            bbWidthPctSeries,
            bbWidthPct,
            100,
          ),
          realizedVolRank100: calculatePercentRank(
            realizedVolatilitySeries,
            realizedVolatility,
            100,
          ),
          rangeExpansionRank20: calculatePercentRank(
            rangeExpansionSeries,
            rangeExpansion,
            20,
          ),
        },
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
        rsi: rsiContext.rsi,
        rsiState: rsiContext.rsiState,
        macdHistogramSlope: calculateLineSlope(macdHistogramSeries, 5),
        bodyStrength,
        closeLocationInRange,
        upCloseStreak: closeStreaks.up,
        downCloseStreak: closeStreaks.down,
      },
      session: buildSessionContext(candle.timestamp),
      memory: {
        recentFalseBreakoutDensity,
      },
    } as BaseStrategyContextSnapshot['regime'];
  };
  const buildParticipationSnapshot =
    (): BaseStrategyContextSnapshot['participation'] => {
      let cachedPriceVolumeProfile:
        | BaseStrategyContextSnapshot['participation']['priceVolumeProfile']
        | undefined;
      let cachedVolumeStructure:
        | BaseStrategyContextSnapshot['participation']['volumeStructure']
        | undefined;
      let cachedDelta:
        | BaseStrategyContextSnapshot['participation']['delta']
        | undefined;

      return {
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
        get priceVolumeProfile() {
          return (cachedPriceVolumeProfile ??= buildPriceVolumeProfileContext(
            structureWindow,
            candle.close,
            atr,
          ));
        },
        get volumeStructure() {
          return (cachedVolumeStructure ??= buildVolumeStructureContext(
            candlesHistory,
            candle.close,
            atr,
          ));
        },
        get delta() {
          return (cachedDelta ??= buildDeltaContext(
            structureWindow,
          ) as BaseStrategyContextSnapshot['participation']['delta']);
        },
      } as BaseStrategyContextSnapshot['participation'];
    };
  let cachedStructureSnapshot:
    | BaseStrategyContextSnapshot['structure']
    | undefined;
  let cachedRegimeSnapshot: BaseStrategyContextSnapshot['regime'] | undefined;
  let cachedParticipationSnapshot:
    | BaseStrategyContextSnapshot['participation']
    | undefined;
  let cachedRelativeSnapshot:
    | BaseStrategyContextSnapshot['relative']
    | undefined;
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
    get regime() {
      return (cachedRegimeSnapshot ??= buildRegimeSnapshot());
    },
    get structure() {
      return (cachedStructureSnapshot ??= buildStructureSnapshot());
    },
    get participation() {
      return (cachedParticipationSnapshot ??= buildParticipationSnapshot());
    },
    get relative() {
      return (cachedRelativeSnapshot ??= buildRelativeSnapshot());
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
          currentTrendBias: trendBias,
        });
      }

      return cachedMtfSnapshot;
    },
  });

  return snapshot as BaseStrategyContextSnapshot;
};
