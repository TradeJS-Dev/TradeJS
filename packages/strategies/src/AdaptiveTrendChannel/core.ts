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
import {
  buildStructureRiskPlan,
  isStopLossOnCorrectSide,
} from '../shared/structureRisk';

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
> = async ({ config, data: initialData, strategyApi }) => {
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

    const baseContext = strategyApi.getBaseContext();
    const filterSkipCode = getAdaptiveTrendChannelFilterSkipCode({
      signal,
      config,
      baseContext,
    });
    if (filterSkipCode) {
      return strategyApi.skip(filterSkipCode);
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const stopLossPrice =
      signal.direction === 'LONG' ? signal.floor : signal.roof;

    if (
      !isStopLossOnCorrectSide({
        direction: signal.direction,
        currentPrice,
        stopLossPrice,
      })
    ) {
      return strategyApi.skip('INVALID_STOP');
    }

    const { takeProfitPrice, riskRatio, qty } = buildStructureRiskPlan({
      currentPrice,
      direction: signal.direction,
      stopLossPrice,
      targetR: Number(config.ADAPTIVE_TREND_CHANNEL_TARGET_R_MULT ?? 2),
      maxLossValue: config.MAX_LOSS_VALUE,
      feeRate: Number(config.FEE_PERCENT ?? 0),
      slippageBps:
        Number(config.SLIPPAGE_BASE_BPS ?? 0) +
        Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0),
    });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const { indicators } = strategyApi.getCurrentIndicatorsContext();
    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        signal.direction === 'LONG'
          ? 'ADAPTIVE_TREND_CHANNEL_BULLISH_FLIP'
          : 'ADAPTIVE_TREND_CHANNEL_BEARISH_FLIP',
      direction: modeConfig.direction,
      indicators: indicators ?? {},
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
