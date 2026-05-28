import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { LiquidityZonesConfig } from './config';
import {
  buildLiquidityZonesDetectorKey,
  buildLiquidityZonesSignalContext,
  createLiquidityZonesEngine,
  type LiquidityZonesRuntimeState,
} from './engine';
import { buildLiquidityZonesFigures } from './figures';

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

export const createLiquidityZonesCore: CreateStrategyCore<
  LiquidityZonesConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({
  config,
  data: initialData,
  strategyApi,
  indicatorsState,
  sharedReplayKey,
  getSharedReplayState,
}) => {
  const detectorKey = buildLiquidityZonesDetectorKey(config);
  const createSharedEngineState = () => ({
    engine: createLiquidityZonesEngine({
      config,
      initialCandles: initialData,
    }),
    lastTimestamp: null as number | null,
    lastResult: undefined as LiquidityZonesRuntimeState | undefined,
  });
  const sharedEngineState = getSharedReplayState
    ? getSharedReplayState(
        sharedReplayKey
          ? `${sharedReplayKey}:LiquidityZones:${detectorKey}`
          : undefined,
        createSharedEngineState,
      )
    : createSharedEngineState();
  const lastTradeController = strategyApi.createLastTradeController();
  const nextDetectorState = (
    candle: Parameters<typeof sharedEngineState.engine.next>[0],
  ) => {
    if (sharedEngineState.lastTimestamp === candle.timestamp) {
      return (
        sharedEngineState.lastResult ?? sharedEngineState.engine.getState()
      );
    }
    if (
      sharedEngineState.lastTimestamp != null &&
      candle.timestamp < sharedEngineState.lastTimestamp
    ) {
      throw new Error(
        `LiquidityZones shared detector received non-monotonic candle timestamp ${candle.timestamp} after ${sharedEngineState.lastTimestamp}`,
      );
    }

    sharedEngineState.lastTimestamp = candle.timestamp;
    sharedEngineState.lastResult = sharedEngineState.engine.next(candle);
    return sharedEngineState.lastResult;
  };

  return async (candle) => {
    indicatorsState.onBar();
    const runtimeState = nextDetectorState(candle);
    const signal = runtimeState.signal;

    if (!signal) {
      return strategyApi.skip('NO_LIQUIDITY_ZONE_RETEST');
    }

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositeSignal =
        position.direction === 'LONG'
          ? signal.direction === 'SHORT'
          : signal.direction === 'LONG';

      if (
        Boolean(config.LIQUIDITY_ZONES_EXIT_ON_OPPOSITE_RETEST) &&
        oppositeSignal
      ) {
        return strategyApi.exit({
          code: 'LIQUIDITY_ZONES_OPPOSITE_RETEST_EXIT',
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
    const zoneBuffer =
      signal.zoneHeight *
      Math.max(0, Number(config.LIQUIDITY_ZONES_STOP_ZONE_BUFFER_MULT ?? 0.2));
    const percentBuffer =
      currentPrice *
      (Math.max(0, Number(config.LIQUIDITY_ZONES_STOP_BUFFER_PCT ?? 0.03)) /
        100);
    const buffer = Math.max(zoneBuffer, percentBuffer);
    const stopLossPrice =
      signal.direction === 'LONG'
        ? signal.zone.bottom - buffer
        : signal.zone.top + buffer;
    const riskDistance = Math.abs(currentPrice - stopLossPrice);
    const targetR = Math.max(
      0,
      Number(config.LIQUIDITY_ZONES_TARGET_R_MULT ?? 2),
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
          ? 'LIQUIDITY_ZONES_SWING_LOW_RETEST'
          : 'LIQUIDITY_ZONES_SWING_HIGH_RETEST',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        liquidityZonesContext: buildLiquidityZonesSignalContext({
          ...signal,
          close: currentPrice,
        }),
      },
      figures: buildLiquidityZonesFigures({
        signal,
        zones: runtimeState.zones,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice,
        maxZones: Math.max(
          1,
          Number(config.LIQUIDITY_ZONES_MAX_FIGURE_ZONES ?? 24),
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
