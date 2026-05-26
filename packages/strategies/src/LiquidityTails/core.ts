import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { LiquidityTailsConfig } from './config';
import {
  buildLiquidityTailsSignalContext,
  createLiquidityTailsEngine,
} from './engine';
import { buildLiquidityTailsFigures } from './figures';

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

export const createLiquidityTailsCore: CreateStrategyCore<
  LiquidityTailsConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const engine = createLiquidityTailsEngine({
    config,
    initialCandles: initialData,
  });
  const lastTradeController = strategyApi.createLastTradeController();

  return async (candle) => {
    indicatorsState.onBar();
    const runtimeState = engine.next(candle);
    const signal = runtimeState.signal;

    if (!signal) {
      return strategyApi.skip('NO_LIQUIDITY_TAIL_RETEST');
    }

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositeSignal =
        position.direction === 'LONG'
          ? signal.direction === 'SHORT'
          : signal.direction === 'LONG';

      if (
        Boolean(config.LIQUIDITY_TAILS_EXIT_ON_OPPOSITE_RETEST) &&
        oppositeSignal
      ) {
        return strategyApi.exit({
          code: 'LIQUIDITY_TAILS_OPPOSITE_RETEST_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig = signal.direction === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } = await strategyApi.getMarketData();
    const indicators = indicatorsState.snapshot();
    const buffer = Math.max(
      signal.atr *
        Math.max(0, Number(config.LIQUIDITY_TAILS_STOP_ATR_BUFFER_MULT)),
      currentPrice *
        (Math.max(0, Number(config.LIQUIDITY_TAILS_STOP_BUFFER_PCT)) / 100),
    );
    const stopLossPrice =
      signal.direction === 'LONG'
        ? signal.zone.bottom - buffer
        : signal.zone.top + buffer;
    const riskDistance = Math.abs(currentPrice - stopLossPrice);
    const targetR = Math.max(
      0,
      Number(config.LIQUIDITY_TAILS_TARGET_R_MULT ?? 2),
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
          ? 'LIQUIDITY_TAILS_BUY_PRESSURE_RETEST'
          : 'LIQUIDITY_TAILS_SELL_PRESSURE_RETEST',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        liquidityTailsContext: buildLiquidityTailsSignalContext({
          ...signal,
          close: currentPrice,
        }),
      },
      figures: buildLiquidityTailsFigures({
        signal,
        zones: runtimeState.zones,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice,
        maxZones: Math.max(
          1,
          Number(config.LIQUIDITY_TAILS_MAX_FIGURE_ZONES ?? 24),
        ),
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
