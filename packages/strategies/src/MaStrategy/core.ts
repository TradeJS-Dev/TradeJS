import { round } from '@tradejs/core/math';

import { MaStrategyConfig } from './config';
import { buildMaStrategyFigures } from './figures';
import type {
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  KlineChartData,
} from '@tradejs/types';
import { getIndicatorsCorrelation } from '@tradejs/strategy-kit/context';
import { resolveDirectionalConfigNumber } from '@tradejs/strategy-kit/config';

export interface CrossState {
  kind: 'bullish' | 'bearish';
  maFastPrev: number;
  maFastCurrent: number;
  maSlowPrev: number;
  maSlowCurrent: number;
}

export interface MaCrossQuality {
  gapAtr: number | null;
  fastSlopeAtr: number | null;
  slowSlopeAligned: boolean;
  bodyAtr: number | null;
  directionalBody: boolean;
  volumeRel20: number | null;
  priceDistanceFastAtr: number | null;
  correlation: number | null;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const detectCross = (maFast: number[], maSlow: number[]): CrossState | null => {
  if (maFast.length < 2 || maSlow.length < 2) {
    return null;
  }

  const maFastPrev = maFast[maFast.length - 2];
  const maFastCurrent = maFast[maFast.length - 1];
  const maSlowPrev = maSlow[maSlow.length - 2];
  const maSlowCurrent = maSlow[maSlow.length - 1];

  if (
    !isFiniteNumber(maFastPrev) ||
    !isFiniteNumber(maFastCurrent) ||
    !isFiniteNumber(maSlowPrev) ||
    !isFiniteNumber(maSlowCurrent)
  ) {
    return null;
  }

  if (maFastPrev <= maSlowPrev && maFastCurrent > maSlowCurrent) {
    return {
      kind: 'bullish',
      maFastPrev,
      maFastCurrent,
      maSlowPrev,
      maSlowCurrent,
    };
  }

  if (maFastPrev >= maSlowPrev && maFastCurrent < maSlowCurrent) {
    return {
      kind: 'bearish',
      maFastPrev,
      maFastCurrent,
      maSlowPrev,
      maSlowCurrent,
    };
  }

  return null;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

export const getMaCrossQuality = (
  cross: CrossState,
  baseContext?: BaseStrategyContextSnapshot,
  correlation: number | null = null,
): MaCrossQuality => {
  const atr = toFiniteNumberOrNull(baseContext?.raw?.volatility?.atr);
  const candle = baseContext?.candle;
  const body = candle
    ? Math.abs(Number(candle.close) - Number(candle.open))
    : null;
  const priceDistanceFast = candle
    ? Math.abs(Number(candle.close) - cross.maFastCurrent)
    : null;
  const isBullish = cross.kind === 'bullish';

  return {
    gapAtr:
      atr != null && atr > 0
        ? Math.abs(cross.maFastCurrent - cross.maSlowCurrent) / atr
        : null,
    fastSlopeAtr:
      atr != null && atr > 0
        ? Math.abs(cross.maFastCurrent - cross.maFastPrev) / atr
        : null,
    slowSlopeAligned: isBullish
      ? cross.maSlowCurrent > cross.maSlowPrev
      : cross.maSlowCurrent < cross.maSlowPrev,
    bodyAtr:
      atr != null && atr > 0 && body != null && Number.isFinite(body)
        ? body / atr
        : null,
    directionalBody: candle
      ? isBullish
        ? Number(candle.close) > Number(candle.open)
        : Number(candle.close) < Number(candle.open)
      : false,
    volumeRel20: toFiniteNumberOrNull(
      baseContext?.participation?.volume?.volumeRel20,
    ),
    priceDistanceFastAtr:
      atr != null && atr > 0 && priceDistanceFast != null
        ? priceDistanceFast / atr
        : null,
    correlation,
  };
};

export const isMaCrossQualityAccepted = (
  config: MaStrategyConfig,
  quality: MaCrossQuality,
  direction: 'LONG' | 'SHORT' = 'LONG',
): boolean => {
  const minGapAtr = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'MA_MIN_CROSS_GAP_ATR',
      direction,
      fallback: 0,
    }),
  );
  if (minGapAtr > 0 && (quality.gapAtr == null || quality.gapAtr < minGapAtr)) {
    return false;
  }
  const maxGapAtr = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'MA_MAX_CROSS_GAP_ATR',
      direction,
      fallback: 0,
    }),
  );
  if (maxGapAtr > 0 && (quality.gapAtr == null || quality.gapAtr > maxGapAtr)) {
    return false;
  }
  const minFastSlopeAtr = Math.max(
    0,
    Number(config.MA_MIN_FAST_SLOPE_ATR ?? 0),
  );
  if (
    minFastSlopeAtr > 0 &&
    (quality.fastSlopeAtr == null || quality.fastSlopeAtr < minFastSlopeAtr)
  ) {
    return false;
  }
  if (config.MA_REQUIRE_SLOW_SLOPE_ALIGNMENT && !quality.slowSlopeAligned) {
    return false;
  }
  if (config.MA_REQUIRE_DIRECTIONAL_BODY && !quality.directionalBody) {
    return false;
  }
  const minBodyAtr = Math.max(0, Number(config.MA_MIN_BODY_ATR ?? 0));
  if (
    minBodyAtr > 0 &&
    (quality.bodyAtr == null || quality.bodyAtr < minBodyAtr)
  ) {
    return false;
  }
  const minVolumeRel20 = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'MA_MIN_VOLUME_REL20',
      direction,
      fallback: 0,
    }),
  );
  if (
    minVolumeRel20 > 0 &&
    (quality.volumeRel20 == null || quality.volumeRel20 < minVolumeRel20)
  ) {
    return false;
  }
  const maxPriceDistanceFastAtr = Math.max(
    0,
    Number(config.MA_MAX_PRICE_DISTANCE_FAST_ATR ?? 0),
  );
  if (
    maxPriceDistanceFastAtr > 0 &&
    (quality.priceDistanceFastAtr == null ||
      quality.priceDistanceFastAtr > maxPriceDistanceFastAtr)
  ) {
    return false;
  }
  const maxCorrelation = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'MA_MAX_CORRELATION',
      direction,
      fallback: 0,
    }),
  );
  if (
    maxCorrelation > 0 &&
    (quality.correlation == null || quality.correlation > maxCorrelation)
  ) {
    return false;
  }

  return true;
};

