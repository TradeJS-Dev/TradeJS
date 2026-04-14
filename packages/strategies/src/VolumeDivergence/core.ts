import { round } from '@tradejs/core/math';

import { VolumeDivergenceConfig, VolumeDivergenceModeConfig } from './config';
import { buildVolumeDivergenceFigures } from './figures';
import {
  buildVolumeDivergenceSetupFeatures,
  getVolumeDivergenceEntryThresholds,
  VolumeDivergenceEntryThresholdSnapshot,
  VolumeDivergenceSetupFeatures,
} from './setup';
import {
  Candle,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';

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

type RollingMaxQueueState = {
  indices: number[];
  start: number;
};

type ConfirmedPivotState = {
  indices: number[];
  nextConfirmationIndex: number;
};

type PendingEntryTiming = 'confirmation_ready' | 'structure_advance';

type PendingDivergenceCandidate = {
  kind: PivotDivergence['kind'];
  direction: VolumeDivergenceModeConfig['direction'];
  currentPivotVolumeNorm: number;
  previousPivotVolumeNorm: number;
  currentPivotLow: number;
  previousPivotLow: number;
  currentPivotHigh: number;
  previousPivotHigh: number;
  currentPivotVolume: number;
  currentPivotDelta: number;
  barsBetweenPivotConfirmations: number;
  currentPivotTimestamp: number | null;
  previousPivotTimestamp: number | null;
  pivotLookbackLeft: number;
  pivotLookbackRight: number;
  detectedAtTimestamp: number;
  lastObservedTimestamp: number;
  barsSinceDetection: number;
};

const BREAK_EVEN_TRIGGER_RISK_MULTIPLIER = 0.5;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const isOpenPosition = (
  position: Position | null | undefined,
): position is Position =>
  Boolean(
    position &&
      typeof position.price === 'number' &&
      Number.isFinite(position.price) &&
      typeof position.qty === 'number' &&
      Number.isFinite(position.qty) &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );

const getFavorableMovePct = ({
  direction,
  entryPrice,
  currentPrice,
}: {
  direction: Direction;
  entryPrice: number;
  currentPrice: number;
}) => {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(currentPrice) ||
    entryPrice <= 0
  ) {
    return null;
  }

  return direction === 'LONG'
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
};

const getPositionStopLossPrice = (position: Position | null | undefined) => {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const slPrice = Number(
    (position as Position & { slPrice?: unknown }).slPrice ?? Number.NaN,
  );

  if (Number.isFinite(slPrice)) {
    return slPrice;
  }

  const signalStopLossPrice = Number(
    (
      position as Position & {
        signal?: { prices?: { stopLossPrice?: unknown } };
      }
    ).signal?.prices?.stopLossPrice ?? Number.NaN,
  );

  return Number.isFinite(signalStopLossPrice) ? signalStopLossPrice : null;
};

const getPositionRiskPct = ({
  direction,
  entryPrice,
  stopLossPrice,
}: {
  direction: Direction;
  entryPrice: number;
  stopLossPrice: number | null;
}) => {
  if (
    stopLossPrice == null ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLossPrice) ||
    entryPrice <= 0
  ) {
    return null;
  }

  return direction === 'LONG'
    ? ((entryPrice - stopLossPrice) / entryPrice) * 100
    : ((stopLossPrice - entryPrice) / entryPrice) * 100;
};

const isBreakEvenStopAlreadyApplied = ({
  direction,
  entryPrice,
  stopLossPrice,
}: {
  direction: Direction;
  entryPrice: number;
  stopLossPrice: number | null;
}) => {
  if (
    stopLossPrice == null ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLossPrice)
  ) {
    return false;
  }

  return direction === 'LONG'
    ? stopLossPrice >= entryPrice
    : stopLossPrice <= entryPrice;
};

const compactQueue = (queue: RollingMaxQueueState) => {
  if (queue.start <= 1024 || queue.start * 2 <= queue.indices.length) {
    return;
  }

  queue.indices.splice(0, queue.start);
  queue.start = 0;
};

