import { round } from '@tradejs/core/math';

import { MaStrategyConfig } from './config';
import { buildMaStrategyFigures } from './figures';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  KlineChartData,
} from '@tradejs/types';
import { getIndicatorsCorrelation } from '../shared/baseContext';

interface CrossState {
  kind: 'bullish' | 'bearish';
  maFastPrev: number;
  maFastCurrent: number;
  maSlowPrev: number;
  maSlowCurrent: number;
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

export const createMaStrategyCore: CreateStrategyCore<
  MaStrategyConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi }) => {
  const { FEE_PERCENT, MAX_LOSS_VALUE, TRADE_COOLDOWN_MS, LONG, SHORT } =
    config;

  const lastTradeController = strategyApi.createLastTradeController({
    enabled: Number(TRADE_COOLDOWN_MS ?? 0) > 0,
    cooldownMs: Number(TRADE_COOLDOWN_MS ?? 0),
  });

  return async () => {
    const { indicators } = strategyApi.getCurrentIndicatorsContext();
    if (!indicators) {
      return strategyApi.skip('NO_INDICATORS');
    }

    const maFast = Array.isArray(indicators.maFast) ? indicators.maFast : [];
    const maSlow = Array.isArray(indicators.maSlow) ? indicators.maSlow : [];
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
      if (
        (position.direction === 'LONG' && cross?.kind === 'bearish') ||
        (position.direction === 'SHORT' && cross?.kind === 'bullish')
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

    const correlation = getIndicatorsCorrelation(indicators);
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
