import { asPositiveInt, asPositiveNumber } from '@tradejs/core/math';
import { logger } from '@tradejs/infra/logger';
import type { CreateStrategyCore } from '@tradejs/types';
import type { AdaptiveMomentumRibbonConfig } from './config';
import { evaluateAdaptiveMomentumRibbon } from './engine';
import { buildAdaptiveMomentumRibbonFigures } from './figures';

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const getDerivativesPressure = (
  indicators: Record<string, unknown>,
): string | null => {
  const baseContext = getRecord(indicators.baseContext);
  const derivatives = getRecord(baseContext?.derivatives);
  const summary = getRecord(derivatives?.summary);
  return getStringOrNull(summary?.pressure);
};

const shouldRejectByStructure = ({
  indicators,
  direction,
}: {
  indicators: Record<string, unknown>;
  direction: 'LONG' | 'SHORT';
}) => {
  const baseContext = getRecord(indicators.baseContext);
  const structure = getRecord(baseContext?.structure);
  const localRange = getRecord(structure?.localRange);
  const participation = getRecord(baseContext?.participation);
  const volume = getRecord(participation?.volume);
  const relative = getRecord(baseContext?.relative);
  const benchmark = getRecord(relative?.benchmark);
  const breakoutState = getStringOrNull(localRange?.breakoutState);
  const volumeRel20 = getNumberOrNull(volume?.volumeRel20);
  const benchmarkTrendAlignment = getStringOrNull(benchmark?.trendAlignment);
  const derivativesPressure = getDerivativesPressure(indicators);

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

export const createAdaptiveMomentumRibbonCore: CreateStrategyCore<
  AdaptiveMomentumRibbonConfig
> = async ({ config, symbol, strategyApi, indicatorsState }) => {
  const { LONG, SHORT, AMR_EXIT_ON_INVALIDATION, MAX_LOSS_VALUE, FEE_PERCENT } =
    config;
  const linePlots = resolveLinePlots(config.AMR_LINE_PLOTS);
  const lookbackBars = asPositiveInt(config.AMR_LOOKBACK_BARS, 0);

  return async () => {
    const { fullData, currentPrice, timestamp } =
      await strategyApi.getMarketData();
    if (fullData.length < 2) {
      return strategyApi.skip('WAIT_DATA');
    }

    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );

    const candles = lookbackBars > 0 ? fullData.slice(-lookbackBars) : fullData;

    let evaluation;
    try {
      evaluation = evaluateAdaptiveMomentumRibbon({
        candles,
        config,
        linePlots,
      });
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

    const indicators = indicatorsState.snapshot() ?? {};
    const structuralRejectCode = shouldRejectByStructure({
      indicators,
      direction: modeConfig.direction,
    });

    if (structuralRejectCode != null) {
      return strategyApi.skip(structuralRejectCode);
    }

    const { stopLossPrice, takeProfitPrice, qty } =
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
      indicators,
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
