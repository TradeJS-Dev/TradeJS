import { round } from '@tradejs/core/math';
import { createTrendlineEngine } from '@tradejs/core/indicators';

import { filterByVeryVolatility } from './filters';
import { ReverseTrendLineConfig } from './config';
import { buildReverseTrendLineFigures } from './figures';
import {
  buildReverseTrendlineStructuralContext,
  buildReverseTrendlineTimingContext,
  toFiniteNumberOrNull,
} from './guardrails';
import { buildReverseTrendlineRiskPlan } from './risk';
import {
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
  TrendLine,
  TrendLineOptions,
} from '@tradejs/types';

const buildReverseTrendlineSignalSeed = ({
  direction,
  currentPrice,
  indicators,
  bestLine,
  currentCandle,
  reverseTrendlineTiming,
}: {
  direction: Direction;
  currentPrice: number;
  indicators: Record<string, unknown>;
  bestLine: TrendLine;
  currentCandle?: Record<string, unknown>;
  reverseTrendlineTiming?: Record<string, unknown>;
}) => ({
  direction,
  prices: { currentPrice },
  indicators,
  additionalIndicators: {
    touches: Array.isArray(bestLine.touches) ? bestLine.touches.length + 2 : 2,
    distance: bestLine.distance,
    trendLine: bestLine,
    ...(currentCandle ? { currentCandle } : {}),
    ...(reverseTrendlineTiming ? { reverseTrendlineTiming } : {}),
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

const getLinePriceAtNow = (line: TrendLine | null, timestamp: number) => {
  if (!line || !Array.isArray(line.points) || line.points.length === 0) {
    return null;
  }

  const sortedPoints = [...line.points].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const first = sortedPoints[0];
  const last = sortedPoints[sortedPoints.length - 1];
  if (first.timestamp === last.timestamp) {
    return last.value;
  }

  const slope = (last.value - first.value) / (last.timestamp - first.timestamp);
  return first.value + slope * (timestamp - first.timestamp);
};

const buildReverseTrendlineCandidateContext = ({
  line,
  candle,
  direction,
}: {
  line: TrendLine;
  candle: {
    timestamp: number;
    open: number;
    close: number;
    high: number;
    low: number;
  };
  direction: Direction;
}) => {
  const currentLinePrice = getLinePriceAtNow(line, candle.timestamp);
  const priceVsLinePct =
    currentLinePrice != null && currentLinePrice !== 0
      ? ((candle.close - currentLinePrice) / currentLinePrice) * 100
      : null;
  const priceVsLinePctAbs =
    priceVsLinePct == null ? null : Math.abs(priceVsLinePct);
  const lineTouchedNow =
    currentLinePrice != null &&
    candle.low <= currentLinePrice &&
    candle.high >= currentLinePrice;
  const failedBounceBreak =
    direction === 'LONG'
      ? priceVsLinePct != null && priceVsLinePct <= -0.35
      : priceVsLinePct != null && priceVsLinePct >= 0.35;

  return {
    currentLinePrice,
    priceVsLinePctAbs,
    lineTouchedNow,
    failedBounceBreak,
    distance: toFiniteNumberOrNull(line.distance),
  };
};

const pickBestCandidateLine = ({
  candle,
  lines,
}: {
  candle: {
    timestamp: number;
    open: number;
    close: number;
    high: number;
    low: number;
  };
  lines: Array<{ line: TrendLine; direction: Direction }>;
}) => {
  const ranked = lines
    .map(({ line, direction }) => {
      const candidateContext = buildReverseTrendlineCandidateContext({
        line,
        candle,
        direction,
      });
      return { line, direction, candidateContext };
    })
    .filter(({ candidateContext }) => candidateContext.currentLinePrice != null)
    .sort((left, right) => {
      const leftTouchRank = left.candidateContext.lineTouchedNow ? 0 : 1;
      const rightTouchRank = right.candidateContext.lineTouchedNow ? 0 : 1;
      if (leftTouchRank !== rightTouchRank) {
        return leftTouchRank - rightTouchRank;
      }

      const leftDistance =
        left.candidateContext.priceVsLinePctAbs ?? Number.POSITIVE_INFINITY;
      const rightDistance =
        right.candidateContext.priceVsLinePctAbs ?? Number.POSITIVE_INFINITY;
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return (
        (left.candidateContext.distance ?? Number.POSITIVE_INFINITY) -
        (right.candidateContext.distance ?? Number.POSITIVE_INFINITY)
      );
    });

  return ranked[0] ?? null;
};

export const createReverseTrendLineCore: CreateStrategyCore<
  ReverseTrendLineConfig,
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
      const activeLine =
        currentPosition.direction === 'LONG'
          ? lowsTrendlines[0]
          : highsTrendlines[0];
      const activeLinePrice = getLinePriceAtNow(
        activeLine ?? null,
        candle.timestamp,
      );
      const priceVsLinePct =
        activeLinePrice != null && activeLinePrice !== 0
          ? ((candle.close - activeLinePrice) / activeLinePrice) * 100
          : null;
      const failedBounceBreak =
        currentPosition.direction === 'LONG'
          ? priceVsLinePct != null && priceVsLinePct <= -0.35
          : priceVsLinePct != null && priceVsLinePct >= 0.35;

      if (failedBounceBreak) {
        return strategyApi.exit({
          code: 'REVERSE_TRENDLINE_FAILED_BOUNCE_EXIT',
          direction: currentPosition.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const candidates: Array<{ line: TrendLine; direction: Direction }> = [];

    if (LOWS.enable && lowsTrendlines.length > 0) {
      candidates.push({ line: lowsTrendlines[0], direction: LOWS.direction });
    }

    if (HIGHS.enable && highsTrendlines.length > 0) {
      candidates.push({ line: highsTrendlines[0], direction: HIGHS.direction });
    }

    if (candidates.length === 0) {
      return strategyApi.skip('NO_TRENDLINE');
    }

    const bestCandidate = pickBestCandidateLine({
      candle: {
        timestamp: candle.timestamp,
        open: candle.open,
        close: candle.close,
        high: candle.high,
        low: candle.low,
      },
      lines: candidates,
    });

    if (!bestCandidate) {
      return strategyApi.skip('NO_TRENDLINE');
    }

    const { line: bestLine, direction, candidateContext } = bestCandidate;
    const modeConfig = direction === 'LONG' ? LOWS : HIGHS;
    const { minRiskRatio } = modeConfig;

    if (candidateContext.failedBounceBreak) {
      return strategyApi.skip(
        'REVERSE_TRENDLINE_STRUCTURE:failed_bounce_break',
      );
    }

    const { fullData, timestamp, currentPrice } =
      await strategyApi.getMarketData();

    if (!filterByVeryVolatility(fullData)) {
      return strategyApi.skip('VERY_VOLATILITY');
    }

    const indicators = indicatorsState.snapshot();

    const signalSeed = buildReverseTrendlineSignalSeed({
      direction,
      currentPrice,
      indicators: indicators as Record<string, unknown>,
      bestLine,
      currentCandle: {
        timestamp: candle.timestamp,
        open: candle.open,
        close: candle.close,
        high: candle.high,
        low: candle.low,
      },
    });

    const structuralContext =
      buildReverseTrendlineStructuralContext(signalSeed);

    const timingContext = buildReverseTrendlineTimingContext({
      signal: signalSeed,
      candles: fullData,
      structuralContext,
    });

    if (!timingContext.entryReadyNow) {
      const timingCode =
        timingContext.entryTiming === 'stale_reaction'
          ? 'STALE_REACTION'
          : timingContext.entryTiming === 'wait_reaction_confirmation'
            ? 'WAIT_REACTION_CONFIRMATION'
            : 'WAIT_TOUCH';
      return strategyApi.skip(`REVERSE_TRENDLINE_TIMING:${timingCode}`);
    }

    const riskPlan = buildReverseTrendlineRiskPlan({
      direction,
      modeConfig,
      baseStopLossDelta: Number(config.REVERSE_TRENDLINE_STOP_BASE_PCT ?? 1.1),
      baseTargetRiskRatio: Number(
        config.REVERSE_TRENDLINE_TARGET_R_MULT ?? 2.05,
      ),
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
      code: 'REVERSE_TRENDLINE_SIGNAL',
      figures: {
        ...buildReverseTrendLineFigures(bestLine),
      },
      direction,
      indicators,
      additionalIndicators: buildReverseTrendlineSignalSeed({
        direction,
        currentPrice,
        indicators: indicators as Record<string, unknown>,
        bestLine,
        currentCandle: {
          timestamp: candle.timestamp,
          open: candle.open,
          close: candle.close,
          high: candle.high,
          low: candle.low,
        },
        reverseTrendlineTiming: timingContext as Record<string, unknown>,
      }).additionalIndicators,
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
