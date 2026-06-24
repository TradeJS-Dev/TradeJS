import type {
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import { MarketFlushReversalConfig } from './config';
import { buildMarketFlushReversalFigures } from './figures';
import { getIndicatorsBaseContext } from '../shared/baseContext';
import {
  buildAtrFallbackStop,
  buildContextRiskOrder,
  isDirectionAligned,
  isOpenPosition,
  isPressureAligned,
  resolveAtrBuffer,
  toFiniteNumberOrNull,
} from '../shared/contextStrategy';

export interface MarketFlushReversalSignalContext {
  signalDirection: Direction;
  marketPressure: string | null;
  marketRiskFlags: string[];
  marketLiqSpikeRatio: number | null;
  marketLiqImbalance: number | null;
  marketFundingZScore: number | null;
  marketPriceOiDivergenceType: string | null;
  marketFlushConfirmed: boolean;
  minMarketLiqSpikeRatio: number;
  sweepState: string | null;
  breakoutState: string | null;
  tailSide: string | null;
  rangePosition20: number | null;
  sweepWickPct: number | null;
  volumeRel20: number | null;
  buyPressurePct: number | null;
  deltaDivergenceVsPrice: string | null;
  structureConfirmed: boolean;
  participationConfirmed: boolean;
}

const getMarketRiskFlags = (baseContext: BaseStrategyContextSnapshot) =>
  Array.isArray(baseContext.derivatives?.summary?.riskFlags)
    ? baseContext.derivatives.summary.riskFlags
    : [];

const maxFinite = (...values: Array<number | null | undefined>) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  return finite.length ? Math.max(...finite) : null;
};

const selectDirectionalImbalance = (
  direction: Direction,
  ...values: Array<number | null | undefined>
) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  if (!finite.length) return null;
  return direction === 'LONG' ? Math.min(...finite) : Math.max(...finite);
};

const getMarketPressure = (baseContext: BaseStrategyContextSnapshot) =>
  baseContext.derivatives?.summary?.pressure ?? null;

const getMarketIntervals = (baseContext: BaseStrategyContextSnapshot) =>
  baseContext.derivatives?.intervals;

const getMarketLiqSpikeRatio = (baseContext: BaseStrategyContextSnapshot) => {
  const intervals = getMarketIntervals(baseContext);
  return maxFinite(
    intervals?.['15m']?.liqSpikeRatio,
    intervals?.['1h']?.liqSpikeRatio,
  );
};

const getDirectionalMarketImbalance = (
  baseContext: BaseStrategyContextSnapshot,
  direction: Direction,
) => {
  const intervals = getMarketIntervals(baseContext);
  return selectDirectionalImbalance(
    direction,
    intervals?.['15m']?.liqImbalance,
    intervals?.['1h']?.liqImbalance,
  );
};

const getMarketFundingZScore = (baseContext: BaseStrategyContextSnapshot) => {
  const intervals = getMarketIntervals(baseContext);
  return maxFinite(
    intervals?.['15m']?.fundingZScore,
    intervals?.['1h']?.fundingZScore,
  );
};

const getMarketPriceOiDivergenceType = (
  baseContext: BaseStrategyContextSnapshot,
) => baseContext.derivatives?.summary?.priceOiDivergenceType ?? null;

const hasBlockingMarketContext = (baseContext: BaseStrategyContextSnapshot) => {
  const riskFlags = getMarketRiskFlags(baseContext);
  return (
    riskFlags.includes('missing_derivatives') ||
    riskFlags.includes('stale_derivatives')
  );
};

