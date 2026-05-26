import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { StructureZonesConfig } from './config';
import {
  buildStructureZonesSignalContext,
  createStructureZonesEngine,
} from './engine';
import { buildStructureZonesFigures } from './figures';

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

export const createStructureZonesCore: CreateStrategyCore<
  StructureZonesConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const engine = createStructureZonesEngine({
    config,
    initialCandles: initialData,
  });
  const lastTradeController = strategyApi.createLastTradeController();

  return async (candle) => {
    indicatorsState.onBar();
    const runtimeState = engine.next(candle);
    const signal = runtimeState.signal;

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositeSignal =
        signal != null &&
        (position.direction === 'LONG'
          ? signal.direction === 'SHORT'
          : signal.direction === 'LONG');

      if (
        Boolean(config.STRUCTURE_ZONES_EXIT_ON_OPPOSITE_SIGNAL) &&
        oppositeSignal
      ) {
        return strategyApi.exit({
          code: 'STRUCTURE_ZONES_OPPOSITE_SIGNAL_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (!signal) {
      return strategyApi.skip('NO_STRUCTURE_ZONE_SIGNAL');
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
      Math.max(0, Number(config.STRUCTURE_ZONES_STOP_ZONE_BUFFER_MULT ?? 0.2));
    const percentBuffer =
      currentPrice *
      (Math.max(0, Number(config.STRUCTURE_ZONES_STOP_BUFFER_PCT ?? 0.03)) /
        100);
    const buffer = Math.max(zoneBuffer, percentBuffer);
    const stopLossPrice =
      signal.direction === 'LONG'
        ? signal.zone.bottom - buffer
        : signal.zone.top + buffer;
    const riskDistance = Math.abs(currentPrice - stopLossPrice);
    const targetR = Math.max(
      0,
      Number(config.STRUCTURE_ZONES_TARGET_R_MULT ?? 2),
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
          ? `STRUCTURE_ZONES_${signal.kind.toUpperCase()}_LONG`
          : `STRUCTURE_ZONES_${signal.kind.toUpperCase()}_SHORT`,
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        structureZonesContext: buildStructureZonesSignalContext({
          ...signal,
          close: currentPrice,
        }),
      },
      figures: buildStructureZonesFigures({
        signal,
        swingPoints: runtimeState.swingPoints,
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
