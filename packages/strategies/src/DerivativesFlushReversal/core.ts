import type {
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import { DerivativesFlushReversalConfig } from './config';
import { buildDerivativesFlushReversalFigures } from './figures';
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

export interface DerivativesFlushReversalSignalContext {
  signalDirection: Direction;
  signalSource: 'derivatives' | 'structure';
  pressure: string | null;
  riskFlags: string[];
  liqSpikeRatio: number | null;
  liqImbalance: number | null;
  fundingZScore: number | null;
  priceOiDivergenceType: string | null;
  sweepState: string | null;
  breakoutState: string | null;
  tailSide: string | null;
  rangePosition20: number | null;
  volumeRel20: number | null;
  buyPressurePct: number | null;
  deltaDivergenceVsPrice: string | null;
  structureConfirmed: boolean;
  participationConfirmed: boolean;
}

type FlushCandidate = {
  direction: Direction;
  source: DerivativesFlushReversalSignalContext['signalSource'];
};

const getRiskFlags = (baseContext: BaseStrategyContextSnapshot) =>
  Array.isArray(baseContext.derivatives?.targetDerived?.riskFlags)
    ? baseContext.derivatives.targetDerived.riskFlags
    : Array.isArray(baseContext.derivatives?.summary?.riskFlags)
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

const getDerivativesPressure = (baseContext: BaseStrategyContextSnapshot) =>
  baseContext.derivatives?.targetDerived?.pressure ??
  baseContext.derivatives?.summary?.pressure ??
  null;

const getDerivativesIntervals = (baseContext: BaseStrategyContextSnapshot) =>
  baseContext.derivatives?.targetContext?.intervals ??
  baseContext.derivatives?.intervals;

const getDerivativesLiqSpikeRatio = (
  baseContext: BaseStrategyContextSnapshot,
) => {
  const intervals = getDerivativesIntervals(baseContext);
  return maxFinite(
    baseContext.derivatives?.targetDerived?.liqSpikeRatio,
    intervals?.['15m']?.liqSpikeRatio,
    intervals?.['1h']?.liqSpikeRatio,
  );
};

const getDirectionalDerivativesImbalance = (
  baseContext: BaseStrategyContextSnapshot,
  direction: Direction,
) => {
  const intervals = getDerivativesIntervals(baseContext);
  return selectDirectionalImbalance(
    direction,
    baseContext.derivatives?.targetDerived?.liqImbalance,
    intervals?.['15m']?.liqImbalance,
    intervals?.['1h']?.liqImbalance,
  );
};

const getDerivativesFundingZScore = (
  baseContext: BaseStrategyContextSnapshot,
) => {
  const intervals = getDerivativesIntervals(baseContext);
  return maxFinite(
    baseContext.derivatives?.targetDerived?.fundingZScore,
    intervals?.['15m']?.fundingZScore,
    intervals?.['1h']?.fundingZScore,
  );
};

const getDerivativesPriceOiDivergenceType = (
  baseContext: BaseStrategyContextSnapshot,
) =>
  baseContext.derivatives?.targetContext?.summary?.priceOiDivergenceType ??
  baseContext.derivatives?.summary?.priceOiDivergenceType ??
  null;

const hasBlockingDerivativesContext = (
  baseContext: BaseStrategyContextSnapshot,
) => {
  const riskFlags = getRiskFlags(baseContext);
  return (
    riskFlags.includes('missing_derivatives') ||
    riskFlags.includes('stale_derivatives')
  );
};

const getStructureFallbackCandidate = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: DerivativesFlushReversalConfig;
}): Direction | null => {
  const localRange = baseContext.structure?.localRange;
  const liquidity = baseContext.structure?.liquidity;
  const currentTail = baseContext.structure?.liquidityTails?.currentTail;
  const rangePosition20 = toFiniteNumberOrNull(localRange?.rangePosition20);
  const sweepWickPct = toFiniteNumberOrNull(liquidity?.sweepWickPct);
  const minSweepWickPct = Number(config.DFR_MIN_SWEEP_WICK_PCT ?? 0.2);
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
    rangePosition20 <= Number(config.DFR_MAX_LONG_RANGE_POSITION ?? 0.45);
  const shortRange =
    rangePosition20 != null &&
    rangePosition20 >= Number(config.DFR_MIN_SHORT_RANGE_POSITION ?? 0.55);
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

const getFlushCandidate = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: DerivativesFlushReversalConfig;
}): FlushCandidate | null => {
  const pressure = getDerivativesPressure(baseContext);
  const riskFlags = getRiskFlags(baseContext);
  const liqSpikeRatio = getDerivativesLiqSpikeRatio(baseContext);
  const minSpike = Number(config.DFR_MIN_LIQ_SPIKE_RATIO ?? 2);
  const longImbalance = getDirectionalDerivativesImbalance(baseContext, 'LONG');
  const shortImbalance = getDirectionalDerivativesImbalance(
    baseContext,
    'SHORT',
  );

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

  if (longFlush !== shortFlush && !hasBlockingDerivativesContext(baseContext)) {
    return {
      direction: longFlush ? 'LONG' : 'SHORT',
      source: 'derivatives',
    };
  }

  const fallbackDirection = getStructureFallbackCandidate({
    baseContext,
    config,
  });
  return fallbackDirection
    ? { direction: fallbackDirection, source: 'structure' }
    : null;
};

