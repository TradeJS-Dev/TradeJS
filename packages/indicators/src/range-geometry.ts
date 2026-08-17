import type { Candle } from '@tradejs/types';

export interface CausalRangePivot {
  kind: 'high' | 'low';
  barIndex: number;
  timestamp: number;
  price: number;
}

export interface CausalRangeLine {
  startTimestamp: number;
  startPrice: number;
  endTimestamp: number;
  endPrice: number;
}

export interface CausalRangeGeometry {
  ready: boolean;
  detected: boolean;
  upperPrice: number | null;
  lowerPrice: number | null;
  centerPrice: number | null;
  position: number | null;
  widthAtr: number | null;
  centerSlopeAtrPerBar: number | null;
  boundaryDivergenceAtr: number | null;
  containmentRatio: number | null;
  highPivotCount: number;
  lowPivotCount: number;
  rangeAgeBars: number;
  breakoutDirection: 'UP' | 'DOWN' | null;
  volatilityExpansionRatio: number | null;
  volatilityExpansion: boolean;
  upperLine: CausalRangeLine | null;
  lowerLine: CausalRangeLine | null;
  centerLine: CausalRangeLine | null;
  pivots: CausalRangePivot[];
  historySize: number;
  pivotHistorySize: number;
}

export interface CausalRangeGeometryOptions {
  pivotLeftBars: number;
  pivotRightBars: number;
  lookbackBars: number;
  minPivotsPerSide: number;
  minWidthAtr: number;
  maxWidthAtr: number;
  maxCenterSlopeAtrPerBar: number;
  maxBoundaryDivergenceAtr: number;
  minContainmentRatio: number;
  containmentToleranceAtr: number;
  breakoutToleranceAtr: number;
  minRangeAgeBars: number;
  maxVolatilityExpansion: number;
  lineStartMode?: 'history' | 'oldest_pivot';
}

interface IndexedCandle extends Candle {
  barIndex: number;
}

interface RegressionLine {
  currentValue: number;
  slopePerBar: number;
}

const getEmptyGeometry = (): CausalRangeGeometry => ({
  ready: false,
  detected: false,
  upperPrice: null,
  lowerPrice: null,
  centerPrice: null,
  position: null,
  widthAtr: null,
  centerSlopeAtrPerBar: null,
  boundaryDivergenceAtr: null,
  containmentRatio: null,
  highPivotCount: 0,
  lowPivotCount: 0,
  rangeAgeBars: 0,
  breakoutDirection: null,
  volatilityExpansionRatio: null,
  volatilityExpansion: false,
  upperLine: null,
  lowerLine: null,
  centerLine: null,
  pivots: [],
  historySize: 0,
  pivotHistorySize: 0,
});

