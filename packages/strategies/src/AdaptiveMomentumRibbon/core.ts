import { asPositiveInt, asPositiveNumber } from '@tradejs/core/math';
import { logger } from '@tradejs/infra/logger';
import type {
  BaseStrategyContextSnapshot,
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import type { AdaptiveMomentumRibbonConfig } from './config';
import { createAdaptiveMomentumRibbonEngine } from './engine';
import { buildAdaptiveMomentumRibbonFigures } from './figures';
import {
  buildStructureRiskPlan,
  isStopLossOnCorrectSide,
} from '../shared/structureRisk';

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const getDerivativesPressure = (
  baseContext: BaseStrategyContextSnapshot | undefined,
): string | null => {
  const derivatives = getRecord(baseContext?.derivatives);
  const summary = getRecord(derivatives?.summary);
  return getStringOrNull(summary?.pressure);
};

const shouldRejectByStructure = ({
  baseContext,
  direction,
}: {
  baseContext: BaseStrategyContextSnapshot | undefined;
  direction: 'LONG' | 'SHORT';
}) => {
  const structure = getRecord(baseContext?.structure);
  const localRange = getRecord(structure?.localRange);
  const participation = getRecord(baseContext?.participation);
  const volume = getRecord(participation?.volume);
  const relative = getRecord(baseContext?.relative);
  const benchmark = getRecord(relative?.benchmark);
  const breakoutState = getStringOrNull(localRange?.breakoutState);
  const volumeRel20 = getNumberOrNull(volume?.volumeRel20);
  const benchmarkTrendAlignment = getStringOrNull(benchmark?.trendAlignment);
  const derivativesPressure = getDerivativesPressure(baseContext);

  const breakoutConfirmed =
    direction === 'LONG'
      ? breakoutState === 'above_high_level'
      : breakoutState === 'below_low_level';

  if (breakoutState != null && !breakoutConfirmed) {
    return 'AMR_RANGE_BOUND_STRUCTURE';
  }

  if (volumeRel20 != null && volumeRel20 < 0.8) {
    return 'AMR_WEAK_PARTICIPATION';
  }

  if (benchmarkTrendAlignment === 'against_benchmark') {
    return 'AMR_BENCHMARK_CONFLICT';
  }

  if (
    (direction === 'LONG' && derivativesPressure === 'crowded_long') ||
    (direction === 'SHORT' && derivativesPressure === 'crowded_short')
  ) {
    return 'AMR_DERIVATIVES_PRESSURE_CONFLICT';
  }

  return null;
};

const resolveLinePlots = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
};

const buildAdaptiveMomentumRibbonStateKey = ({
  config,
  linePlots,
  lookbackBars,
}: {
  config: AdaptiveMomentumRibbonConfig;
  linePlots: string[];
  lookbackBars: number;
}) =>
  JSON.stringify({
    lookbackBars,
    linePlots,
    momentumPeriod: config.AMR_MOMENTUM_PERIOD,
    butterworthSmoothing: config.AMR_BUTTERWORTH_SMOOTHING,
    waitClose: config.AMR_WAIT_CLOSE,
    confirmOnNextBar: config.AMR_CONFIRM_ON_NEXT_BAR,
    minSignalOscAbs: config.AMR_MIN_SIGNAL_OSC_ABS,
    requireKcBias: config.AMR_REQUIRE_KC_BIAS,
    minBarsBetweenSignals: config.AMR_MIN_BARS_BETWEEN_SIGNALS,
    showInvalidationLevels: config.AMR_SHOW_INVALIDATION_LEVELS,
    showKeltnerChannel: config.AMR_SHOW_KELTNER_CHANNEL,
    kcLength: config.AMR_KC_LENGTH,
    kcMaType: config.AMR_KC_MA_TYPE,
    atrLength: config.AMR_ATR_LENGTH,
    atrMultiplier: config.AMR_ATR_MULTIPLIER,
  });

