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
} from './engine';
import { buildLiquidityZonesFigures } from './figures';
import { getLiquidityZonesFilterSkipCode } from './filters';
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

export const createLiquidityZonesCore: CreateStrategyCore<
  LiquidityZonesConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorKey = buildLiquidityZonesDetectorKey(config);
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createLiquidityZonesEngine> },
    ReturnType<ReturnType<typeof createLiquidityZonesEngine>['next']>,
    ReturnType<ReturnType<typeof createLiquidityZonesEngine>['getState']>
  >(
    'LiquidityZones',
    () => ({
      engine: createLiquidityZonesEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: detectorKey,
      snapshot: (state) => state.engine.getState(),
    },
  );
  const lastTradeController = strategyApi.createLastTradeController({
    enabled: true,
  });
  const nextDetectorState = (
    candle: Parameters<
      ReturnType<typeof createLiquidityZonesEngine>['next']
    >[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  return async (candle) => {
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

    const baseContext = strategyApi.getBaseContext();
    const filterSkipCode = getLiquidityZonesFilterSkipCode({
      signal,
      config,
      baseContext,
    });
    if (filterSkipCode) {
      return strategyApi.skip(filterSkipCode);
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
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
      targetR: Number(config.LIQUIDITY_ZONES_TARGET_R_MULT ?? 2),
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

    const indicators = indicatorsState.snapshot();
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
