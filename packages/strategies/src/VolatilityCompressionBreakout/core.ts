import type {
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import { VolatilityCompressionBreakoutConfig } from './config';
import { buildVolatilityCompressionBreakoutFigures } from './figures';
import {
  buildAtrFallbackStop,
  buildContextRiskOrder,
  isDirectionAligned,
  isOpenPosition,
  isPressureAligned,
  resolveAtrBuffer,
  toFiniteNumberOrNull,
} from '../shared/contextStrategy';

export interface VolatilityCompressionBreakoutSignalContext {
  signalDirection: Direction;
  breakoutState: string | null;
  atrPctRank100: number | null;
  bbWidthRank100: number | null;
  rangeExpansionRank20: number | null;
  breakoutBodyAtr: number | null;
  volumeRel20: number | null;
  buyPressurePct: number | null;
  tradeFlowBuyPressurePct: number | null;
  mtfAlignment: string | null;
  compressionConfirmed: boolean;
  expansionConfirmed: boolean;
  participationConfirmed: boolean;
  mtfConfirmed: boolean | null;
  tradeFlowConfirmed: boolean | null;
}

const detectBreakoutDirection = (
  baseContext: BaseStrategyContextSnapshot,
): Direction | null => {
  const localRange = baseContext.structure?.localRange;
  if (localRange?.breakoutState === 'above_high_level') return 'LONG';
  if (localRange?.breakoutState === 'below_low_level') return 'SHORT';
  if (baseContext.structure?.srZones?.crossedAbove === true) return 'LONG';
  if (baseContext.structure?.srZones?.crossedBelow === true) return 'SHORT';
  if (baseContext.structure?.structureZones?.acceptAboveResistance === true) {
    return 'LONG';
  }
  if (baseContext.structure?.structureZones?.acceptBelowSupport === true) {
    return 'SHORT';
  }
  return null;
};

const isMtfAligned = ({
  direction,
  mtfAlignment,
}: {
  direction: Direction;
  mtfAlignment: string | null | undefined;
}) =>
  mtfAlignment == null ||
  mtfAlignment === 'unknown' ||
  mtfAlignment === 'neutral'
    ? null
    : direction === 'LONG'
      ? mtfAlignment === 'aligned_bull'
      : mtfAlignment === 'aligned_bear';

const detectSignal = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: VolatilityCompressionBreakoutConfig;
}): VolatilityCompressionBreakoutSignalContext | null => {
  const direction = detectBreakoutDirection(baseContext);
  if (!direction) return null;

  const volatility = baseContext.regime?.volatility;
  const percentiles = volatility?.percentiles;
  const atrPctRank100 = toFiniteNumberOrNull(percentiles?.atrPctRank100);
  const bbWidthRank100 = toFiniteNumberOrNull(percentiles?.bbWidthRank100);
  const rangeExpansionRank20 = toFiniteNumberOrNull(
    percentiles?.rangeExpansionRank20,
  );
  const breakoutBodyAtr = toFiniteNumberOrNull(
    baseContext.structure?.acceptance?.breakoutBodyAtr,
  );
  const atrCompressed =
    volatility?.state === 'compressed' ||
    (atrPctRank100 != null &&
      atrPctRank100 <= Number(config.VCB_MAX_ATR_PCT_RANK ?? 30));
  const bbCompressed =
    bbWidthRank100 != null &&
    bbWidthRank100 <= Number(config.VCB_MAX_BB_WIDTH_RANK ?? 30);
  const compressionConfirmed = Boolean(
    config.VCB_REQUIRE_BOTH_COMPRESSION_FILTERS
      ? atrCompressed && bbCompressed
      : atrCompressed || bbCompressed,
  );
  if (!compressionConfirmed) return null;

  const expansionConfirmed = Boolean(
    (rangeExpansionRank20 != null &&
      rangeExpansionRank20 >=
        Number(config.VCB_MIN_RANGE_EXPANSION_RANK ?? 60)) ||
      (breakoutBodyAtr != null &&
        breakoutBodyAtr >= Number(config.VCB_MIN_BREAKOUT_BODY_ATR ?? 0.2)),
  );
  if (!expansionConfirmed) return null;

  const volumeRel20 = toFiniteNumberOrNull(
    baseContext.participation?.volume?.volumeRel20,
  );
  const participationConfirmed =
    volumeRel20 == null ||
    volumeRel20 >= Number(config.VCB_MIN_VOLUME_REL20 ?? 1.15);
  if (!participationConfirmed) return null;

  const mtfAlignment = baseContext.mtf?.summary?.mtfAlignment ?? null;
  const mtfConfirmed = isMtfAligned({ direction, mtfAlignment });
  if (Boolean(config.VCB_REQUIRE_MTF_ALIGNMENT) && mtfConfirmed !== true) {
    return null;
  }

  const buyPressurePct = toFiniteNumberOrNull(
    baseContext.participation?.delta?.buyPressurePct,
  );
  const tradeFlowBuyPressurePct = toFiniteNumberOrNull(
    baseContext.participation?.tradeFlow?.buyPressurePct,
  );
  const tradeFlowConfirmed =
    isPressureAligned({
      direction,
      buyPressurePct: tradeFlowBuyPressurePct,
    }) ??
    isPressureAligned({
      direction,
      buyPressurePct,
    });
  if (
    Boolean(config.VCB_REQUIRE_TRADE_FLOW_ALIGNMENT) &&
    tradeFlowConfirmed !== true
  ) {
    return null;
  }

  return {
    signalDirection: direction,
    breakoutState: baseContext.structure?.localRange?.breakoutState ?? null,
    atrPctRank100,
    bbWidthRank100,
    rangeExpansionRank20,
    breakoutBodyAtr,
    volumeRel20,
    buyPressurePct,
    tradeFlowBuyPressurePct,
    mtfAlignment,
    compressionConfirmed,
    expansionConfirmed,
    participationConfirmed,
    mtfConfirmed,
    tradeFlowConfirmed,
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
  config: VolatilityCompressionBreakoutConfig;
}) => {
  const atr = baseContext.raw?.volatility?.atr ?? null;
  const buffer = resolveAtrBuffer({
    atr,
    currentPrice,
    atrMult: Number(config.VCB_STOP_ATR_BUFFER_MULT ?? 0.25),
    bufferPct: Number(config.VCB_STOP_BUFFER_PCT ?? 0.04),
  });
  const srZones = baseContext.structure?.srZones;
  const zones = baseContext.structure?.zones;
  const candidates =
    direction === 'LONG'
      ? [
          baseContext.raw?.levels?.highLevel,
          srZones?.nearestResistance?.level,
          zones?.resistance?.upper,
          baseContext.candle.low,
        ]
          .map(toFiniteNumberOrNull)
          .filter(
            (value): value is number => value != null && value < currentPrice,
          )
      : [
          baseContext.raw?.levels?.lowLevel,
          srZones?.nearestSupport?.level,
          zones?.support?.lower,
          baseContext.candle.high,
        ]
          .map(toFiniteNumberOrNull)
          .filter(
            (value): value is number => value != null && value > currentPrice,
          );

  if (candidates.length) {
    return direction === 'LONG'
      ? Math.max(...candidates) - buffer
      : Math.min(...candidates) + buffer;
  }

  return buildAtrFallbackStop({
    direction,
    currentPrice,
    atr,
    atrMult: Number(config.VCB_FALLBACK_STOP_ATR_MULT ?? 1.2),
    bufferPct: Number(config.VCB_STOP_BUFFER_PCT ?? 0.04),
  });
};