export const createMaStrategyCore: CreateStrategyCore<
  MaStrategyConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi, indicatorsState }) => {
  const { FEE_PERCENT, MAX_LOSS_VALUE, TRADE_COOLDOWN_MS, LONG, SHORT } =
    config;

  const lastTradeController = strategyApi.createLastTradeController({
    enabled: Number(TRADE_COOLDOWN_MS ?? 0) > 0,
    cooldownMs: Number(TRADE_COOLDOWN_MS ?? 0),
  });

  return async () => {
    indicatorsState.onBar();
    const maFast = indicatorsState.latestNumbers('maFast', 2);
    const maSlow = indicatorsState.latestNumbers('maSlow', 2);
    if (maFast.length < 2 || maSlow.length < 2) {
      return strategyApi.skip('WAIT_MA_DATA');
    }

    const cross = detectCross(maFast, maSlow);
    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );

    // When position is open, MA cross acts as an opposite-signal exit.
    if (positionExists && position) {
      const exitOnOppositeCross =
        position.direction === 'LONG'
          ? config.MA_EXIT_ON_OPPOSITE_CROSS_LONG
          : config.MA_EXIT_ON_OPPOSITE_CROSS_SHORT;
      if (
        exitOnOppositeCross &&
        ((position.direction === 'LONG' && cross?.kind === 'bearish') ||
          (position.direction === 'SHORT' && cross?.kind === 'bullish'))
      ) {
        return strategyApi.exit({
          code: 'CLOSE_BY_OPPOSITE_MA_CROSS',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_HELD');
    }

    if (!cross) {
      return strategyApi.skip('NO_CROSS');
    }

    const modeConfig = cross.kind === 'bullish' ? LONG : SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { indicators } = strategyApi.getCurrentIndicatorsContext();
    if (!indicators) {
      return strategyApi.skip('NO_INDICATORS');
    }
    const correlation = getIndicatorsCorrelation(indicators);
    const crossQuality = getMaCrossQuality(
      cross,
      indicators.baseContext,
      correlation,
    );
    if (!isMaCrossQualityAccepted(config, crossQuality, modeConfig.direction)) {
      return strategyApi.skip('WEAK_MA_CROSS');
    }

    const { timestamp, currentPrice, candle } =
      await strategyApi.getDecisionPriceContext();
    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('TRADE_COOLDOWN');
    }

    const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: modeConfig.direction,
        takeProfitDelta: modeConfig.TP,
        stopLossDelta: modeConfig.SL,
        unit: 'percent',
        maxLossValue: MAX_LOSS_VALUE,
        feePercent: Number(FEE_PERCENT ?? 0),
      });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const figureCandles = Array.isArray(indicators.candles15m)
      ? (indicators.candles15m as KlineChartData)
      : candle
        ? ([candle] as KlineChartData)
        : [];

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: cross.kind === 'bullish' ? 'MA_BULLISH_CROSS' : 'MA_BEARISH_CROSS',
      direction: modeConfig.direction,
      figures: buildMaStrategyFigures({
        candles: figureCandles,
        maFast,
        maSlow,
        crossTimestamp: timestamp,
        crossPrice: currentPrice,
        crossKind: cross.kind,
      }),
      indicators,
      additionalIndicators: {
        crossKind: cross.kind,
        maFastPrev: cross.maFastPrev,
        maFastCurrent: cross.maFastCurrent,
        maSlowPrev: cross.maSlowPrev,
        maSlowCurrent: cross.maSlowCurrent,
        maGap: cross.maFastCurrent - cross.maSlowCurrent,
        ...crossQuality,
        correlation,
      },
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
