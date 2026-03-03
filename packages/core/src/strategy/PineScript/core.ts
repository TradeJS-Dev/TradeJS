import { logger } from '@utils/logger';
import { round } from '@utils/math';
import {
  asPineBoolean,
  asFiniteNumber,
  getLatestPinePlotValue,
  runPineScript,
} from '@utils/pine';
import { CreateStrategyCore, IndicatorsHistorySnapshot } from '@types';
import { PineScriptConfig } from './config';
import { buildPineScriptFigures } from './figures';

const resolveEntrySignals = ({
  entryLongRaw,
  entryShortRaw,
}: {
  entryLongRaw: unknown;
  entryShortRaw: unknown;
}) => {
  const entryLong = asPineBoolean(entryLongRaw);
  const entryShort = asPineBoolean(entryShortRaw);
  return { entryLong, entryShort };
};

export const createPineScriptCore: CreateStrategyCore<
  PineScriptConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, symbol, strategyApi, indicatorsState }) => {
  const {
    ENV,
    LONG,
    SHORT,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    MAX_CORRELATION,
    TRADE_COOLDOWN_MS,
    PINE_SCRIPT,
    PINE_SCRIPT_INPUTS,
    PINE_LOOKBACK_BARS,
    PINE_ENTRY_LONG_PLOT,
    PINE_ENTRY_SHORT_PLOT,
    PINE_EXIT_LONG_PLOT,
    PINE_EXIT_SHORT_PLOT,
    PINE_LINE_PLOTS,
  } = config;

  const lastTradeController = strategyApi.createLastTradeController({
    enabled: Number(TRADE_COOLDOWN_MS ?? 0) > 0,
    cooldownMs: Number(TRADE_COOLDOWN_MS ?? 0),
  });

  return async () => {
    indicatorsState.onBar();

    const script = String(PINE_SCRIPT ?? '').trim();
    if (!script) {
      return strategyApi.skip('PINE_SCRIPT_EMPTY');
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

    const lookbackBars = Number(PINE_LOOKBACK_BARS ?? 0);
    const candles =
      Number.isFinite(lookbackBars) && lookbackBars > 0
        ? fullData.slice(-lookbackBars)
        : fullData;

    let pineContext;
    try {
      pineContext = await runPineScript({
        candles,
        script,
        symbol,
        timeframe: String(config.INTERVAL ?? '15'),
        inputs: (PINE_SCRIPT_INPUTS ?? {}) as Record<string, unknown>,
      });
    } catch (error) {
      if (typeof globalThis.setImmediate === 'function') {
        logger.warn('Pine script run failed for %s: %s', symbol, String(error));
      }
      return strategyApi.skip('PINE_SCRIPT_FAILED');
    }

    const { entryLong, entryShort } = resolveEntrySignals({
      entryLongRaw: getLatestPinePlotValue(pineContext, PINE_ENTRY_LONG_PLOT),
      entryShortRaw: getLatestPinePlotValue(pineContext, PINE_ENTRY_SHORT_PLOT),
    });

    const exitLong = PINE_EXIT_LONG_PLOT
      ? asPineBoolean(getLatestPinePlotValue(pineContext, PINE_EXIT_LONG_PLOT))
      : false;
    const exitShort = PINE_EXIT_SHORT_PLOT
      ? asPineBoolean(getLatestPinePlotValue(pineContext, PINE_EXIT_SHORT_PLOT))
      : false;

    if (entryLong && entryShort) {
      return strategyApi.skip('PINE_SIGNAL_CONFLICT');
    }

    // If a position already exists, use Pine exits or opposite entry as a close trigger.
    if (positionExists && position) {
      if (
        (position.direction === 'LONG' && (exitLong || entryShort)) ||
        (position.direction === 'SHORT' && (exitShort || entryLong))
      ) {
        return {
          kind: 'exit',
          code: 'CLOSE_BY_PINE_SIGNAL',
          closePlan: {
            price: currentPrice,
            timestamp,
            direction: position.direction,
          },
        };
      }

      return strategyApi.skip('POSITION_HELD');
    }

    if (!entryLong && !entryShort) {
      return strategyApi.skip('NO_SIGNAL');
    }

    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('TRADE_COOLDOWN');
    }

    const modeConfig = entryLong ? LONG : SHORT;
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
        maxLossValue: MAX_LOSS_VALUE,
        feePercent: Number(FEE_PERCENT ?? 0),
      });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const correlation = indicatorsState.latestNumber('correlation');
    if (
      ENV !== 'BACKTEST' &&
      correlation != null &&
      correlation >= MAX_CORRELATION
    ) {
      return strategyApi.skip(`MAX_CORRELATION:${round(correlation)}`);
    }

    const indicators = indicatorsState.snapshot();
    const pineLinePlots = Array.isArray(PINE_LINE_PLOTS) ? PINE_LINE_PLOTS : [];
    const pineLatestValues = Object.fromEntries(
      pineLinePlots.map((plotName) => {
        const value = asFiniteNumber(
          getLatestPinePlotValue(pineContext, plotName),
        );
        return [plotName, value ?? null];
      }),
    );

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: entryLong ? 'PINE_ENTRY_LONG' : 'PINE_ENTRY_SHORT',
      direction: modeConfig.direction,
      timestamp,
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio,
      },
      figures: buildPineScriptFigures({
        pineContext,
        linePlots: pineLinePlots,
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      indicators,
      additionalIndicators: {
        pine: {
          entryLong,
          entryShort,
          exitLong,
          exitShort,
          lineValues: pineLatestValues,
        },
        correlation,
      },
      orderPlan: {
        qty,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