const rebaseQueue = (queue: RollingMaxQueueState, offset: number) => {
  queue.indices = queue.indices
    .slice(queue.start)
    .map((index) => index - offset)
    .filter((index) => index >= 0);
  queue.start = 0;
};

const rebaseConfirmedPivots = (state: ConfirmedPivotState, offset: number) => {
  state.indices = state.indices
    .map((index) => index - offset)
    .filter((index) => index >= 0);
  state.nextConfirmationIndex = Math.max(
    0,
    state.nextConfirmationIndex - offset,
  );
};

const appendNormalizedVolumes = ({
  candles,
  length,
  normalizedVolumes,
  queue,
}: {
  candles: Candle[];
  length: number;
  normalizedVolumes: number[];
  queue: RollingMaxQueueState;
}) => {
  while (normalizedVolumes.length < candles.length) {
    const i = normalizedVolumes.length;
    const windowStart = Math.max(0, i - length + 1);
    const volume = Number(candles[i]?.volume) || 0;

    while (
      queue.start < queue.indices.length &&
      queue.indices[queue.start] < windowStart
    ) {
      queue.start += 1;
    }

    while (queue.indices.length > queue.start) {
      const lastIndex = queue.indices[queue.indices.length - 1];
      const lastVolume = Number(candles[lastIndex]?.volume) || 0;
      if (lastVolume > volume) {
        break;
      }
      queue.indices.pop();
    }

    queue.indices.push(i);
    compactQueue(queue);

    const highestIndex = queue.indices[queue.start];
    const highest = Number(candles[highestIndex]?.volume) || 0;
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

const appendConfirmedPivotIndices = ({
  candles,
  normalizedVolumes,
  lookbackLeft,
  lookbackRight,
  state,
}: {
  candles: Candle[];
  normalizedVolumes: number[];
  lookbackLeft: number;
  lookbackRight: number;
  state: ConfirmedPivotState;
}) => {
  const maxConfirmationIndex = candles.length - 1;

  while (state.nextConfirmationIndex <= maxConfirmationIndex) {
    const candidatePivotIndex = state.nextConfirmationIndex - lookbackRight;

    if (
      candidatePivotIndex >= 0 &&
      isPivotHigh({
        values: normalizedVolumes,
        index: candidatePivotIndex,
        left: lookbackLeft,
        right: lookbackRight,
      })
    ) {
      state.indices.push(candidatePivotIndex);
    }

    state.nextConfirmationIndex += 1;
  }
};

const findLatestDivergence = ({
  candles,
  normalizedVolumes,
  confirmedPivots,
  lookbackLeft,
  lookbackRight,
  rangeLower,
  rangeUpper,
}: {
  candles: Candle[];
  normalizedVolumes: number[];
  confirmedPivots: number[];
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

  const lastConfirmedPivotIndex =
    confirmedPivots.length > 0
      ? confirmedPivots[confirmedPivots.length - 1]
      : undefined;

  if (lastConfirmedPivotIndex !== currentPivotIndex) {
    return null;
  }

  const previousPivotIndex =
    confirmedPivots.length > 1
      ? confirmedPivots[confirmedPivots.length - 2]
      : undefined;

  if (previousPivotIndex == null || previousPivotIndex < lookbackLeft) {
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

const getRequiredHistorySize = ({
  normalizationLength,
  lookbackLeft,
  lookbackRight,
  maxBarsBetweenPivots,
}: {
  normalizationLength: number;
  lookbackLeft: number;
  lookbackRight: number;
  maxBarsBetweenPivots: number;
}) =>
  normalizationLength +
  maxBarsBetweenPivots +
  lookbackLeft +
  lookbackRight * 2 +
  8;

const buildPendingDivergenceCandidate = ({
  divergence,
  candleWindow,
  direction,
  pivotLookbackLeft,
  pivotLookbackRight,
  detectedAtTimestamp,
}: {
  divergence: PivotDivergence;
  candleWindow: Candle[];
  direction: VolumeDivergenceModeConfig['direction'];
  pivotLookbackLeft: number;
  pivotLookbackRight: number;
  detectedAtTimestamp: number;
}): PendingDivergenceCandidate => ({
  kind: divergence.kind,
  direction,
  currentPivotVolumeNorm: divergence.currentPivotVolumeNorm,
  previousPivotVolumeNorm: divergence.previousPivotVolumeNorm,
  currentPivotLow: divergence.currentPivotLow,
  previousPivotLow: divergence.previousPivotLow,
  currentPivotHigh: divergence.currentPivotHigh,
  previousPivotHigh: divergence.previousPivotHigh,
  currentPivotVolume: divergence.currentPivotVolume,
  currentPivotDelta: divergence.currentPivotDelta,
  barsBetweenPivotConfirmations: divergence.barsBetweenPivotConfirmations,
  currentPivotTimestamp:
    Number(candleWindow[divergence.currentPivotIndex]?.timestamp) || null,
  previousPivotTimestamp:
    Number(candleWindow[divergence.previousPivotIndex]?.timestamp) || null,
  pivotLookbackLeft,
  pivotLookbackRight,
  detectedAtTimestamp,
  lastObservedTimestamp: detectedAtTimestamp,
  barsSinceDetection: 0,
});

const updatePendingCandidateProgress = (
  candidate: PendingDivergenceCandidate,
  timestamp: number,
) => {
  if (candidate.lastObservedTimestamp === timestamp) {
    return;
  }

  candidate.barsSinceDetection += 1;
  candidate.lastObservedTimestamp = timestamp;
};

const resolvePendingEntryTiming = ({
  candidate,
  currentPrice,
}: {
  candidate: PendingDivergenceCandidate;
  currentPrice: number;
}): PendingEntryTiming | null => {
  if (candidate.direction === 'LONG') {
    if (currentPrice >= candidate.currentPivotHigh) {
      return 'confirmation_ready';
    }
    if (currentPrice >= candidate.previousPivotLow) {
      return 'structure_advance';
    }
    return null;
  }

  if (currentPrice <= candidate.currentPivotLow) {
    return 'confirmation_ready';
  }
  if (currentPrice <= candidate.previousPivotHigh) {
    return 'structure_advance';
  }
  return null;
};

const findCandleIndexByTimestamp = (
  candles: Candle[],
  timestamp: number | null,
  fallbackIndex: number,
) => {
  if (timestamp == null) {
    return fallbackIndex;
  }

  const index = candles.findIndex(
    (candle) => Number(candle.timestamp) === timestamp,
  );
  return index >= 0 ? index : fallbackIndex;
};

const getModeConfigByKind = ({
  kind,
  bullish,
  bearish,
}: {
  kind: PivotDivergence['kind'];
  bullish: VolumeDivergenceModeConfig;
  bearish: VolumeDivergenceModeConfig;
}) => (kind === 'bullish' ? bullish : bearish);

const buildEntryPayloadFromPendingCandidate = ({
  candidate,
  candleWindow,
  entryTiming,
  setupFeatures,
  entryThresholds,
}: {
  candidate: PendingDivergenceCandidate;
  candleWindow: Candle[];
  entryTiming: PendingEntryTiming;
  setupFeatures: VolumeDivergenceSetupFeatures;
  entryThresholds: VolumeDivergenceEntryThresholdSnapshot;
}) => {
  const previousPivotIndex = findCandleIndexByTimestamp(
    candleWindow,
    candidate.previousPivotTimestamp,
    0,
  );
  const currentPivotIndex = findCandleIndexByTimestamp(
    candleWindow,
    candidate.currentPivotTimestamp,
    candleWindow.length - 1,
  );

  return {
    figures: buildVolumeDivergenceFigures({
      kind: candidate.kind,
      previousPivotIndex,
      currentPivotIndex,
      previousPivotLow: candidate.previousPivotLow,
      previousPivotHigh: candidate.previousPivotHigh,
      currentPivotLow: candidate.currentPivotLow,
      currentPivotHigh: candidate.currentPivotHigh,
      fullData: candleWindow,
    }),
    additionalIndicators: {
      divergenceKind: candidate.kind,
      normalizedVolumeAtPivot: candidate.currentPivotVolumeNorm,
      previousNormalizedVolumeAtPivot: candidate.previousPivotVolumeNorm,
      volumeAtPivot: candidate.currentPivotVolume,
      deltaAtPivot: candidate.currentPivotDelta,
      barsBetweenPivotConfirmations: candidate.barsBetweenPivotConfirmations,
      divergence: {
        kind: candidate.kind,
        pivotLookbackLeft: candidate.pivotLookbackLeft,
        pivotLookbackRight: candidate.pivotLookbackRight,
        currentPivot: {
          index: currentPivotIndex,
          timestamp: candidate.currentPivotTimestamp,
          priceLow: candidate.currentPivotLow,
          priceHigh: candidate.currentPivotHigh,
          volumeNorm: candidate.currentPivotVolumeNorm,
        },
        previousPivot: {
          index: previousPivotIndex,
          timestamp: candidate.previousPivotTimestamp,
          priceLow: candidate.previousPivotLow,
          priceHigh: candidate.previousPivotHigh,
          volumeNorm: candidate.previousPivotVolumeNorm,
        },
        barsBetweenPivotConfirmations: candidate.barsBetweenPivotConfirmations,
      },
      volumeDivergenceSignalTiming: {
        entryTiming,
        barsSinceDetection: candidate.barsSinceDetection,
        detectedAtTimestamp: candidate.detectedAtTimestamp,
      },
      volumeDivergenceSetup: setupFeatures,
      volumeDivergenceThresholds: entryThresholds,
    },
  };
};

export const createVolumeDivergenceCore: CreateStrategyCore<
  VolumeDivergenceConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi, indicatorsState, data: initialData }) => {
  const {
    NORMALIZATION_LENGTH,
    PIVOT_LOOKBACK_LEFT,
    PIVOT_LOOKBACK_RIGHT,
    MAX_BARS_BETWEEN_PIVOTS,
    MIN_BARS_BETWEEN_PIVOTS,
    ALLOW_STRUCTURE_ADVANCE_ENTRY,
    MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
    MIN_RECLAIM_PCT,
    MIN_CONFIRMATION_CANDLE_QUALITY,
    FEE_PERCENT,
    MAX_LOSS_VALUE,
    BULLISH,
    BEARISH,
  } = config;
  const entryThresholds = getVolumeDivergenceEntryThresholds({
    ALLOW_STRUCTURE_ADVANCE_ENTRY,
    MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
    MIN_RECLAIM_PCT,
    MIN_CONFIRMATION_CANDLE_QUALITY,
  });

  const lastTradeController = strategyApi.createLastTradeController();
  const maxHistorySize = getRequiredHistorySize({
    normalizationLength: NORMALIZATION_LENGTH,
    lookbackLeft: PIVOT_LOOKBACK_LEFT,
    lookbackRight: PIVOT_LOOKBACK_RIGHT,
    maxBarsBetweenPivots: MAX_BARS_BETWEEN_PIVOTS,
  });
  const maxPendingConfirmationBars = Math.max(
    2,
    Math.min(
      MAX_BARS_BETWEEN_PIVOTS,
      PIVOT_LOOKBACK_LEFT + PIVOT_LOOKBACK_RIGHT + 1,
    ),
  );
  const candleWindow = (
    Array.isArray(initialData) ? initialData.slice(-maxHistorySize) : []
  ) as Candle[];
  const normalizedVolumes: number[] = [];
  const rollingMaxQueue: RollingMaxQueueState = {
    indices: [],
    start: 0,
  };
  const confirmedPivotState: ConfirmedPivotState = {
    indices: [],
    nextConfirmationIndex: 0,
  };
  let pendingCandidate: PendingDivergenceCandidate | null = null;

  const syncDerivedState = () => {
    appendNormalizedVolumes({
      candles: candleWindow,
      length: NORMALIZATION_LENGTH,
      normalizedVolumes,
      queue: rollingMaxQueue,
    });

    appendConfirmedPivotIndices({
      candles: candleWindow,
      normalizedVolumes,
      lookbackLeft: PIVOT_LOOKBACK_LEFT,
      lookbackRight: PIVOT_LOOKBACK_RIGHT,
      state: confirmedPivotState,
    });
  };

  const appendWindowCandle = (candle: Candle) => {
    const latestTimestamp =
      candleWindow.length > 0
        ? Number(candleWindow[candleWindow.length - 1]?.timestamp)
        : null;

    if (latestTimestamp === Number(candle.timestamp)) {
      candleWindow[candleWindow.length - 1] = candle;
      normalizedVolumes.length = 0;
      rollingMaxQueue.indices = [];
      rollingMaxQueue.start = 0;
      confirmedPivotState.indices = [];
      confirmedPivotState.nextConfirmationIndex = 0;
      syncDerivedState();
      return;
    }

    candleWindow.push(candle);

    if (candleWindow.length > maxHistorySize) {
      const overflow = candleWindow.length - maxHistorySize;
      candleWindow.splice(0, overflow);
      normalizedVolumes.splice(0, overflow);
      rebaseQueue(rollingMaxQueue, overflow);
      rebaseConfirmedPivots(confirmedPivotState, overflow);
    }

    syncDerivedState();
  };

  syncDerivedState();

  return async (candle) => {
    appendWindowCandle(candle as Candle);

    indicatorsState.onBar();
    const timestamp = Number(candle.timestamp);

    const currentPosition = await strategyApi.getCurrentPosition();
    if (isOpenPosition(currentPosition)) {
      const { currentPrice } = await strategyApi.getMarketData();
      const activeModeConfig =
        currentPosition.direction === 'LONG' ? BULLISH : BEARISH;
      const currentStopLossPrice = getPositionStopLossPrice(currentPosition);
      const favorableMovePct = getFavorableMovePct({
        direction: currentPosition.direction,
        entryPrice: currentPosition.price,
        currentPrice,
      });
      const currentPositionRiskPct = getPositionRiskPct({
        direction: currentPosition.direction,
        entryPrice: currentPosition.price,
        stopLossPrice: currentStopLossPrice,
      });

      if (
        !isBreakEvenStopAlreadyApplied({
          direction: currentPosition.direction,
          entryPrice: currentPosition.price,
          stopLossPrice: currentStopLossPrice,
        }) &&
        favorableMovePct != null &&
        favorableMovePct >=
          (currentPositionRiskPct ?? activeModeConfig.SL) *
            BREAK_EVEN_TRIGGER_RISK_MULTIPLIER
      ) {
        return strategyApi.protect({
          code: 'VOLUME_DIVERGENCE_MOVE_STOP_TO_BREAK_EVEN',
          protectPlan: {
            direction: currentPosition.direction,
            stopLossPrice: currentPosition.price,
          },
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (candleWindow.length < PIVOT_LOOKBACK_LEFT + PIVOT_LOOKBACK_RIGHT + 2) {
      return strategyApi.skip('WAIT_DATA');
    }

    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const divergence = findLatestDivergence({
      candles: candleWindow,
      normalizedVolumes,
      confirmedPivots: confirmedPivotState.indices,
      lookbackLeft: PIVOT_LOOKBACK_LEFT,
      lookbackRight: PIVOT_LOOKBACK_RIGHT,
      rangeLower: MIN_BARS_BETWEEN_PIVOTS,
      rangeUpper: MAX_BARS_BETWEEN_PIVOTS,
    });

    if (divergence) {
      const modeConfig = getModeConfigByKind({
        kind: divergence.kind,
        bullish: BULLISH,
        bearish: BEARISH,
      });
      if (!modeConfig.enable) {
        return strategyApi.skip('STRATEGY_DISABLED');
      }

      const nextPendingCandidate = buildPendingDivergenceCandidate({
        divergence,
        candleWindow,
        direction: modeConfig.direction,
        pivotLookbackLeft: PIVOT_LOOKBACK_LEFT,
        pivotLookbackRight: PIVOT_LOOKBACK_RIGHT,
        detectedAtTimestamp: timestamp,
      });
      const detectionSetupFeatures = buildVolumeDivergenceSetupFeatures({
        candles: candleWindow,
        currentCandle: candle as Candle,
        direction: modeConfig.direction,
        currentPrice: Number(candle.close),
        currentPivotLow: nextPendingCandidate.currentPivotLow,
        previousPivotLow: nextPendingCandidate.previousPivotLow,
        currentPivotHigh: nextPendingCandidate.currentPivotHigh,
        previousPivotHigh: nextPendingCandidate.previousPivotHigh,
        atrPeriod: config.ATR,
      });

      if (
        detectionSetupFeatures.divergenceAmplitudeAtrRatio != null &&
        detectionSetupFeatures.divergenceAmplitudeAtrRatio <
          entryThresholds.minDivergenceAmplitudeAtrRatio
      ) {
        return strategyApi.skip('WEAK_DIVERGENCE_AMPLITUDE_ATR');
      }

      pendingCandidate = nextPendingCandidate;

      return strategyApi.skip('WAIT_REVERSAL_CONFIRMATION');
    }

    if (!pendingCandidate) {
      return strategyApi.skip('NO_DIVERGENCE');
    }

    updatePendingCandidateProgress(pendingCandidate, timestamp);

    if (pendingCandidate.barsSinceDetection > maxPendingConfirmationBars) {
      pendingCandidate = null;
      return strategyApi.skip('PENDING_DIVERGENCE_EXPIRED');
    }

    const { currentPrice } = await strategyApi.getMarketData();
    const entryTiming = resolvePendingEntryTiming({
      candidate: pendingCandidate,
      currentPrice,
    });

    if (!entryTiming) {
      return strategyApi.skip('WAIT_REVERSAL_CONFIRMATION');
    }

    if (
      entryTiming === 'structure_advance' &&
      !entryThresholds.allowStructureAdvanceEntry
    ) {
      return strategyApi.skip('WAIT_CONFIRMATION_READY');
    }

    const modeConfig = getModeConfigByKind({
      kind: pendingCandidate.kind,
      bullish: BULLISH,
      bearish: BEARISH,
    });
    const setupFeatures = buildVolumeDivergenceSetupFeatures({
      candles: candleWindow,
      currentCandle: candle as Candle,
      direction: modeConfig.direction,
      currentPrice,
      currentPivotLow: pendingCandidate.currentPivotLow,
      previousPivotLow: pendingCandidate.previousPivotLow,
      currentPivotHigh: pendingCandidate.currentPivotHigh,
      previousPivotHigh: pendingCandidate.previousPivotHigh,
      atrPeriod: config.ATR,
    });

    if (
      setupFeatures.reclaimPct != null &&
      setupFeatures.reclaimPct < entryThresholds.minReclaimPct
    ) {
      return strategyApi.skip('WAIT_CONFIRMATION_RECLAIM');
    }

    if (
      setupFeatures.confirmationCandleQuality != null &&
      setupFeatures.confirmationCandleQuality <
        entryThresholds.minConfirmationCandleQuality
    ) {
      return strategyApi.skip('WAIT_CONFIRMATION_CANDLE_QUALITY');
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
    const entryPayload = buildEntryPayloadFromPendingCandidate({
      candidate: pendingCandidate,
      candleWindow,
      entryTiming,
      setupFeatures,
      entryThresholds,
    });

    lastTradeController.markTrade(timestamp);
    pendingCandidate = null;

    return strategyApi.entry({
      code: 'VOLUME_DIVERGENCE_REVERSAL_SIGNAL',
      direction: modeConfig.direction,
      figures: entryPayload.figures,
      indicators,
      additionalIndicators: entryPayload.additionalIndicators,
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
