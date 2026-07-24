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
import {
  buildStructureRiskPlan,
  isStopLossOnCorrectSide,
} from '../shared/structureRisk';

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

type VolumeDivergenceEntryCandidate = {
  candidate: PendingDivergenceCandidate;
  currentPrice: number;
  entryTiming: PendingEntryTiming;
  setupFeatures: VolumeDivergenceSetupFeatures;
};

type VolumeDivergenceStateEvaluation =
  | {
      kind: 'skip';
      code: string;
    }
  | {
      kind: 'entryCandidate';
      entry: VolumeDivergenceEntryCandidate;
    };

type VolumeDivergenceControllerState = {
  candleWindow: Candle[];
  normalizedVolumes: number[];
  rollingMaxQueue: RollingMaxQueueState;
  confirmedPivotState: ConfirmedPivotState;
  pendingCandidate: PendingDivergenceCandidate | null;
};

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

const buildVolumeDivergenceStateKey = (config: VolumeDivergenceConfig) =>
  JSON.stringify({
    normalizationLength: config.NORMALIZATION_LENGTH,
    pivotLookbackLeft: config.PIVOT_LOOKBACK_LEFT,
    pivotLookbackRight: config.PIVOT_LOOKBACK_RIGHT,
    minBarsBetweenPivots: config.MIN_BARS_BETWEEN_PIVOTS,
    maxBarsBetweenPivots: config.MAX_BARS_BETWEEN_PIVOTS,
    allowStructureAdvanceEntry: config.ALLOW_STRUCTURE_ADVANCE_ENTRY,
    minDivergenceAmplitudeAtrRatio: config.MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
    minReclaimPct: config.MIN_RECLAIM_PCT,
    minConfirmationCandleQuality: config.MIN_CONFIRMATION_CANDLE_QUALITY,
    atr: config.ATR,
    bullish: config.BULLISH,
    bearish: config.BEARISH,
  });

