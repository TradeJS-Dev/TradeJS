import type {
  BaseStrategyContextSnapshot,
  Candle,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import { MarketFlushReversalConfig } from './config';
import { createMarketFlushReversalEntryEngine } from './engine';
import { buildMarketFlushReversalFigures } from './figures';
import { getMarketFlushReversalEntryFilterSkipCode } from './filters';
import type {
  MarketFlushReversalEntryCandidate,
  MarketFlushReversalSignalContext,
} from './contracts';
export type { MarketFlushReversalSignalContext } from './contracts';
import {
  buildAtrFallbackStop,
  buildContextRiskOrder,
  isDirectionAligned,
  isOpenPosition,
  isPressureAligned,
  resolveAtrBuffer,
  toFiniteNumberOrNull,
} from '../shared/contextStrategy';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';
import {
  getMarketFlushReversalLongReboundPocketFeatures,
  isMarketFlushReversalCalibratedLongReboundPocket,
} from './pockets';

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

const getDirectionalClosePosition = (
  baseContext: BaseStrategyContextSnapshot,
  direction: Direction,
) => {
  const { high, low, close } = baseContext.candle;
  const range = Number(high) - Number(low);
  if (!Number.isFinite(range) || range <= 0) return null;
  const closePosition = (Number(close) - Number(low)) / range;
  if (!Number.isFinite(closePosition)) return null;
  return direction === 'LONG' ? closePosition : 1 - closePosition;
};

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

export const detectMarketFlushReversalSignal = ({
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
  const marketFlushConfirmed = marketFlushDirection === direction;
  if (
    Boolean(config.MFR_REQUIRE_MARKET_FLUSH_CONFIRMATION ?? false) &&
    !marketFlushConfirmed
  ) {
    return null;
  }
  const rejectionClosePosition = getDirectionalClosePosition(
    baseContext,
    direction,
  );
  const atr = toFiniteNumberOrNull(baseContext.raw?.volatility?.atr);
  const candleBody = Math.abs(
    Number(baseContext.candle.close) - Number(baseContext.candle.open),
  );
  const rejectionBodyAtr =
    atr != null && atr > 0 && Number.isFinite(candleBody)
      ? candleBody / atr
      : null;
  const minRejectionClosePosition = resolveDirectionalConfigNumber({
    config,
    key: 'MFR_MIN_REJECTION_CLOSE_POSITION',
    direction,
    fallback: 0.6,
  });
  const minRejectionBodyAtr = resolveDirectionalConfigNumber({
    config,
    key: 'MFR_MIN_REJECTION_BODY_ATR',
    direction,
    fallback: 0,
  });
  const rejectionConfirmed =
    rejectionClosePosition != null &&
    rejectionClosePosition >= minRejectionClosePosition &&
    (minRejectionBodyAtr <= 0 ||
      (rejectionBodyAtr != null && rejectionBodyAtr >= minRejectionBodyAtr));
  if (!rejectionConfirmed) return null;
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
    marketFlushConfirmed,
    minMarketLiqSpikeRatio,
    rejectionClosePosition,
    rejectionBodyAtr,
    rejectionConfirmed,
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

const buildStopGeometry = ({
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
  const setupSweepExtremePrice = toFiniteNumberOrNull(
    direction === 'LONG' ? candle.low : candle.high,
  );
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
    const setupStopAnchorPrice =
      direction === 'LONG' ? Math.min(...candidates) : Math.max(...candidates);
    return {
      stopLossPrice:
        direction === 'LONG'
          ? setupStopAnchorPrice - buffer
          : setupStopAnchorPrice + buffer,
      setupSweepExtremePrice,
      setupStopAnchorPrice,
    };
  }

  return {
    stopLossPrice: buildAtrFallbackStop({
      direction,
      currentPrice,
      atr,
      atrMult: Number(config.MFR_FALLBACK_STOP_ATR_MULT ?? 1.4),
      bufferPct: Number(config.MFR_STOP_BUFFER_PCT ?? 0.05),
    }),
    setupSweepExtremePrice,
    setupStopAnchorPrice: null,
  };
};

const getEntryReferencePrice = ({
  baseContext,
  direction,
}: {
  baseContext: BaseStrategyContextSnapshot;
  direction: Direction;
}) => {
  const candle = baseContext.candle;
  const level =
    direction === 'LONG'
      ? baseContext.raw?.levels?.lowLevel
      : baseContext.raw?.levels?.highLevel;
  return (
    toFiniteNumberOrNull(level) ??
    toFiniteNumberOrNull(direction === 'LONG' ? candle.low : candle.high)
  );
};

const buildLegacyEntryStateKey = (config: MarketFlushReversalConfig) =>
  JSON.stringify({
    entryMode: config.MFR_ENTRY_MODE,
    confirmationBars: config.MFR_CONFIRMATION_BARS,
    confirmationBarsLong: config.MFR_CONFIRMATION_BARS_LONG,
    confirmationBarsShort: config.MFR_CONFIRMATION_BARS_SHORT,
    pendingMaxBars: config.MFR_PENDING_MAX_BARS,
    requireDirectionalBody: config.MFR_REQUIRE_DIRECTIONAL_CONFIRMATION_BODY,
    stopAtrBufferMult: config.MFR_STOP_ATR_BUFFER_MULT,
    stopBufferPct: config.MFR_STOP_BUFFER_PCT,
    fallbackStopAtrMult: config.MFR_FALLBACK_STOP_ATR_MULT,
  });

const buildEntryStateKey = (config: MarketFlushReversalConfig) =>
  Boolean(config.MFR_USE_FROZEN_PENDING_STOP)
    ? JSON.stringify(config)
    : buildLegacyEntryStateKey(config);

export const createMarketFlushReversalCore: CreateStrategyCore<
  MarketFlushReversalConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi }) => {
  const entryState = strategyApi.createStateController<
    { engine: ReturnType<typeof createMarketFlushReversalEntryEngine> },
    ReturnType<ReturnType<typeof createMarketFlushReversalEntryEngine>['next']>,
    ReturnType<
      ReturnType<typeof createMarketFlushReversalEntryEngine>['getState']
    >
  >(
    'MarketFlushReversalEntry',
    () => ({
      engine: createMarketFlushReversalEntryEngine({ config }),
    }),
    {
      configKey: buildEntryStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const lastTradeController = strategyApi.createLastTradeController({
    enabled: true,
  });
  const nextEntryState = (
    candle: Candle,
    candidate: MarketFlushReversalEntryCandidate | null,
  ) =>
    entryState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next({ candle, candidate }),
    );

  return async (candle) => {
    const baseContext = strategyApi.getBaseContext();
    if (!baseContext) {
      return strategyApi.skip('NO_BASE_CONTEXT');
    }

    const signal = detectMarketFlushReversalSignal({ baseContext, config });
    const position = await strategyApi.getCurrentPosition();

    if (isOpenPosition(position)) {
      nextEntryState(candle, null);
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

    let candidate: MarketFlushReversalEntryCandidate | null = null;
    let candidateSkipCode = 'NO_MARKET_FLUSH_REVERSAL';
    if (signal) {
      const setupModeConfig =
        signal.signalDirection === 'LONG' ? config.LONG : config.SHORT;
      if (lastTradeController.isInCooldown(baseContext.candle.timestamp)) {
        candidateSkipCode = 'DEV_TRADE_COOLDOWN';
      } else if (!setupModeConfig.enable) {
        candidateSkipCode = 'STRATEGY_DISABLED';
      } else if (
        Boolean(config.MFR_REQUIRE_CALIBRATED_LONG_REBOUND_POCKET) &&
        signal.signalDirection === 'LONG' &&
        !isMarketFlushReversalCalibratedLongReboundPocket({
          direction: signal.signalDirection,
          ...getMarketFlushReversalLongReboundPocketFeatures(baseContext),
        })
      ) {
        candidateSkipCode = 'MFR_LONG_REBOUND_POCKET_MISSING';
      } else {
        const setupPrice = toFiniteNumberOrNull(baseContext.candle.close);
        const atr = toFiniteNumberOrNull(baseContext.raw?.volatility?.atr);
        const referencePrice = getEntryReferencePrice({
          baseContext,
          direction: signal.signalDirection,
        });
        if (
          setupPrice != null &&
          atr != null &&
          atr > 0 &&
          referencePrice != null
        ) {
          const stopGeometry = buildStopGeometry({
            baseContext,
            direction: signal.signalDirection,
            currentPrice: setupPrice,
            config,
          });
          candidate = {
            direction: signal.signalDirection,
            setupTimestamp: baseContext.candle.timestamp,
            setupPrice,
            referencePrice,
            atr,
            stopLossPrice: stopGeometry.stopLossPrice,
            ...(Boolean(config.MFR_USE_FROZEN_PENDING_STOP)
              ? {
                  setupSweepExtremePrice: stopGeometry.setupSweepExtremePrice,
                  setupStopAnchorPrice: stopGeometry.setupStopAnchorPrice,
                }
              : {}),
            context: signal,
          };
        } else {
          candidateSkipCode = 'MFR_INVALID_PENDING_SETUP';
        }
      }
    }

    const entryRuntime = nextEntryState(candle, candidate);
    const entrySignal = entryRuntime.signal;
    if (!entrySignal) {
      return strategyApi.skip(
        entryRuntime.pending ? 'MFR_ENTRY_PENDING' : candidateSkipCode,
      );
    }

    if (lastTradeController.isInCooldown(baseContext.candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig =
      entrySignal.direction === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) return strategyApi.skip('STRATEGY_DISABLED');

    const entryFilterSkipCode = getMarketFlushReversalEntryFilterSkipCode({
      config,
      entrySignal,
      baseContext,
    });
    if (entryFilterSkipCode) {
      return strategyApi.skip(entryFilterSkipCode);
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const confirmationStopGeometry = buildStopGeometry({
      baseContext,
      direction: entrySignal.direction,
      currentPrice,
      config,
    });
    const useFrozenPendingStop =
      Boolean(config.MFR_USE_FROZEN_PENDING_STOP) &&
      entrySignal.entryMode === 'confirmation';
    const stopLossPrice = useFrozenPendingStop
      ? entrySignal.stopLossPrice
      : confirmationStopGeometry.stopLossPrice;
    const riskOrder = buildContextRiskOrder({
      currentPrice,
      direction: modeConfig.direction,
      stopLossPrice,
      targetR: Number(config.MFR_TARGET_R_MULT ?? 2.2),
      maxLossValue: Number(config.MAX_LOSS_VALUE ?? 0),
      feeRate: Number(config.FEE_PERCENT ?? 0),
      slippageBps:
        Number(config.SLIPPAGE_BASE_BPS ?? 0) +
        Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0),
      minRiskRatio: modeConfig.minRiskRatio,
    });

    if (riskOrder.skipCode || !riskOrder.plan) {
      return strategyApi.skip(riskOrder.skipCode ?? 'INVALID_RISK_PLAN');
    }
    const riskPlan = riskOrder.plan;
    const { indicators } = strategyApi.getCurrentIndicatorsContext();
    const signalContext: MarketFlushReversalSignalContext = {
      ...entrySignal.context,
      entryMode: entrySignal.entryMode,
      setupTimestamp: entrySignal.setupTimestamp,
      entryDelayBars: entrySignal.entryDelayBars,
      priceImprovementAtr: entrySignal.priceImprovementAtr,
      ...(useFrozenPendingStop
        ? {
            pendingStopSource: 'frozen_setup' as const,
            setupSweepExtremePrice: entrySignal.setupSweepExtremePrice ?? null,
            setupStopAnchorPrice: entrySignal.setupStopAnchorPrice ?? null,
            setupStopLossPrice: entrySignal.stopLossPrice,
            confirmationStopLossPrice: confirmationStopGeometry.stopLossPrice,
            selectedStopLossPrice: stopLossPrice,
            setupStopDistanceAtr:
              entrySignal.atr > 0
                ? Math.abs(currentPrice - entrySignal.stopLossPrice) /
                  entrySignal.atr
                : null,
            confirmationStopDistanceAtr:
              entrySignal.atr > 0
                ? Math.abs(
                    currentPrice - confirmationStopGeometry.stopLossPrice,
                  ) / entrySignal.atr
                : null,
            stopDistanceDeltaAtr:
              entrySignal.atr > 0
                ? (Math.abs(currentPrice - entrySignal.stopLossPrice) -
                    Math.abs(
                      currentPrice - confirmationStopGeometry.stopLossPrice,
                    )) /
                  entrySignal.atr
                : null,
          }
        : {}),
    };

    lastTradeController.markTrade(timestamp);

    const baseEntryCode =
      modeConfig.direction === 'LONG'
        ? 'MFR_LONG_FLUSH_REVERSAL'
        : 'MFR_SHORT_FLUSH_REVERSAL';
    return strategyApi.entry({
      code:
        entrySignal.entryMode === 'immediate'
          ? baseEntryCode
          : `${baseEntryCode}_CONFIRMATION`,
      direction: modeConfig.direction,
      indicators: indicators ?? {},
      additionalIndicators: {
        marketFlushReversalContext: signalContext,
      },
      figures: buildMarketFlushReversalFigures({
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice: riskPlan.takeProfitPrice,
        referenceTimestamp: entrySignal.setupTimestamp,
        referencePrice: entrySignal.referencePrice,
        context: signalContext,
      }),
      orderPlan: {
        qty: riskPlan.qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: riskPlan.takeProfitPrice }],
      },
    });
  };
};