const getMarketFlushDirection = ({
  baseContext,
  minSpike,
}: {
  baseContext: BaseStrategyContextSnapshot;
  minSpike: number;
}): Direction | null => {
  const pressure = getMarketPressure(baseContext);
  const riskFlags = getMarketRiskFlags(baseContext);
  const liqSpikeRatio = getMarketLiqSpikeRatio(baseContext);
  const longImbalance = getDirectionalMarketImbalance(baseContext, 'LONG');
  const shortImbalance = getDirectionalMarketImbalance(baseContext, 'SHORT');

  const longFlush =
    pressure === 'long_flush' ||
    riskFlags.includes('long_liquidation_spike') ||
    (liqSpikeRatio != null &&
      liqSpikeRatio >= minSpike &&
      longImbalance != null &&
      longImbalance <= -0.35);
  const shortFlush =
    pressure === 'short_flush' ||
    riskFlags.includes('short_liquidation_spike') ||
    (liqSpikeRatio != null &&
      liqSpikeRatio >= minSpike &&
      shortImbalance != null &&
      shortImbalance >= 0.35);

  if (longFlush === shortFlush || hasBlockingMarketContext(baseContext)) {
    return null;
  }

  return longFlush ? 'LONG' : 'SHORT';
};

const getLocalStructureCandidate = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: MarketFlushReversalConfig;
}): Direction | null => {
  const localRange = baseContext.structure?.localRange;
  const liquidity = baseContext.structure?.liquidity;
  const currentTail = baseContext.structure?.liquidityTails?.currentTail;
  const rangePosition20 = toFiniteNumberOrNull(localRange?.rangePosition20);
  const sweepWickPct = toFiniteNumberOrNull(liquidity?.sweepWickPct);
  const minSweepWickPct = Number(config.MFR_MIN_SWEEP_WICK_PCT ?? 0.2);
  const buyPressurePct = toFiniteNumberOrNull(
    baseContext.participation?.delta?.buyPressurePct,
  );
  const deltaDivergenceVsPrice =
    baseContext.participation?.delta?.deltaDivergenceVsPrice ?? null;
  const candle = baseContext.candle;
  const candleReversal =
    candle.close === candle.open
      ? null
      : candle.close > candle.open
        ? 'LONG'
        : 'SHORT';
  const wickOk =
    sweepWickPct == null ||
    sweepWickPct >= minSweepWickPct ||
    currentTail?.side != null;
  const longRange =
    rangePosition20 != null &&
    rangePosition20 <= Number(config.MFR_MAX_LONG_RANGE_POSITION ?? 0.45);
  const shortRange =
    rangePosition20 != null &&
    rangePosition20 >= Number(config.MFR_MIN_SHORT_RANGE_POSITION ?? 0.55);
  const longPrimary =
    liquidity?.sweepState === 'swept_low' ||
    localRange?.breakoutState === 'failed_low_breakout';
  const shortPrimary =
    liquidity?.sweepState === 'swept_high' ||
    localRange?.breakoutState === 'failed_high_breakout';
  const longPressure =
    isPressureAligned({ direction: 'LONG', buyPressurePct }) === true ||
    deltaDivergenceVsPrice === 'bullish' ||
    candleReversal === 'LONG';
  const shortPressure =
    isPressureAligned({ direction: 'SHORT', buyPressurePct }) === true ||
    deltaDivergenceVsPrice === 'bearish' ||
    candleReversal === 'SHORT';
  const longScore = wickOk && longPressure && longPrimary && longRange ? 3 : 0;
  const shortScore =
    wickOk && shortPressure && shortPrimary && shortRange ? 3 : 0;

  if (longScore <= 0 && shortScore <= 0) return null;
  if (longScore === shortScore) return null;
  return longScore > shortScore ? 'LONG' : 'SHORT';
};

