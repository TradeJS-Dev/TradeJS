import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { TrendShiftConfig } from './config';
import { buildTrendShiftSignalContext, createTrendShiftEngine } from './engine';
import { filterByVeryVolatility } from './filters';
import { buildTrendShiftFigures } from './figures';
import {
  buildTrendShiftGuardrailContext,
  getTrendShiftGuardrailSkipCode,
} from './guardrails';
import { getIndicatorsBaseContext } from '../shared/baseContext';

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

export const createTrendShiftCore: CreateStrategyCore<
  TrendShiftConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const engine = createTrendShiftEngine({
    config,
    initialCandles: initialData,
  });
  const lastTradeController = strategyApi.createLastTradeController();

  return async (candle) => {
    const runtimeState = engine.next(candle);
    const snapshot = runtimeState.snapshot;

    if (!snapshot) {
      return strategyApi.skip('WAIT_DATA');
    }

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositeBullExit =
        position.direction === 'SHORT' && snapshot.bullFlip;
      const oppositeBearExit =
        position.direction === 'LONG' && snapshot.bearFlip;

      if (
        Boolean(config.TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP) &&
        (oppositeBullExit || oppositeBearExit)
      ) {
        return strategyApi.exit({
          code: 'TRENDSHIFT_OPPOSITE_FLIP_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const isBullEntry = snapshot.bullFlip;
    const isBearEntry = snapshot.bearFlip;
    if (!isBullEntry && !isBearEntry) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const modeConfig = isBullEntry ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { fullData, timestamp, currentPrice } =
      await strategyApi.getMarketData();

    if (!filterByVeryVolatility(fullData)) {
      return strategyApi.skip('VERY_VOLATILITY');
    }

    const indicators = indicatorsState.snapshot();
    const direction = modeConfig.direction;
    const signalContext = buildTrendShiftSignalContext({
      snapshot: {
        ...snapshot,
        close: currentPrice,
      },
      indicators: indicators as Record<string, unknown>,
    });
    const guardrailContext = buildTrendShiftGuardrailContext({
      signalContext,
      baseContext: getIndicatorsBaseContext(
        indicators as Record<string, unknown>,
      ),
    });

    if (!guardrailContext.approvalAllowedNow) {
      return strategyApi.skip(getTrendShiftGuardrailSkipCode(guardrailContext));
    }

    const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction,
        takeProfitDelta: modeConfig.TP,
        stopLossDelta: modeConfig.SL,
        unit: 'percent',
        maxLossValue: config.MAX_LOSS_VALUE,
        feePercent: Number(config.FEE_PERCENT ?? 0),
      });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: isBullEntry ? 'TRENDSHIFT_BULLISH_FLIP' : 'TRENDSHIFT_BEARISH_FLIP',
      direction,
      indicators,
      additionalIndicators: {
        trendShiftContext: signalContext,
      },
      figures: buildTrendShiftFigures({
        series: runtimeState.series,
        direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
