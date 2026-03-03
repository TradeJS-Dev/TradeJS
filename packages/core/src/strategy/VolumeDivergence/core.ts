import { round } from '@utils/math';
import { Candle, CreateStrategyCore, IndicatorsHistorySnapshot } from '@types';
import { VolumeDivergenceConfig } from './config';
import { buildVolumeDivergenceFigures } from './figures';

type PivotDivergence = {
  currentPivotIndex: number;
  previousPivotIndex: number;
  currentPivotVolumeNorm: number;
  previousPivotVolumeNorm: number;
  currentPivotLow: number;
  previousPivotLow: number;
  currentPivotHigh: number;
  previousPivotHigh: number;
  currentPivotVolume: number;
  currentPivotDelta: number;
  barsBetweenPivotConfirmations: number;
  kind: 'bullish' | 'bearish';
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const appendNormalizedVolumes = ({
  candles,
  length,
  normalizedVolumes,
}: {
  candles: Candle[];
  length: number;
  normalizedVolumes: number[];
}) => {
  while (normalizedVolumes.length < candles.length) {
    const i = normalizedVolumes.length;
    const start = Math.max(0, i - length + 1);
    let highest = 0;
    for (let j = start; j <= i; j += 1) {
      highest = Math.max(highest, Number(candles[j]?.volume) || 0);
    }

    const volume = Number(candles[i]?.volume) || 0;
    normalizedVolumes.push(highest > 0 ? (volume / highest) * 100 : 0);
  }
};

const isPivotHigh = ({
  values,
  index,
  left,
  right,
}: {
  values: number[];
  index: number;
  left: number;
  right: number;
}) => {
  const pivotValue = values[index];
  if (!isFiniteNumber(pivotValue)) {
    return false;
  }

  if (index - left < 0 || index + right >= values.length) {
    return false;
  }

  for (let i = index - left; i <= index + right; i += 1) {
    if (i === index) continue;
    if (!isFiniteNumber(values[i]) || values[i] >= pivotValue) {
      return false;
    }
  }

  return true;
};

const candleDeltaProxy = (candle: Candle): number => {
  const volume = Number(candle.volume) || 0;
  const range = Math.max(Math.abs(candle.high - candle.low), 1e-9);
  const bodyBias = (candle.close - candle.open) / range;
  return volume * clamp(bodyBias, -1, 1);
};

const findLatestDivergence = ({
  candles,
  normalizedVolumes,
  lookbackLeft,
  lookbackRight,
  rangeLower,
  rangeUpper,
}: {
  candles: Candle[];
  normalizedVolumes: number[];
  lookbackLeft: number;
  lookbackRight: number;
  rangeLower: number;
  rangeUpper: number;
}): PivotDivergence | null => {
  const currentConfirmationIndex = candles.length - 1;
  const currentPivotIndex = currentConfirmationIndex - lookbackRight;
  if (currentPivotIndex <= 0) {
    return null;
  }

  if (
    !isPivotHigh({
      values: normalizedVolumes,
      index: currentPivotIndex,
      left: lookbackLeft,
      right: lookbackRight,
    })
  ) {
    return null;
  }

  let previousPivotIndex = -1;
  for (let i = currentPivotIndex - 1; i >= lookbackLeft; i -= 1) {
    if (
      isPivotHigh({
        values: normalizedVolumes,
        index: i,
        left: lookbackLeft,
        right: lookbackRight,
      })
    ) {
      previousPivotIndex = i;
      break;
    }
  }

  if (previousPivotIndex < 0) {
    return null;
  }

  const previousConfirmationIndex = previousPivotIndex + lookbackRight;
  const barsBetweenPivotConfirmations =
    currentConfirmationIndex - previousConfirmationIndex - 1;
  if (
    barsBetweenPivotConfirmations < rangeLower ||
    barsBetweenPivotConfirmations > rangeUpper
  ) {
    return null;
  }

  const currentPivotVolumeNorm = normalizedVolumes[currentPivotIndex];
  const previousPivotVolumeNorm = normalizedVolumes[previousPivotIndex];
  const currentPivotLow = Number(candles[currentPivotIndex]?.low);
  const previousPivotLow = Number(candles[previousPivotIndex]?.low);
  const currentPivotHigh = Number(candles[currentPivotIndex]?.high);
  const previousPivotHigh = Number(candles[previousPivotIndex]?.high);
  const currentPivotCandle = candles[currentPivotIndex];

  if (
    !isFiniteNumber(currentPivotVolumeNorm) ||
    !isFiniteNumber(previousPivotVolumeNorm) ||
    !isFiniteNumber(currentPivotLow) ||
    !isFiniteNumber(previousPivotLow) ||
    !isFiniteNumber(currentPivotHigh) ||
    !isFiniteNumber(previousPivotHigh)
  ) {
    return null;
  }

  const volHigherLow = currentPivotVolumeNorm > previousPivotVolumeNorm;
  const volLowerHigh = currentPivotVolumeNorm < previousPivotVolumeNorm;
  const priceLowerLow = currentPivotLow < previousPivotLow;
  const priceHigherHigh = currentPivotHigh > previousPivotHigh;

  if (priceLowerLow && volHigherLow) {
    return {
      currentPivotIndex,
      previousPivotIndex,
      currentPivotVolumeNorm,
      previousPivotVolumeNorm,
      currentPivotLow,
      previousPivotLow,
      currentPivotHigh,
      previousPivotHigh,
      currentPivotVolume: Number(currentPivotCandle.volume) || 0,
      currentPivotDelta: candleDeltaProxy(currentPivotCandle),
      barsBetweenPivotConfirmations,
      kind: 'bullish',
    };
  }

  if (priceHigherHigh && volLowerHigh) {
    return {
      currentPivotIndex,
      previousPivotIndex,
      currentPivotVolumeNorm,
      previousPivotVolumeNorm,
      currentPivotLow,
      previousPivotLow,
      currentPivotHigh,
      previousPivotHigh,
      currentPivotVolume: Number(currentPivotCandle.volume) || 0,
      currentPivotDelta: candleDeltaProxy(currentPivotCandle),
      barsBetweenPivotConfirmations,
      kind: 'bearish',
    };
  }

  return null;
};

export const createVolumeDivergenceCore: CreateStrategyCore<
  VolumeDivergenceConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi, indicatorsState }) => {
  const {
    NORMALIZATION_LENGTH,
    PIVOT_LOOKBACK_LEFT,
    PIVOT_LOOKBACK_RIGHT,
    MAX_BARS_BETWEEN_PIVOTS,
    MIN_BARS_BETWEEN_PIVOTS,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    MAX_CORRELATION,
    ENV,
    BULLISH,
    BEARISH,
  } = config;

  const lastTradeController = strategyApi.createLastTradeController();
  const normalizedVolumes: number[] = [];

  return async () => {
    indicatorsState.onBar();

    const positionExists = await strategyApi.isCurrentPositionExists();
    if (positionExists) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    const { fullData, timestamp, currentPrice } =
      await strategyApi.getMarketData();

    if (fullData.length < PIVOT_LOOKBACK_LEFT + PIVOT_LOOKBACK_RIGHT + 2) {
      return strategyApi.skip('WAIT_DATA');
    }

    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    appendNormalizedVolumes({
      candles: fullData,
      length: NORMALIZATION_LENGTH,
      normalizedVolumes,
    });

    const divergence = findLatestDivergence({
      candles: fullData,
      normalizedVolumes,
      lookbackLeft: PIVOT_LOOKBACK_LEFT,
      lookbackRight: PIVOT_LOOKBACK_RIGHT,
      rangeLower: MIN_BARS_BETWEEN_PIVOTS,
      rangeUpper: MAX_BARS_BETWEEN_PIVOTS,
    });

    if (!divergence) {
      return strategyApi.skip('NO_DIVERGENCE');
    }

    const modeConfig = divergence.kind === 'bullish' ? BULLISH : BEARISH;
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

    const indicators = indicatorsState.snapshot();
    const correlation = indicatorsState.latestNumber('correlation');

    if (
      ENV !== 'BACKTEST' &&
      correlation != null &&
      correlation >= MAX_CORRELATION
    ) {
      return strategyApi.skip(`MAX_CORRELATION:${round(correlation)}`);
    }

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: 'VOLUME_DIVERGENCE_REVERSAL_SIGNAL',
      direction: modeConfig.direction,
      timestamp,
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio,
      },
      figures: buildVolumeDivergenceFigures({
        kind: divergence.kind,
        previousPivotIndex: divergence.previousPivotIndex,
        currentPivotIndex: divergence.currentPivotIndex,
        previousPivotLow: divergence.previousPivotLow,
        previousPivotHigh: divergence.previousPivotHigh,
        currentPivotLow: divergence.currentPivotLow,
        currentPivotHigh: divergence.currentPivotHigh,
        fullData,
      }),
      indicators,
      additionalIndicators: {
        divergenceKind: divergence.kind,
        normalizedVolumeAtPivot: divergence.currentPivotVolumeNorm,
        previousNormalizedVolumeAtPivot: divergence.previousPivotVolumeNorm,
        volumeAtPivot: divergence.currentPivotVolume,
        deltaAtPivot: divergence.currentPivotDelta,
        barsBetweenPivotConfirmations: divergence.barsBetweenPivotConfirmations,
        divergence: {
          kind: divergence.kind,
          pivotLookbackLeft: PIVOT_LOOKBACK_LEFT,
          pivotLookbackRight: PIVOT_LOOKBACK_RIGHT,
          currentPivot: {
            index: divergence.currentPivotIndex,
            timestamp: fullData[divergence.currentPivotIndex]?.timestamp,
            priceLow: divergence.currentPivotLow,
            priceHigh: divergence.currentPivotHigh,
            volumeNorm: divergence.currentPivotVolumeNorm,
          },
          previousPivot: {
            index: divergence.previousPivotIndex,
            timestamp: fullData[divergence.previousPivotIndex]?.timestamp,
            priceLow: divergence.previousPivotLow,
            priceHigh: divergence.previousPivotHigh,
            volumeNorm: divergence.previousPivotVolumeNorm,
          },
          barsBetweenPivotConfirmations:
            divergence.barsBetweenPivotConfirmations,
        },
      },
      orderPlan: {
        qty,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
