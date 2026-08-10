import type {
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import { RelativeRotationConfig } from './config';
import { buildRelativeRotationFigures } from './figures';
import {
  buildAtrFallbackStop,
  buildContextRiskOrder,
  isDirectionAligned,
  isOpenPosition,
  toFiniteNumberOrNull,
} from '../shared/contextStrategy';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

export interface RelativeRotationSignalContext {
  signalDirection: Direction;
  targetVsBtcRatioTrend: string | null;
  targetVsBtcAlpha24h: number | null;
  targetVsBtcRatioReturn24h: number | null;
  targetVsBtcBeta20: number | null;
  targetVsBtcCorrelation20: number | null;
  targetVsEthRatioTrend: string | null;
  targetVsEthAlpha24h: number | null;
  targetVsEthRatioReturn24h: number | null;
  relativeStrength1h: number | null;
  btcAltRegime: string | null;
  marketBreadthReturn: number | null;
  volumeRel20: number | null;
  rotationScore: number;
  ratioTrendConfirmed: boolean;
  alphaConfirmed: boolean;
  ratioReturnConfirmed: boolean;
  relativeStrengthConfirmed: boolean;
  regimeConfirmed: boolean | null;
}

const signedForDirection = (direction: Direction, value: number | null) =>
  value == null ? null : direction === 'LONG' ? value : -value;

const isRatioTrendAligned = ({
  direction,
  trend,
}: {
  direction: Direction;
  trend: string | null | undefined;
}) =>
  trend == null || trend === 'unknown' || trend === 'flat'
    ? false
    : direction === 'LONG'
      ? trend === 'up'
      : trend === 'down';

const isBtcAltRegimeAligned = ({
  direction,
  regime,
}: {
  direction: Direction;
  regime: string | null | undefined;
}) => {
  if (
    !regime ||
    regime === 'unknown' ||
    regime === 'neutral' ||
    regime === 'mixed'
  ) {
    return null;
  }
  return direction === 'LONG'
    ? regime === 'alt_lead' || regime === 'risk_on'
    : regime === 'btc_lead' || regime === 'risk_off';
};

const buildDirectionCandidate = ({
  baseContext,
  config,
  direction,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: RelativeRotationConfig;
  direction: Direction;
}): RelativeRotationSignalContext | null => {
  const targetVsBtc = baseContext.relative?.targetVsBtc;
  if (!targetVsBtc) return null;

  const targetVsEth = baseContext.relative?.targetVsEth;
  const alpha24h = toFiniteNumberOrNull(targetVsBtc.alphaVsBtc24h);
  const ratioReturn24h = toFiniteNumberOrNull(targetVsBtc.ratioReturn24h);
  const ethAlpha24h = toFiniteNumberOrNull(targetVsEth?.alphaVsEth24h);
  const ethRatioReturn24h = toFiniteNumberOrNull(targetVsEth?.ratioReturn24h);
  const relativeStrength1h = toFiniteNumberOrNull(targetVsBtc.ratioReturn1h);
  const marketBreadthReturn = toFiniteNumberOrNull(
    baseContext.relative?.marketBreadth?.equalWeightedReturn,
  );
  const volumeRel20 = toFiniteNumberOrNull(
    baseContext.participation?.volume?.volumeRel20,
  );
  const signedAlpha = signedForDirection(direction, alpha24h);
  const signedRatioReturn = signedForDirection(direction, ratioReturn24h);
  const signedEthAlpha = signedForDirection(direction, ethAlpha24h);
  const signedEthRatioReturn = signedForDirection(direction, ethRatioReturn24h);
  const signedRelativeStrength = signedForDirection(
    direction,
    relativeStrength1h,
  );
  const signedMarketBreadth = signedForDirection(
    direction,
    marketBreadthReturn,
  );
  const ratioTrendConfirmed = isRatioTrendAligned({
    direction,
    trend: targetVsBtc.ratioTrend,
  });

  if (Boolean(config.RR_REQUIRE_RATIO_TREND) && !ratioTrendConfirmed) {
    return null;
  }

  const alphaConfirmed =
    signedAlpha != null &&
    signedAlpha >= Number(config.RR_MIN_ALPHA_24H ?? 0.8);
  const ratioReturnConfirmed =
    signedRatioReturn != null &&
    signedRatioReturn >= Number(config.RR_MIN_RATIO_RETURN_24H ?? 0.4);
  const rotationMagnitudeConfirmed = Boolean(
    config.RR_REQUIRE_ALPHA_AND_RATIO_RETURN
      ? alphaConfirmed && ratioReturnConfirmed
      : alphaConfirmed || ratioReturnConfirmed,
  );
  if (!rotationMagnitudeConfirmed) return null;

  const relativeStrengthConfirmed =
    signedRelativeStrength == null ||
    signedRelativeStrength >=
      resolveDirectionalConfigNumber({
        config,
        key: 'RR_MIN_RELATIVE_STRENGTH_1H',
        direction,
        fallback: 0.15,
      });
  if (!relativeStrengthConfirmed) return null;

  if (
    volumeRel20 != null &&
    volumeRel20 < Number(config.RR_MIN_VOLUME_REL20 ?? 0.8)
  ) {
    return null;
  }

  const btcAltRegime = baseContext.relative?.btcAltRegime?.regime ?? null;
  const regimeConfirmed = isBtcAltRegimeAligned({
    direction,
    regime: btcAltRegime,
  });
  if (
    Boolean(config.RR_REQUIRE_BTC_ALT_REGIME_ALIGNMENT) &&
    regimeConfirmed !== true
  ) {
    return null;
  }

  const ethPenalty =
    Math.min(0, signedEthAlpha ?? 0) + Math.min(0, signedEthRatioReturn ?? 0);
  const marketBreadthBonus =
    signedMarketBreadth == null
      ? 0
      : Math.max(-1, Math.min(1, signedMarketBreadth));
  const rotationScore =
    Math.max(0, signedAlpha ?? 0) +
    Math.max(0, signedRatioReturn ?? 0) +
    Math.max(0, signedRelativeStrength ?? 0) +
    marketBreadthBonus +
    ethPenalty;

  return {
    signalDirection: direction,
    targetVsBtcRatioTrend: targetVsBtc.ratioTrend ?? null,
    targetVsBtcAlpha24h: alpha24h,
    targetVsBtcRatioReturn24h: ratioReturn24h,
    targetVsBtcBeta20: toFiniteNumberOrNull(targetVsBtc.betaToBtc20),
    targetVsBtcCorrelation20: toFiniteNumberOrNull(
      targetVsBtc.correlationToBtc20,
    ),
    targetVsEthRatioTrend: targetVsEth?.ratioTrend ?? null,
    targetVsEthAlpha24h: ethAlpha24h,
    targetVsEthRatioReturn24h: ethRatioReturn24h,
    relativeStrength1h,
    btcAltRegime,
    marketBreadthReturn,
    volumeRel20,
    rotationScore,
    ratioTrendConfirmed,
    alphaConfirmed,
    ratioReturnConfirmed,
    relativeStrengthConfirmed,
    regimeConfirmed,
  };
};

const detectSignal = ({
  baseContext,
  config,
}: {
  baseContext: BaseStrategyContextSnapshot;
  config: RelativeRotationConfig;
}): RelativeRotationSignalContext | null => {
  const longCandidate = buildDirectionCandidate({
    baseContext,
    config,
    direction: 'LONG',
  });
  const shortCandidate = buildDirectionCandidate({
    baseContext,
    config,
    direction: 'SHORT',
  });

  if (longCandidate && shortCandidate) {
    return longCandidate.rotationScore >= shortCandidate.rotationScore
      ? longCandidate
      : shortCandidate;
  }

  return longCandidate ?? shortCandidate;
};

export const createRelativeRotationCore: CreateStrategyCore<
  RelativeRotationConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi }) => {
  const lastTradeController = strategyApi.createLastTradeController();

  return async () => {
    const baseContext = strategyApi.getBaseContext();
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

      if (Boolean(config.RR_EXIT_ON_OPPOSITE_ROTATION) && oppositeSignal) {
        return strategyApi.exit({
          code: 'RR_OPPOSITE_ROTATION_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (!signal) {
      return strategyApi.skip('NO_RELATIVE_ROTATION');
    }

    if (lastTradeController.isInCooldown(baseContext.candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig =
      signal.signalDirection === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const stopLossPrice = buildAtrFallbackStop({
      direction: modeConfig.direction,
      currentPrice,
      atr: baseContext.raw?.volatility?.atr ?? null,
      atrMult: Number(config.RR_STOP_ATR_MULT ?? 1.6),
      bufferPct: Number(config.RR_STOP_BUFFER_PCT ?? 0.05),
    });
    const riskOrder = buildContextRiskOrder({
      currentPrice,
      direction: modeConfig.direction,
      stopLossPrice,
      targetR: resolveDirectionalConfigNumber({
        config,
        key: 'RR_TARGET_R_MULT',
        direction: signal.signalDirection,
        fallback: 2.5,
      }),
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

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        modeConfig.direction === 'LONG'
          ? 'RR_LONG_RELATIVE_ROTATION'
          : 'RR_SHORT_RELATIVE_ROTATION',
      direction: modeConfig.direction,
      indicators: indicators ?? {},
      additionalIndicators: {
        relativeRotationContext: signal,
      },
      figures: buildRelativeRotationFigures({
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice: riskPlan.takeProfitPrice,
        context: signal,
      }),
      orderPlan: {
        qty: riskPlan.qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: riskPlan.takeProfitPrice }],
      },
    });
  };
};