const detectSignal = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: MarketFlushReversalConfig;
}): MarketFlushReversalSignalContext | null => {
  const direction = getLocalStructureCandidate({ baseContext, config });
  if (!direction) return null;

  const localRange = baseContext.structure?.localRange;
  const liquidity = baseContext.structure?.liquidity;
  const currentTail = baseContext.structure?.liquidityTails?.currentTail;
  const volume = baseContext.participation?.volume;
  const delta = baseContext.participation?.delta;
  const minMarketLiqSpikeRatio = Number(
    config.MFR_MIN_MARKET_LIQ_SPIKE_RATIO ?? 2,
  );
  const marketRiskFlags = getMarketRiskFlags(baseContext);
  const marketLiqSpikeRatio = getMarketLiqSpikeRatio(baseContext);
  const marketLiqImbalance = getDirectionalMarketImbalance(
    baseContext,
    direction,
  );
  const marketFundingZScore = getMarketFundingZScore(baseContext);
  const marketFlushDirection = getMarketFlushDirection({
    baseContext,
    minSpike: minMarketLiqSpikeRatio,
  });
  const rangePosition20 =
    toFiniteNumberOrNull(localRange?.rangePosition20) ?? null;
  const sweepWickPct = toFiniteNumberOrNull(liquidity?.sweepWickPct);
  const minSweepWickPct = Number(config.MFR_MIN_SWEEP_WICK_PCT ?? 0.2);
  const primaryStructure =
    direction === 'LONG'
      ? liquidity?.sweepState === 'swept_low' ||
        localRange?.breakoutState === 'failed_low_breakout' ||
        currentTail?.side === 'lower'
      : liquidity?.sweepState === 'swept_high' ||
        localRange?.breakoutState === 'failed_high_breakout' ||
        currentTail?.side === 'upper';
  const rangeLocation =
    rangePosition20 == null
      ? false
      : direction === 'LONG'
        ? rangePosition20 <= Number(config.MFR_MAX_LONG_RANGE_POSITION ?? 0.45)
        : rangePosition20 >=
          Number(config.MFR_MIN_SHORT_RANGE_POSITION ?? 0.55);
  const wickOk =
    sweepWickPct == null ||
    sweepWickPct >= minSweepWickPct ||
    currentTail?.side != null;
  const structureConfirmed = Boolean(
    (primaryStructure || rangeLocation) && wickOk,
  );
  if (!structureConfirmed) return null;

  const volumeRel20 = toFiniteNumberOrNull(volume?.volumeRel20);
  if (
    volumeRel20 != null &&
    volumeRel20 < Number(config.MFR_MIN_VOLUME_REL20 ?? 1.1)
  ) {
    return null;
  }

  const buyPressurePct = toFiniteNumberOrNull(delta?.buyPressurePct);
  const deltaAligned = isPressureAligned({
    direction,
    buyPressurePct,
  });
  const deltaDivergenceVsPrice = delta?.deltaDivergenceVsPrice ?? null;
  const divergenceAligned =
    direction === 'LONG'
      ? deltaDivergenceVsPrice === 'bullish'
      : deltaDivergenceVsPrice === 'bearish';
  const participationConfirmed =
    volumeRel20 == null ||
    volumeRel20 >= Number(config.MFR_MIN_VOLUME_REL20 ?? 1.1) ||
    deltaAligned === true ||
    divergenceAligned;
  if (!participationConfirmed) return null;

  return {
    signalDirection: direction,
    marketPressure: getMarketPressure(baseContext),
    marketRiskFlags,
    marketLiqSpikeRatio,
    marketLiqImbalance,
    marketFundingZScore,
    marketPriceOiDivergenceType: getMarketPriceOiDivergenceType(baseContext),
    marketFlushConfirmed: marketFlushDirection === direction,
    minMarketLiqSpikeRatio,
    sweepState: liquidity?.sweepState ?? null,
    breakoutState: localRange?.breakoutState ?? null,
    tailSide: currentTail?.side ?? null,
    rangePosition20,
    sweepWickPct,
    volumeRel20,
    buyPressurePct,
    deltaDivergenceVsPrice,
    structureConfirmed,
    participationConfirmed,
  };
};

