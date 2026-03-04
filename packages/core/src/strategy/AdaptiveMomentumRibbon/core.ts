import { logger } from '@utils/logger';
import { asPositiveInt, asPositiveNumber } from '@utils/number';
import {
  PineContextLike,
  asPineBoolean,
  asFiniteNumber,
  getLatestPinePlotValue,
  runPineScript,
} from '@utils/pine';
import { CreateStrategyCore } from '@types';
import { AdaptiveMomentumRibbonConfig } from './config';
import { buildAdaptiveMomentumRibbonFigures } from './figures';

const AMR_PINE_FILE_NAME = 'adaptiveMomentumRibbon.pine';

const asKcMaType = (
  value: unknown,
): AdaptiveMomentumRibbonConfig['AMR_KC_MA_TYPE'] => {
  if (
    value === 'SMA' ||
    value === 'EMA' ||
    value === 'SMMA (RMA)' ||
    value === 'WMA' ||
    value === 'VWMA'
  ) {
    return value;
  }

  return 'EMA';
};

const resolveAmrInputs = (
  config: AdaptiveMomentumRibbonConfig,
): Record<string, unknown> => ({
  'Momentum Period': asPositiveInt(config.AMR_MOMENTUM_PERIOD, 20),
  'Butterworth Smoothing': asPositiveInt(config.AMR_BUTTERWORTH_SMOOTHING, 3),
  'Confirm Signals on Bar Close': Boolean(config.AMR_WAIT_CLOSE),
  'Show Invalidation Levels': Boolean(config.AMR_SHOW_INVALIDATION_LEVELS),
  'Show Keltner Channel': Boolean(config.AMR_SHOW_KELTNER_CHANNEL),
  'KC Length': asPositiveInt(config.AMR_KC_LENGTH, 20),
  'KC MA Type': asKcMaType(config.AMR_KC_MA_TYPE),
  'ATR Length': asPositiveInt(config.AMR_ATR_LENGTH, 14),
  'ATR Multiplier': asPositiveNumber(config.AMR_ATR_MULTIPLIER, 2),
});

const resolveLinePlots = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
};

const getLookbackCandles = <TCandle>(
  candles: TCandle[],
  lookbackBars: number,
) => {
  if (lookbackBars <= 0) {
    return candles;
  }

  return candles.slice(-lookbackBars);
};

const readBooleanPlot = (
  pineContext: PineContextLike,
  plotName: string,
): boolean =>
  asPineBoolean(getLatestPinePlotValue(pineContext, plotName));

const readNumericPlot = (
  pineContext: PineContextLike,
  plotName: string,
): number | null =>
  asFiniteNumber(getLatestPinePlotValue(pineContext, plotName)) ?? null;

const readAmrSnapshot = (pineContext: PineContextLike, linePlots: string[]) => {
  const lineValues = Object.fromEntries(
    linePlots.map((plotName) => [
      plotName,
      readNumericPlot(pineContext, plotName),
    ]),
  );

  return {
    entryLong: readBooleanPlot(pineContext, 'entryLong'),
    entryShort: readBooleanPlot(pineContext, 'entryShort'),
    invalidated: readBooleanPlot(pineContext, 'invalidated'),
    activeBuy: readBooleanPlot(pineContext, 'activeBuy'),
    activeSell: readBooleanPlot(pineContext, 'activeSell'),
    signalOsc: readNumericPlot(pineContext, 'signalOsc'),
    kcMidline: readNumericPlot(pineContext, 'kcMidline'),
    kcUpper: readNumericPlot(pineContext, 'kcUpper'),
    kcLower: readNumericPlot(pineContext, 'kcLower'),
    invalidationLevel: readNumericPlot(pineContext, 'invalidationLevel'),
    lineValues,
  };
};

export const createAdaptiveMomentumRibbonCore: CreateStrategyCore<
  AdaptiveMomentumRibbonConfig
> = async ({ config, symbol, loadPineScript, strategyApi }) => {
  const script = loadPineScript(AMR_PINE_FILE_NAME);
  const { LONG, SHORT, AMR_EXIT_ON_INVALIDATION } = config;
  const linePlots = resolveLinePlots(config.AMR_LINE_PLOTS);
  const lookbackBars = asPositiveInt(config.AMR_LOOKBACK_BARS, 0);
  const pineInputs = resolveAmrInputs(config);
  const timeframe = String(config.INTERVAL ?? '15');

  return async () => {
    if (!script) {
      return strategyApi.skip('AMR_SCRIPT_EMPTY');
    }

    const { fullData, currentPrice, timestamp } =
      await strategyApi.getMarketData();
    if (fullData.length < 2) {
      return strategyApi.skip('WAIT_DATA');
    }

    const position = await strategyApi.getCurrentPosition();
    const positionExists = Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );

    const candles = getLookbackCandles(fullData, lookbackBars);

    let pineContext;
    try {
      pineContext = await runPineScript({
        candles,
        script,
        symbol,
        timeframe,
        inputs: pineInputs,
      });
    } catch (error) {
      if (typeof globalThis.setImmediate === 'function') {
        logger.warn(
          'AdaptiveMomentumRibbon pine run failed for %s: %s',
          symbol,
          String(error),
        );
      }
      return strategyApi.skip('AMR_SCRIPT_FAILED');
    }

    const amr = readAmrSnapshot(pineContext, linePlots);

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

    const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction: modeConfig.direction,
        takeProfitDelta: modeConfig.TP,
        stopLossDelta: modeConfig.SL,
        unit: 'percent',
      });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    return strategyApi.entry({
      code: amr.entryLong ? 'AMR_ENTRY_LONG' : 'AMR_ENTRY_SHORT',
      direction: modeConfig.direction,
      timestamp,
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio,
      },
      figures: buildAdaptiveMomentumRibbonFigures({
        pineContext,
        linePlots,
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      additionalIndicators: {
        amr,
      },
      orderPlan: {
        qty,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