const detectSignal = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: DerivativesFlushReversalConfig;
}): DerivativesFlushReversalSignalContext | null => {
  const candidate = getFlushCandidate({ baseContext, config });
  if (!candidate) return null;
  const { direction } = candidate;

  const localRange = baseContext.structure?.localRange;
  const liquidity = baseContext.structure?.liquidity;
  const currentTail = baseContext.structure?.liquidityTails?.currentTail;
  const volume = baseContext.participation?.volume;
  const delta = baseContext.participation?.delta;
  const riskFlags = getRiskFlags(baseContext);
  const liqSpikeRatio = getDerivativesLiqSpikeRatio(baseContext);
  const liqImbalance = getDirectionalDerivativesImbalance(
    baseContext,
    direction,
  );
  const fundingZScore = getDerivativesFundingZScore(baseContext);
  const rangePosition20 =
    toFiniteNumberOrNull(localRange?.rangePosition20) ?? null;
  const sweepWickPct = toFiniteNumberOrNull(liquidity?.sweepWickPct);
  const minSweepWickPct = Number(config.DFR_MIN_SWEEP_WICK_PCT ?? 0.2);
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
        ? rangePosition20 <= Number(config.DFR_MAX_LONG_RANGE_POSITION ?? 0.45)
        : rangePosition20 >=
          Number(config.DFR_MIN_SHORT_RANGE_POSITION ?? 0.55);
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
    volumeRel20 < Number(config.DFR_MIN_VOLUME_REL20 ?? 1.1)
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
    volumeRel20 >= Number(config.DFR_MIN_VOLUME_REL20 ?? 1.1) ||
    deltaAligned === true ||
    divergenceAligned;
  if (candidate.source === 'structure' && !participationConfirmed) {
    return null;
  }

  return {
    signalDirection: direction,
    signalSource: candidate.source,
    pressure: getDerivativesPressure(baseContext),
    riskFlags,
    liqSpikeRatio,
    liqImbalance,
    fundingZScore,
    priceOiDivergenceType: getDerivativesPriceOiDivergenceType(baseContext),
    sweepState: liquidity?.sweepState ?? null,
    breakoutState: localRange?.breakoutState ?? null,
    tailSide: currentTail?.side ?? null,
    rangePosition20,
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
  config: DerivativesFlushReversalConfig;
}) => {
  const atr = baseContext.raw?.volatility?.atr ?? null;
  const buffer = resolveAtrBuffer({
    atr,
    currentPrice,
    atrMult: Number(config.DFR_STOP_ATR_BUFFER_MULT ?? 0.25),
    bufferPct: Number(config.DFR_STOP_BUFFER_PCT ?? 0.05),
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
    atrMult: Number(config.DFR_FALLBACK_STOP_ATR_MULT ?? 1.4),
    bufferPct: Number(config.DFR_STOP_BUFFER_PCT ?? 0.05),
  });
};

export const createDerivativesFlushReversalCore: CreateStrategyCore<
  DerivativesFlushReversalConfig,
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

      if (Boolean(config.DFR_EXIT_ON_OPPOSITE_SIGNAL) && oppositeSignal) {
        return strategyApi.exit({
          code: 'DFR_OPPOSITE_FLUSH_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (!signal) {
      return strategyApi.skip('NO_DERIVATIVES_FLUSH_REVERSAL');
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
      targetR: Number(config.DFR_TARGET_R_MULT ?? 2.2),
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
          ? 'DFR_LONG_FLUSH_REVERSAL'
          : 'DFR_SHORT_FLUSH_REVERSAL',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        derivativesFlushReversalContext: signal,
      },
      figures: buildDerivativesFlushReversalFigures({
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
