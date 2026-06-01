import { round } from '@tradejs/core/math';
import { createTrendlineEngine } from '@tradejs/core/indicators';

import { filterByVeryVolatility } from './filters';
import { TrendLineConfig } from './config';
import { buildTrendLineFigures } from './figures';
import {
  buildTrendlineStructuralContext,
  buildTrendlineTimingContext,
} from './guardrails';
import { buildTrendlineRiskPlan } from './risk';
import {
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
  TrendLine,
  TrendLineOptions,
} from '@tradejs/types';

const buildTrendlineSignalSeed = ({
  direction,
  currentPrice,
  indicators,
  bestLine,
  trendlineTiming,
}: {
  direction: TrendLineConfig['HIGHS']['direction'];
  currentPrice: number;
  indicators: Record<string, unknown>;
  bestLine: TrendLine;
  trendlineTiming?: Record<string, unknown>;
}) => ({
  direction,
  prices: { currentPrice },
  indicators,
  additionalIndicators: {
    touches: bestLine.touches.length + 2,
    distance: bestLine.distance,
    trendLine: bestLine,
    ...(trendlineTiming ? { trendlineTiming } : {}),
  },
  figures: {
    trendLine: bestLine,
  },
});

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

const isFailedBreakout = ({
  direction,
  priceVsLinePct,
}: {
  direction: Direction;
  priceVsLinePct: number | null;
}) => {
  if (priceVsLinePct == null) {
    return false;
  }

  return direction === 'LONG' ? priceVsLinePct < 0 : priceVsLinePct > 0;
};

export const createTrendLineCore: CreateStrategyCore<
  TrendLineConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: cachedData, strategyApi, indicatorsState }) => {
  const { TRENDLINE, FEE_PERCENT, MAX_LOSS_VALUE, HIGHS, LOWS } = config;

  const lastTradeController = strategyApi.createLastTradeController();

  const trendlineOptions: Partial<TrendLineOptions> = {
    bestLines: 1,
    capture: true,
    ...TRENDLINE,
  };

  const getLowsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'lows',
    ...trendlineOptions,
  });

  const getHighsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'highs',
    ...trendlineOptions,
  });

  return async (candle) => {
    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

    indicatorsState.onBar();
    const currentPosition = await strategyApi.getCurrentPosition();

    if (isOpenPosition(currentPosition)) {
      const { currentPrice } = await strategyApi.getMarketData();
      const activeLine =
        currentPosition.direction === 'LONG'
          ? highsTrendlines[0]
          : lowsTrendlines[0];
      const activeModeConfig =
        currentPosition.direction === 'LONG' ? HIGHS : LOWS;

      if (activeLine) {
        const indicators = indicatorsState.snapshot();
        const manageSignalSeed = buildTrendlineSignalSeed({
          direction: activeModeConfig.direction,
          currentPrice,
          indicators: indicators as Record<string, unknown>,
          bestLine: activeLine,
        });
        const structuralContext =
          buildTrendlineStructuralContext(manageSignalSeed);

        if (
          isFailedBreakout({
            direction: currentPosition.direction,
            priceVsLinePct: structuralContext.priceVsLinePct,
          })
        ) {
          return strategyApi.exit({
            code: 'TRENDLINE_FAILED_BREAKOUT_EXIT',
            direction: currentPosition.direction,
          });
        }
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    const bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

    if (!bestLine) {
      return strategyApi.skip('NO_TRENDLINE');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig = bestLine.mode === 'highs' ? HIGHS : LOWS;
    const { direction, minRiskRatio, enable } = modeConfig;

    if (!enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { fullData, timestamp, currentPrice } =
      await strategyApi.getMarketData();

    if (!filterByVeryVolatility(fullData)) {
      return strategyApi.skip('VERY_VOLATILITY');
    }

    const indicators = indicatorsState.snapshot();
    const signalSeed = buildTrendlineSignalSeed({
      direction,
      currentPrice,
      indicators: indicators as Record<string, unknown>,
      bestLine,
    });
    const structuralContext = buildTrendlineStructuralContext(signalSeed);

    if (structuralContext.structuralHardBlockReasons.length > 0) {
      return strategyApi.skip(
        `TRENDLINE_STRUCTURE:${structuralContext.structuralHardBlockReasons[0]}`,
      );
    }

    const timingContext = buildTrendlineTimingContext({
      signal: signalSeed,
      candles: fullData,
      structuralContext,
    });

    if (!timingContext.entryReadyNow) {
      const timingCode =
        timingContext.entryTiming === 'stale_breakout'
          ? 'STALE_BREAKOUT'
          : timingContext.entryTiming === 'wait_retest_confirmation'
            ? 'WAIT_RETEST_CONFIRMATION'
            : 'WAIT_RETEST';
      return strategyApi.skip(`TRENDLINE_TIMING:${timingCode}`);
    }

    const riskPlan = buildTrendlineRiskPlan({
      direction,
      modeConfig,
      baseStopLossDelta: Number(config.TRENDLINE_STOP_BASE_PCT ?? 1.3),
      baseTargetRiskRatio: Number(config.TRENDLINE_TARGET_R_MULT ?? 2.6),
      structuralContext,
      timingContext,
    });

    const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction,
        takeProfitDelta: riskPlan.takeProfitDelta,
        stopLossDelta: riskPlan.stopLossDelta,
        unit: 'percent',
        maxLossValue: MAX_LOSS_VALUE,
        feePercent: Number(FEE_PERCENT ?? 0),
      });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: 'TRENDLINE_SIGNAL',
      figures: {
        ...buildTrendLineFigures(bestLine),
      },
      direction,
      indicators,
      additionalIndicators: buildTrendlineSignalSeed({
        direction,
        currentPrice,
        indicators: indicators as Record<string, unknown>,
        bestLine,
        trendlineTiming: timingContext as Record<string, unknown>,
      }).additionalIndicators,
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