const snapshotVolumeDivergenceState = (
  state: VolumeDivergenceControllerState,
): VolumeDivergenceControllerState => ({
  candleWindow: state.candleWindow.map((candle) => ({ ...candle })),
  normalizedVolumes: [...state.normalizedVolumes],
  rollingMaxQueue: {
    indices: [...state.rollingMaxQueue.indices],
    start: state.rollingMaxQueue.start,
  },
  confirmedPivotState: {
    indices: [...state.confirmedPivotState.indices],
    nextConfirmationIndex: state.confirmedPivotState.nextConfirmationIndex,
  },
  pendingCandidate:
    state.pendingCandidate == null ? null : { ...state.pendingCandidate },
});

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
      previousPivotVolumeNorm: candidate.previousPivotVolumeNorm,
      currentPivotVolumeNorm: candidate.currentPivotVolumeNorm,
      barsBetweenPivotConfirmations: candidate.barsBetweenPivotConfirmations,
      entryTiming,
      candleWindow,
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

  const createEmptyDetectorState = (): VolumeDivergenceControllerState => ({
    candleWindow: [],
    normalizedVolumes: [],
    rollingMaxQueue: {
      indices: [],
      start: 0,
    },
    confirmedPivotState: {
      indices: [],
      nextConfirmationIndex: 0,
    },
    pendingCandidate: null,
  });

  const syncDerivedState = (state: VolumeDivergenceControllerState) => {
    appendNormalizedVolumes({
      candles: state.candleWindow,
      length: NORMALIZATION_LENGTH,
      normalizedVolumes: state.normalizedVolumes,
      queue: state.rollingMaxQueue,
    });

    appendConfirmedPivotIndices({
      candles: state.candleWindow,
      normalizedVolumes: state.normalizedVolumes,
      lookbackLeft: PIVOT_LOOKBACK_LEFT,
      lookbackRight: PIVOT_LOOKBACK_RIGHT,
      state: state.confirmedPivotState,
    });
  };

  const appendWindowCandle = (
    state: VolumeDivergenceControllerState,
    candle: Candle,
  ) => {
    const latestTimestamp =
      state.candleWindow.length > 0
        ? Number(state.candleWindow[state.candleWindow.length - 1]?.timestamp)
        : null;

    if (latestTimestamp === Number(candle.timestamp)) {
      state.candleWindow[state.candleWindow.length - 1] = candle;
      state.normalizedVolumes.length = 0;
      state.rollingMaxQueue.indices = [];
      state.rollingMaxQueue.start = 0;
      state.confirmedPivotState.indices = [];
      state.confirmedPivotState.nextConfirmationIndex = 0;
      syncDerivedState(state);
      return;
    }

    state.candleWindow.push(candle);

    if (state.candleWindow.length > maxHistorySize) {
      const overflow = state.candleWindow.length - maxHistorySize;
      state.candleWindow.splice(0, overflow);
      state.normalizedVolumes.splice(0, overflow);
      rebaseQueue(state.rollingMaxQueue, overflow);
      rebaseConfirmedPivots(state.confirmedPivotState, overflow);
    }

    syncDerivedState(state);
  };

  const evaluateCurrentCandle = (
    state: VolumeDivergenceControllerState,
    candle: Candle,
    currentPrice: number,
  ): VolumeDivergenceStateEvaluation => {
    if (
      state.candleWindow.length <
      PIVOT_LOOKBACK_LEFT + PIVOT_LOOKBACK_RIGHT + 2
    ) {
      return { kind: 'skip', code: 'WAIT_DATA' };
    }

    const timestamp = Number(candle.timestamp);
    const divergence = findLatestDivergence({
      candles: state.candleWindow,
      normalizedVolumes: state.normalizedVolumes,
      confirmedPivots: state.confirmedPivotState.indices,
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
        return { kind: 'skip', code: 'STRATEGY_DISABLED' };
      }

      const nextPendingCandidate = buildPendingDivergenceCandidate({
        divergence,
        candleWindow: state.candleWindow,
        direction: modeConfig.direction,
        pivotLookbackLeft: PIVOT_LOOKBACK_LEFT,
        pivotLookbackRight: PIVOT_LOOKBACK_RIGHT,
        detectedAtTimestamp: timestamp,
      });
      const detectionSetupFeatures = buildVolumeDivergenceSetupFeatures({
        candles: state.candleWindow,
        currentCandle: candle,
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
        return { kind: 'skip', code: 'WEAK_DIVERGENCE_AMPLITUDE_ATR' };
      }

      state.pendingCandidate = nextPendingCandidate;

      return { kind: 'skip', code: 'WAIT_REVERSAL_CONFIRMATION' };
    }

    if (!state.pendingCandidate) {
      return { kind: 'skip', code: 'NO_DIVERGENCE' };
    }

    updatePendingCandidateProgress(state.pendingCandidate, timestamp);

    if (
      state.pendingCandidate.barsSinceDetection > maxPendingConfirmationBars
    ) {
      state.pendingCandidate = null;
      return { kind: 'skip', code: 'PENDING_DIVERGENCE_EXPIRED' };
    }

    const entryTiming = resolvePendingEntryTiming({
      candidate: state.pendingCandidate,
      currentPrice,
    });

    if (!entryTiming) {
      return { kind: 'skip', code: 'WAIT_REVERSAL_CONFIRMATION' };
    }

    if (
      entryTiming === 'structure_advance' &&
      !entryThresholds.allowStructureAdvanceEntry
    ) {
      return { kind: 'skip', code: 'WAIT_CONFIRMATION_READY' };
    }

    const modeConfig = getModeConfigByKind({
      kind: state.pendingCandidate.kind,
      bullish: BULLISH,
      bearish: BEARISH,
    });
    const setupFeatures = buildVolumeDivergenceSetupFeatures({
      candles: state.candleWindow,
      currentCandle: candle,
      direction: modeConfig.direction,
      currentPrice,
      currentPivotLow: state.pendingCandidate.currentPivotLow,
      previousPivotLow: state.pendingCandidate.previousPivotLow,
      currentPivotHigh: state.pendingCandidate.currentPivotHigh,
      previousPivotHigh: state.pendingCandidate.previousPivotHigh,
      atrPeriod: config.ATR,
    });

    if (
      setupFeatures.reclaimPct != null &&
      setupFeatures.reclaimPct < entryThresholds.minReclaimPct
    ) {
      return { kind: 'skip', code: 'WAIT_CONFIRMATION_RECLAIM' };
    }

    if (
      setupFeatures.confirmationCandleQuality != null &&
      setupFeatures.confirmationCandleQuality <
        entryThresholds.minConfirmationCandleQuality
    ) {
      return { kind: 'skip', code: 'WAIT_CONFIRMATION_CANDLE_QUALITY' };
    }

    return {
      kind: 'entryCandidate',
      entry: {
        candidate: state.pendingCandidate,
        currentPrice,
        entryTiming,
        setupFeatures,
      },
    };
  };

  const detectorState = strategyApi.createStateController<
    VolumeDivergenceControllerState,
    VolumeDivergenceControllerState
  >(
    'VolumeDivergence',
    () => {
      const state = createEmptyDetectorState();
      for (const candle of Array.isArray(initialData)
        ? (initialData.slice(-maxHistorySize) as Candle[])
        : []) {
        appendWindowCandle(state, candle);
        const evaluation = evaluateCurrentCandle(
          state,
          candle,
          Number(candle.close),
        );
        if (evaluation.kind === 'entryCandidate') {
          state.pendingCandidate = null;
        }
      }
      return state;
    },
    {
      configKey: buildVolumeDivergenceStateKey(config),
      snapshot: snapshotVolumeDivergenceState,
    },
  );
  const appendDetectorCandle = (candle: Candle) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) => {
      appendWindowCandle(state, candle);
      indicatorsState.onBar();
      return state;
    });

  return async (candle) => {
    const currentCandle = candle as Candle;
    appendDetectorCandle(currentCandle);
    const timestamp = Number(candle.timestamp);

    const currentPosition = await strategyApi.getCurrentPosition();
    if (isOpenPosition(currentPosition)) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const detector = detectorState.get();
    const evaluationPrice = Number(currentCandle.close);
    const evaluation = evaluateCurrentCandle(
      detector,
      currentCandle,
      evaluationPrice,
    );

    if (evaluation.kind === 'skip') {
      return strategyApi.skip(evaluation.code);
    }

    const { candidate, currentPrice, entryTiming, setupFeatures } =
      evaluation.entry;
    const modeConfig = getModeConfigByKind({
      kind: candidate.kind,
      bullish: BULLISH,
      bearish: BEARISH,
    });
    const atrBuffer =
      (setupFeatures.atrAbsolute ?? 0) *
      Math.max(0, Number(config.VOLUME_DIVERGENCE_STOP_ATR_BUFFER_MULT ?? 0.2));
    const percentBuffer =
      currentPrice *
      (Math.max(0, Number(config.VOLUME_DIVERGENCE_STOP_BUFFER_PCT ?? 0.03)) /
        100);
    const stopBuffer = Math.max(atrBuffer, percentBuffer);
    const stopLossPrice =
      modeConfig.direction === 'LONG'
        ? candidate.currentPivotLow - stopBuffer
        : candidate.currentPivotHigh + stopBuffer;

    if (
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
      targetR: Number(config.VOLUME_DIVERGENCE_TARGET_R_MULT ?? 3),
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
      candidate,
      candleWindow: detector.candleWindow,
      entryTiming,
      setupFeatures,
      entryThresholds,
    });

    lastTradeController.markTrade(timestamp);
    detectorState.update((state) => {
      state.pendingCandidate = null;
      return state;
    });

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
