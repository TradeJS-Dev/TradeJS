import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { AdaptiveTrendChannelConfig } from './config';
import {
  buildAdaptiveTrendChannelSignalContext,
  createAdaptiveTrendChannelEngine,
} from './engine';
import { buildAdaptiveTrendChannelFigures } from './figures';
import { getAdaptiveTrendChannelFilterSkipCode } from './filters';

const isOpenPosition = (position: Position | null): position is Position =>
  Boolean(
    position &&
      typeof position.price === 'number' &&
      Number.isFinite(position.price) &&
      typeof position.qty === 'number' &&
      Number.isFinite(position.qty) &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );

const buildAdaptiveTrendChannelStateKey = (
  config: AdaptiveTrendChannelConfig,
) =>
  JSON.stringify({
    regressionBars: config.ADAPTIVE_TREND_CHANNEL_REGRESSION_BARS,
    envelopeBars: config.ADAPTIVE_TREND_CHANNEL_ENVELOPE_BARS,
    atrStretch: config.ADAPTIVE_TREND_CHANNEL_ATR_STRETCH,
    volatilityLookback: config.ADAPTIVE_TREND_CHANNEL_VOLATILITY_LOOKBACK,
    maxFigurePoints: config.ADAPTIVE_TREND_CHANNEL_MAX_FIGURE_POINTS,
  });

export const createAdaptiveTrendChannelCore: CreateStrategyCore<
  AdaptiveTrendChannelConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createAdaptiveTrendChannelEngine> },
    ReturnType<ReturnType<typeof createAdaptiveTrendChannelEngine>['next']>,
    ReturnType<ReturnType<typeof createAdaptiveTrendChannelEngine>['getState']>
  >(
    'AdaptiveTrendChannel',
    () => ({
      engine: createAdaptiveTrendChannelEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: buildAdaptiveTrendChannelStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const lastTradeController = strategyApi.createLastTradeController();
  const nextDetectorState = (
    candle: Parameters<
      ReturnType<typeof createAdaptiveTrendChannelEngine>['next']
    >[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
    const signal = runtimeState.signal;
    const snapshot = runtimeState.snapshot;

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const close = Number(candle.close);
      const channelBreak =
        snapshot != null &&
        ((position.direction === 'LONG' && close <= snapshot.floor) ||
          (position.direction === 'SHORT' && close >= snapshot.roof));
      const oppositeSignal =
        signal != null &&
        (position.direction === 'LONG'
          ? signal.direction === 'SHORT'
          : signal.direction === 'LONG');

      if (
        Boolean(config.ADAPTIVE_TREND_CHANNEL_EXIT_ON_CHANNEL_BREAK) &&
        channelBreak
      ) {
        return strategyApi.exit({
          code: 'ADAPTIVE_TREND_CHANNEL_BREAK_EXIT',
          direction: position.direction,
        });
      }

      if (
        Boolean(config.ADAPTIVE_TREND_CHANNEL_EXIT_ON_OPPOSITE_FLIP) &&
        oppositeSignal
      ) {
        return strategyApi.exit({
          code: 'ADAPTIVE_TREND_CHANNEL_OPPOSITE_FLIP_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (!signal) {
      return strategyApi.skip('NO_ADAPTIVE_TREND_CHANNEL_FLIP');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig = signal.direction === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const indicators = indicatorsState.snapshot() ?? {};
    const filterSkipCode = getAdaptiveTrendChannelFilterSkipCode({
      signal,
      config,
      baseContext: indicators.baseContext,
    });
    if (filterSkipCode) {
      return strategyApi.skip(filterSkipCode);
    }

    const { timestamp, currentPrice } = await strategyApi.getMarketData();
    const stopLossPrice =
      signal.direction === 'LONG' ? signal.floor : signal.roof;
    const riskDistance = Math.abs(currentPrice - stopLossPrice);
    const targetR = Math.max(
      0,
      Number(config.ADAPTIVE_TREND_CHANNEL_TARGET_R_MULT ?? 2),
    );
    const takeProfitPrice =
      signal.direction === 'LONG'
        ? currentPrice + riskDistance * targetR
        : currentPrice - riskDistance * targetR;
    const riskRatio = riskDistance > 0 ? targetR : 0;
    const rawQty =
      riskDistance > 0 ? Number(config.MAX_LOSS_VALUE ?? 0) / riskDistance : 0;
    const feeBuffer = 1 + Math.max(0, Number(config.FEE_PERCENT ?? 0)) / 100;
    const qty = rawQty / feeBuffer;

    if (
      (signal.direction === 'LONG' && stopLossPrice >= currentPrice) ||
      (signal.direction === 'SHORT' && stopLossPrice <= currentPrice)
    ) {
      return strategyApi.skip('INVALID_STOP');
    }

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        signal.direction === 'LONG'
          ? 'ADAPTIVE_TREND_CHANNEL_BULLISH_FLIP'
          : 'ADAPTIVE_TREND_CHANNEL_BEARISH_FLIP',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        adaptiveTrendChannelContext: buildAdaptiveTrendChannelSignalContext({
          ...signal,
          close: currentPrice,
        }),
      },
      figures: buildAdaptiveTrendChannelFigures({
        signal,
        series: runtimeState.series,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice,
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