const fitRegression = (
  pivots: CausalRangePivot[],
  currentBarIndex: number,
): RegressionLine | null => {
  if (pivots.length < 2) return null;

  const points = pivots.map((pivot) => ({
    x: pivot.barIndex - currentBarIndex,
    y: pivot.price,
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covariance = 0;
  let variance = 0;

  for (const point of points) {
    const offsetX = point.x - meanX;
    covariance += offsetX * (point.y - meanY);
    variance += offsetX * offsetX;
  }

  if (variance <= Number.EPSILON) return null;
  const slopePerBar = covariance / variance;
  return {
    currentValue: meanY - slopePerBar * meanX,
    slopePerBar,
  };
};

const hasConfirmedPivotHigh = ({
  candles,
  candidateIndex,
  leftBars,
  rightBars,
}: {
  candles: IndexedCandle[];
  candidateIndex: number;
  leftBars: number;
  rightBars: number;
}) => {
  const candidate = candles[candidateIndex];
  if (!candidate) return false;

  for (
    let index = candidateIndex - leftBars;
    index <= candidateIndex + rightBars;
    index += 1
  ) {
    if (index === candidateIndex) continue;
    if ((candles[index]?.high ?? Number.POSITIVE_INFINITY) >= candidate.high) {
      return false;
    }
  }
  return true;
};

const hasConfirmedPivotLow = ({
  candles,
  candidateIndex,
  leftBars,
  rightBars,
}: {
  candles: IndexedCandle[];
  candidateIndex: number;
  leftBars: number;
  rightBars: number;
}) => {
  const candidate = candles[candidateIndex];
  if (!candidate) return false;

  for (
    let index = candidateIndex - leftBars;
    index <= candidateIndex + rightBars;
    index += 1
  ) {
    if (index === candidateIndex) continue;
    if ((candles[index]?.low ?? Number.NEGATIVE_INFINITY) <= candidate.low) {
      return false;
    }
  }
  return true;
};

const isFiniteCandle = (candle: Candle) =>
  [candle.timestamp, candle.open, candle.high, candle.low, candle.close].every(
    Number.isFinite,
  );

export const createCausalRangeGeometryEngine = ({
  options,
}: {
  options: CausalRangeGeometryOptions;
}) => {
  const candleLimit = Math.max(
    options.lookbackBars,
    options.pivotLeftBars + options.pivotRightBars + 1,
  );
  const candles: IndexedCandle[] = [];
  const pivots: CausalRangePivot[] = [];
  const atrHistory: number[] = [];
  let barIndex = -1;
  let lastTimestamp: number | null = null;
  let geometry = getEmptyGeometry();

  const next = (candle: Candle, atr: number): CausalRangeGeometry => {
    if (!isFiniteCandle(candle)) return geometry;
    if (lastTimestamp != null && candle.timestamp <= lastTimestamp) {
      return geometry;
    }

    lastTimestamp = candle.timestamp;
    barIndex += 1;
    candles.push({ ...candle, barIndex });
    if (candles.length > candleLimit) {
      candles.splice(0, candles.length - candleLimit);
    }

    const finiteAtr = Number.isFinite(atr) && atr > 0 ? atr : null;
    if (finiteAtr != null) {
      atrHistory.push(finiteAtr);
      if (atrHistory.length > options.lookbackBars) {
        atrHistory.splice(0, atrHistory.length - options.lookbackBars);
      }
    }

    const candidateArrayIndex = candles.length - 1 - options.pivotRightBars;
    if (candidateArrayIndex >= options.pivotLeftBars) {
      const candidate = candles[candidateArrayIndex];
      if (
        hasConfirmedPivotHigh({
          candles,
          candidateIndex: candidateArrayIndex,
          leftBars: options.pivotLeftBars,
          rightBars: options.pivotRightBars,
        })
      ) {
        pivots.push({
          kind: 'high',
          barIndex: candidate.barIndex,
          timestamp: candidate.timestamp,
          price: candidate.high,
        });
      }
      if (
        hasConfirmedPivotLow({
          candles,
          candidateIndex: candidateArrayIndex,
          leftBars: options.pivotLeftBars,
          rightBars: options.pivotRightBars,
        })
      ) {
        pivots.push({
          kind: 'low',
          barIndex: candidate.barIndex,
          timestamp: candidate.timestamp,
          price: candidate.low,
        });
      }
    }

    const firstRetainedBarIndex = barIndex - options.lookbackBars + 1;
    while (pivots.length > 0 && pivots[0].barIndex < firstRetainedBarIndex) {
      pivots.shift();
    }

    const highPivots = pivots.filter((pivot) => pivot.kind === 'high');
    const lowPivots = pivots.filter((pivot) => pivot.kind === 'low');
    const upper = fitRegression(highPivots, barIndex);
    const lower = fitRegression(lowPivots, barIndex);
    const volatilityBaseline =
      atrHistory.length > 0
        ? atrHistory.reduce((sum, value) => sum + value, 0) / atrHistory.length
        : null;
    const volatilityExpansionRatio =
      finiteAtr != null && volatilityBaseline != null && volatilityBaseline > 0
        ? finiteAtr / volatilityBaseline
        : null;
    const volatilityExpansion =
      options.maxVolatilityExpansion > 0 &&
      volatilityExpansionRatio != null &&
      volatilityExpansionRatio > options.maxVolatilityExpansion;

    if (
      upper == null ||
      lower == null ||
      finiteAtr == null ||
      upper.currentValue <= lower.currentValue
    ) {
      geometry = {
        ...getEmptyGeometry(),
        highPivotCount: highPivots.length,
        lowPivotCount: lowPivots.length,
        volatilityExpansionRatio,
        volatilityExpansion,
        pivots: pivots.map((pivot) => ({ ...pivot })),
        historySize: candles.length,
        pivotHistorySize: pivots.length,
      };
      return geometry;
    }

    const oldestPivotIndex = Math.min(...pivots.map((pivot) => pivot.barIndex));
    const firstCandle =
      options.lineStartMode === 'history'
        ? candles[0]
        : candles.find((item) => item.barIndex >= oldestPivotIndex) ??
          candles[0];
    const startOffset = firstCandle.barIndex - barIndex;
    const upperStartPrice =
      upper.currentValue + upper.slopePerBar * startOffset;
    const lowerStartPrice =
      lower.currentValue + lower.slopePerBar * startOffset;
    const centerPrice = (upper.currentValue + lower.currentValue) / 2;
    const centerStartPrice = (upperStartPrice + lowerStartPrice) / 2;
    const width = upper.currentValue - lower.currentValue;
    const widthAtr = width / finiteAtr;
    const centerSlopeAtrPerBar =
      (upper.slopePerBar + lower.slopePerBar) / 2 / finiteAtr;
    const spanBars = Math.max(1, barIndex - firstCandle.barIndex);
    const boundaryDivergenceAtr =
      (Math.abs(upper.slopePerBar - lower.slopePerBar) * spanBars) / finiteAtr;
    const tolerance = finiteAtr * options.containmentToleranceAtr;
    const containedCandles = candles.filter((item) => {
      const offset = item.barIndex - barIndex;
      const projectedUpper =
        upper.currentValue + upper.slopePerBar * offset + tolerance;
      const projectedLower =
        lower.currentValue + lower.slopePerBar * offset - tolerance;
      return item.close <= projectedUpper && item.close >= projectedLower;
    }).length;
    const containmentRatio =
      candles.length > 0 ? containedCandles / candles.length : 0;
    const rangeAgeBars = spanBars + 1;
    const enoughPivots =
      highPivots.length >= options.minPivotsPerSide &&
      lowPivots.length >= options.minPivotsPerSide;
    const ready = enoughPivots;
    const detected =
      ready &&
      rangeAgeBars >= options.minRangeAgeBars &&
      widthAtr >= options.minWidthAtr &&
      (options.maxWidthAtr === 0 || widthAtr <= options.maxWidthAtr) &&
      Math.abs(centerSlopeAtrPerBar) <= options.maxCenterSlopeAtrPerBar &&
      boundaryDivergenceAtr <= options.maxBoundaryDivergenceAtr &&
      containmentRatio >= options.minContainmentRatio &&
      !volatilityExpansion;
    const breakoutBuffer = finiteAtr * options.breakoutToleranceAtr;
    const breakoutDirection =
      candle.close > upper.currentValue + breakoutBuffer
        ? 'UP'
        : candle.close < lower.currentValue - breakoutBuffer
          ? 'DOWN'
          : null;
    const endTimestamp = candle.timestamp;

    geometry = {
      ready,
      detected,
      upperPrice: upper.currentValue,
      lowerPrice: lower.currentValue,
      centerPrice,
      position: width > 0 ? (candle.close - lower.currentValue) / width : null,
      widthAtr,
      centerSlopeAtrPerBar,
      boundaryDivergenceAtr,
      containmentRatio,
      highPivotCount: highPivots.length,
      lowPivotCount: lowPivots.length,
      rangeAgeBars,
      breakoutDirection,
      volatilityExpansionRatio,
      volatilityExpansion,
      upperLine: {
        startTimestamp: firstCandle.timestamp,
        startPrice: upperStartPrice,
        endTimestamp,
        endPrice: upper.currentValue,
      },
      lowerLine: {
        startTimestamp: firstCandle.timestamp,
        startPrice: lowerStartPrice,
        endTimestamp,
        endPrice: lower.currentValue,
      },
      centerLine: {
        startTimestamp: firstCandle.timestamp,
        startPrice: centerStartPrice,
        endTimestamp,
        endPrice: centerPrice,
      },
      pivots: pivots.map((pivot) => ({ ...pivot })),
      historySize: candles.length,
      pivotHistorySize: pivots.length,
    };
    return geometry;
  };

  return {
    next,
    getState: () => ({
      ...geometry,
      pivots: geometry.pivots.map((pivot) => ({ ...pivot })),
      upperLine: geometry.upperLine ? { ...geometry.upperLine } : null,
      lowerLine: geometry.lowerLine ? { ...geometry.lowerLine } : null,
      centerLine: geometry.centerLine ? { ...geometry.centerLine } : null,
    }),
  };
};