export const createAdaptiveMomentumRibbonCore: CreateStrategyCore<
  AdaptiveMomentumRibbonConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, symbol, data: initialData, strategyApi }) => {
  const { LONG, SHORT, AMR_EXIT_ON_INVALIDATION, MAX_LOSS_VALUE, FEE_PERCENT } =
    config;
  const linePlots = resolveLinePlots(config.AMR_LINE_PLOTS);
  const lookbackBars = asPositiveInt(config.AMR_LOOKBACK_BARS, 0);
  const initialCandles = Array.isArray(initialData) ? initialData : [];
  const warmupCandles =
    lookbackBars > 0
      ? initialCandles.slice(-Math.max(lookbackBars - 1, 0))
      : initialCandles;
  const detectorState = strategyApi.createStateController<
    {
      engine: ReturnType<typeof createAdaptiveMomentumRibbonEngine>;
      processedCandles: number;
    },
    {
      evaluation: ReturnType<
        ReturnType<typeof createAdaptiveMomentumRibbonEngine>['next']
      >;
      processedCandles: number;
    },
    ReturnType<
      ReturnType<typeof createAdaptiveMomentumRibbonEngine>['getState']
    > & {
      processedCandles: number;
    }
  >(
    'AdaptiveMomentumRibbon',
    () => ({
      engine: createAdaptiveMomentumRibbonEngine({
        config,
        linePlots,
        initialCandles: warmupCandles,
      }),
      processedCandles: warmupCandles.length,
    }),
    {
      configKey: buildAdaptiveMomentumRibbonStateKey({
        config,
        linePlots,
        lookbackBars,
      }),
      snapshot: (state) => ({
        ...state.engine.getState(),
        processedCandles: state.processedCandles,
      }),
    },
  );
  const nextDetectorState = (
    candle: Parameters<
      ReturnType<typeof createAdaptiveMomentumRibbonEngine>['next']
    >[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) => {
      const evaluation = state.engine.next(candle);
      state.processedCandles += 1;
      return {
        evaluation,
        processedCandles: state.processedCandles,
      };
    });

  return async (candle) => {
    const { currentPrice, timestamp } = await strategyApi.getMarketData();
    let detectorResult;
    try {
      detectorResult = nextDetectorState(candle);
    } catch (error) {
      if (typeof globalThis.setImmediate === 'function') {
        logger.warn(
          'AdaptiveMomentumRibbon evaluation failed for %s: %s',
          symbol,
          String(error),
        );
      }

      return strategyApi.skip('AMR_EVALUATION_FAILED');
    }

    if (detectorResult.processedCandles < 2) {
      return strategyApi.skip('WAIT_DATA');
    }

    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );

    const { evaluation } = detectorResult;
    const { snapshot: amr, plotSeries } = evaluation;

    if (amr.entryLong && amr.entryShort) {
      return strategyApi.skip('AMR_SIGNAL_CONFLICT');
    }

    if (positionExists && position) {
      if (
        (position.direction === 'LONG' && amr.entryShort) ||
        (position.direction === 'SHORT' && amr.entryLong)
      ) {
        return {
          kind: 'exit',
          code: 'CLOSE_BY_AMR_SIGNAL',
          closePlan: {
            price: currentPrice,
            timestamp,
            direction: position.direction,
          },
        };
      }

      if (Boolean(AMR_EXIT_ON_INVALIDATION) && amr.invalidated) {
        return {
          kind: 'exit',
          code: 'CLOSE_BY_AMR_INVALIDATION',
          closePlan: {
            price: currentPrice,
            timestamp,
            direction: position.direction,
          },
        };
      }

      return strategyApi.skip('POSITION_HELD');
    }

    if (!amr.entryLong && !amr.entryShort) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const modeConfig = amr.entryLong ? LONG : SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { indicators, baseContext } =
      strategyApi.getCurrentIndicatorsContext<IndicatorsHistorySnapshot>();
    const structuralRejectCode = shouldRejectByStructure({
      baseContext,
      direction: modeConfig.direction,
    });

    if (structuralRejectCode != null) {
      return strategyApi.skip(structuralRejectCode);
    }

    const structuralStopBase =
      modeConfig.direction === 'LONG'
        ? amr.invalidationLevel ?? amr.kcLower
        : amr.invalidationLevel ?? amr.kcUpper;
    const stopBuffer =
      currentPrice *
      (Math.max(0, Number(config.AMR_STOP_BUFFER_PCT ?? 0.03)) / 100);
    const stopLossPrice =
      structuralStopBase == null
        ? null
        : modeConfig.direction === 'LONG'
          ? structuralStopBase - stopBuffer
          : structuralStopBase + stopBuffer;

    if (
      stopLossPrice == null ||
      !Number.isFinite(stopLossPrice) ||
      !isStopLossOnCorrectSide({
        direction: modeConfig.direction,
        currentPrice,
        stopLossPrice,
      })
    ) {
      return strategyApi.skip('INVALID_STOP');
    }

    const { takeProfitPrice, riskRatio, qty } = buildStructureRiskPlan({
      currentPrice,
      direction: modeConfig.direction,
      stopLossPrice,
      targetR: Number(config.AMR_TARGET_R_MULT ?? 2),
      maxLossValue: MAX_LOSS_VALUE,
      feePercent: Number(FEE_PERCENT ?? 0),
    });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${riskRatio.toFixed(2)}`);
    }

    return strategyApi.entry({
      code: amr.entryLong ? 'AMR_ENTRY_LONG' : 'AMR_ENTRY_SHORT',
      direction: modeConfig.direction,
      figures: buildAdaptiveMomentumRibbonFigures({
        plotSeries,
        linePlots,
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      indicators: indicators ?? {},
      additionalIndicators: {
        amr,
        amrSignalTiming: {
          entryTiming: 'zero_cross',
          waitClose: Boolean(config.AMR_WAIT_CLOSE),
          confirmOnNextBar: Boolean(config.AMR_CONFIRM_ON_NEXT_BAR),
          lookbackBars,
        },
        amrConfigSnapshot: {
          momentumPeriod: asPositiveInt(config.AMR_MOMENTUM_PERIOD, 20),
          butterworthSmoothing: asPositiveInt(
            config.AMR_BUTTERWORTH_SMOOTHING,
            3,
          ),
          minSignalOscAbs: asPositiveNumber(
            config.AMR_MIN_SIGNAL_OSC_ABS,
            0.55,
          ),
          requireKcBias: Boolean(config.AMR_REQUIRE_KC_BIAS),
          minBarsBetweenSignals: asPositiveInt(
            config.AMR_MIN_BARS_BETWEEN_SIGNALS,
            12,
          ),
          kcLength: asPositiveInt(config.AMR_KC_LENGTH, 20),
          atrLength: asPositiveInt(config.AMR_ATR_LENGTH, 14),
          atrMultiplier: asPositiveNumber(config.AMR_ATR_MULTIPLIER, 2),
        },
      },
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