const getBreakoutLevel = ({
  baseContext,
  direction,
  currentPrice,
}: {
  baseContext: BaseStrategyContextSnapshot;
  direction: Direction;
  currentPrice: number;
}) => {
  const candidates =
    direction === 'LONG'
      ? [
          baseContext.raw?.levels?.highLevel,
          baseContext.structure?.srZones?.nearestResistance?.level,
          baseContext.structure?.zones?.resistance?.upper,
        ]
          .map(toFiniteNumberOrNull)
          .filter(
            (value): value is number => value != null && value < currentPrice,
          )
      : [
          baseContext.raw?.levels?.lowLevel,
          baseContext.structure?.srZones?.nearestSupport?.level,
          baseContext.structure?.zones?.support?.lower,
        ]
          .map(toFiniteNumberOrNull)
          .filter(
            (value): value is number => value != null && value > currentPrice,
          );

  if (!candidates.length) return null;
  return direction === 'LONG'
    ? Math.max(...candidates)
    : Math.min(...candidates);
};

export const createVolatilityCompressionBreakoutCore: CreateStrategyCore<
  VolatilityCompressionBreakoutConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi }) => {
  const lastTradeController = strategyApi.createLastTradeController();

  return async () => {
    const { indicators, baseContext } =
      strategyApi.getCurrentIndicatorsContext<IndicatorsHistorySnapshot>();
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

      if (Boolean(config.VCB_EXIT_ON_OPPOSITE_BREAKOUT) && oppositeSignal) {
        return strategyApi.exit({
          code: 'VCB_OPPOSITE_BREAKOUT_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (!signal) {
      return strategyApi.skip('NO_VOLATILITY_COMPRESSION_BREAKOUT');
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
      targetR: Number(config.VCB_TARGET_R_MULT ?? 2.4),
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
          ? 'VCB_LONG_COMPRESSION_BREAKOUT'
          : 'VCB_SHORT_COMPRESSION_BREAKOUT',
      direction: modeConfig.direction,
      indicators: indicators ?? {},
      additionalIndicators: {
        volatilityCompressionBreakoutContext: signal,
      },
      figures: buildVolatilityCompressionBreakoutFigures({
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice: riskPlan.takeProfitPrice,
        breakoutLevel: getBreakoutLevel({
          baseContext,
          direction: modeConfig.direction,
          currentPrice,
        }),
      }),
      orderPlan: {
        qty: riskPlan.qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: riskPlan.takeProfitPrice }],
      },
    });
  };
};