const buildStopLoss = ({
  baseContext,
  direction,
  currentPrice,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  direction: Direction;
  currentPrice: number;
  config: MarketFlushReversalConfig;
}) => {
  const atr = baseContext.raw?.volatility?.atr ?? null;
  const buffer = resolveAtrBuffer({
    atr,
    currentPrice,
    atrMult: Number(config.MFR_STOP_ATR_BUFFER_MULT ?? 0.25),
    bufferPct: Number(config.MFR_STOP_BUFFER_PCT ?? 0.05),
  });
  const candle = baseContext.candle;
  const support = baseContext.structure?.zones?.support;
  const resistance = baseContext.structure?.zones?.resistance;
  const candidates =
    direction === 'LONG'
      ? [candle.low, support?.lower, baseContext.raw?.levels?.lowLevel]
          .map(toFiniteNumberOrNull)
          .filter(
            (value): value is number => value != null && value < currentPrice,
          )
      : [candle.high, resistance?.upper, baseContext.raw?.levels?.highLevel]
          .map(toFiniteNumberOrNull)
          .filter(
            (value): value is number => value != null && value > currentPrice,
          );

  if (candidates.length) {
    return direction === 'LONG'
      ? Math.min(...candidates) - buffer
      : Math.max(...candidates) + buffer;
  }

  return buildAtrFallbackStop({
    direction,
    currentPrice,
    atr,
    atrMult: Number(config.MFR_FALLBACK_STOP_ATR_MULT ?? 1.4),
    bufferPct: Number(config.MFR_STOP_BUFFER_PCT ?? 0.05),
  });
};

export const createMarketFlushReversalCore: CreateStrategyCore<
  MarketFlushReversalConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi, indicatorsState }) => {
  const lastTradeController = strategyApi.createLastTradeController();

  return async () => {
    indicatorsState.onBar();
    const indicators = indicatorsState.snapshot();
    const baseContext = getIndicatorsBaseContext(indicators);
    if (!baseContext) {
      return strategyApi.skip('NO_BASE_CONTEXT');
    }

    const signal = detectSignal({ baseContext, config });
    const position = await strategyApi.getCurrentPosition();

    if (isOpenPosition(position)) {
      const oppositeSignal =
        signal != null &&
        isDirectionAligned({
          direction: position.direction,
          bullValue: 'SHORT',
          bearValue: 'LONG',
          value: signal.signalDirection,
        });

      if (Boolean(config.MFR_EXIT_ON_OPPOSITE_SIGNAL) && oppositeSignal) {
        return strategyApi.exit({
          code: 'MFR_OPPOSITE_FLUSH_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (!signal) {
      return strategyApi.skip('NO_MARKET_FLUSH_REVERSAL');
    }

    if (lastTradeController.isInCooldown(baseContext.candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig =
      signal.signalDirection === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } = await strategyApi.getMarketData();
    const stopLossPrice = buildStopLoss({
      baseContext,
      direction: modeConfig.direction,
      currentPrice,
      config,
    });
    const riskOrder = buildContextRiskOrder({
      currentPrice,
      direction: modeConfig.direction,
      stopLossPrice,
      targetR: Number(config.MFR_TARGET_R_MULT ?? 2.2),
      maxLossValue: Number(config.MAX_LOSS_VALUE ?? 0),
      feePercent: Number(config.FEE_PERCENT ?? 0),
      minRiskRatio: modeConfig.minRiskRatio,
    });

    if (riskOrder.skipCode || !riskOrder.plan) {
      return strategyApi.skip(riskOrder.skipCode ?? 'INVALID_RISK_PLAN');
    }
    const riskPlan = riskOrder.plan;

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        modeConfig.direction === 'LONG'
          ? 'MFR_LONG_FLUSH_REVERSAL'
          : 'MFR_SHORT_FLUSH_REVERSAL',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        marketFlushReversalContext: signal,
      },
      figures: buildMarketFlushReversalFigures({
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice: riskPlan.takeProfitPrice,
        referenceTimestamp: baseContext.candle.timestamp,
        referencePrice:
          modeConfig.direction === 'LONG'
            ? baseContext.raw?.levels?.lowLevel
            : baseContext.raw?.levels?.highLevel,
      }),
      orderPlan: {
        qty: riskPlan.qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: riskPlan.takeProfitPrice }],
      },
    });
  };
};
