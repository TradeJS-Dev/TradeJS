import { Candle, Direction } from '@tradejs/types';
import { LiquidityTailsConfig } from './config';

export type LiquidityTailsZoneKind = 'buy_pressure' | 'sell_pressure';

export interface LiquidityTailsZone {
  id: string;
  kind: LiquidityTailsZoneKind;
  direction: Direction;
  top: number;
  bottom: number;
  mid: number;
  birthIndex: number;
  birthTimestamp: number;
  touches: number;
  lastTouchIndex: number;
  originVolume: number;
  spent: boolean;
  /** Execution is owned by core/runtime and is never inferred by the detector. */
  traded: boolean;
  retestsObserved: number;
  candidatesEmitted: number;
  entryCandidatesEmitted: number;
  scaleInCandidatesEmitted: number;
  signalsEmitted: number;
  lastRetestIndex: number;
  lastSignalIndex: number;
}

export type LiquidityTailsCandidateAction = 'initial_entry' | 'scale_in';

export interface LiquidityTailsSignal {
  setupId: string;
  candidateAction: LiquidityTailsCandidateAction;
  candidateOrdinal: number;
  direction: Direction;
  zone: LiquidityTailsZone;
  timestamp: number;
  close: number;
  atr: number;
  zoneAgeBars: number;
  topShadow: number;
  bottomShadow: number;
  candleBody: number;
  wickBodyRatio: number;
  wickDominanceRatio: number;
  retestPenetrationPct: number;
  reactionCloseDistancePct: number;
  rejectionEfficiencyRatio: number;
  reactionBodyAligned: boolean;
  retestOrdinal: number;
}

export interface LiquidityTailsExecutionContext {
  action: 'open' | 'increase';
  level: number;
  levelsFilled: number;
  maxLevels: number;
  targetRiskBudgetPct: number;
  positionQty: number;
  positionAveragePrice: number | null;
  priceImprovementAtr: number | null;
  projectedQty: number;
  projectedAveragePrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  existingRiskValue: number;
  remainingRiskValue: number;
  projectedRiskValue: number;
  riskBudgetUsedPct: number;
  initialRiskFraction: number;
  grossRiskRatio: number;
  netRiskRatio: number;
}

export interface LiquidityTailsRuntimeState {
  signal: LiquidityTailsSignal | null;
  zones: LiquidityTailsZone[];
}

type AtrState = {
  value: number | null;
  count: number;
};

type EngineState = {
  index: number;
  prevClose: number | null;
  atrState: AtrState;
  lastFireIndex: number;
  zones: LiquidityTailsZone[];
  signal: LiquidityTailsSignal | null;
  lastTimestamp: number | null;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const calculateTrueRange = (candle: Candle, prevClose: number | null) => {
  const high = asFiniteNumber(candle.high);
  const low = asFiniteNumber(candle.low);
  const close = asFiniteNumber(candle.close);
  if (high == null || low == null || close == null) {
    return 0;
  }
  if (prevClose == null || !Number.isFinite(prevClose)) {
    return Math.max(high - low, 0);
  }
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose),
  );
};

const updateAtrState = ({
  atrState,
  tr,
  period,
}: {
  atrState: AtrState;
  tr: number;
  period: number;
}): AtrState => {
  const safeTr = Number.isFinite(tr) ? Math.max(tr, 0) : 0;
  const safePeriod = Math.max(1, Math.floor(period));

  if (atrState.value == null) {
    return { value: safeTr, count: 1 };
  }

  if (atrState.count < safePeriod) {
    const nextCount = atrState.count + 1;
    return {
      value: (atrState.value * atrState.count + safeTr) / nextCount,
      count: nextCount,
    };
  }

  return {
    value: (atrState.value * (safePeriod - 1) + safeTr) / safePeriod,
    count: atrState.count + 1,
  };
};

const getConfigNumbers = (config: LiquidityTailsConfig) => ({
  atrLength: Math.max(2, Math.floor(config.LIQUIDITY_TAILS_ATR_LENGTH ?? 14)),
  atrMult: clampPositive(config.LIQUIDITY_TAILS_ATR_MULT, 0.8),
  minWickRatio: clampPositive(config.LIQUIDITY_TAILS_MIN_WICK_RATIO, 1.3),
  wickDominance: clampPositive(config.LIQUIDITY_TAILS_WICK_DOMINANCE, 1.2),
  minGap: Math.max(1, Math.floor(config.LIQUIDITY_TAILS_MIN_GAP ?? 5)),
  maxAge: Math.max(50, Math.floor(config.LIQUIDITY_TAILS_MAX_AGE ?? 500)),
  keepBroken: Boolean(config.LIQUIDITY_TAILS_KEEP_BROKEN),
  reactionCloseBeyondZone: Boolean(
    config.LIQUIDITY_TAILS_REACTION_CLOSE_BEYOND_ZONE,
  ),
  requireReactionBody: Boolean(config.LIQUIDITY_TAILS_REQUIRE_REACTION_BODY),
  maxRetestDistancePct: Math.max(
    0,
    Number(config.LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT ?? 1.2),
  ),
  minRetestAgeBars: Math.max(
    1,
    Math.floor(config.LIQUIDITY_TAILS_MIN_RETEST_AGE_BARS ?? 1),
  ),
  minZoneTouches: Math.max(
    1,
    Math.floor(config.LIQUIDITY_TAILS_MIN_ZONE_TOUCHES ?? 1),
  ),
  maxEntryRetestOrdinal: Math.max(
    1,
    Math.floor(config.LIQUIDITY_TAILS_MAX_ENTRY_RETEST_ORDINAL ?? 1),
  ),
  maxEntryZoneAgeBars: Math.max(
    0,
    Math.floor(config.LIQUIDITY_TAILS_MAX_ENTRY_ZONE_AGE_BARS ?? 0),
  ),
  minRejectionEfficiencyRatio: Math.max(
    0,
    Number(config.LIQUIDITY_TAILS_MIN_REJECTION_EFFICIENCY_RATIO ?? 0),
  ),
  scaleInEnabled: Boolean(config.LIQUIDITY_TAILS_SCALE_IN_ENABLED),
  scaleInCount: Math.max(
    0,
    Math.floor(Number(config.LIQUIDITY_TAILS_SCALE_IN_COUNT ?? 1)),
  ),
  exitOnScaleInRetest: Boolean(config.LIQUIDITY_TAILS_EXIT_ON_SCALE_IN_RETEST),
});

const cloneZone = (zone: LiquidityTailsZone): LiquidityTailsZone => ({
  ...zone,
});

const snapshotZones = (zones: LiquidityTailsZone[]) => zones.map(cloneZone);

const isBroken = (zone: LiquidityTailsZone, candle: Candle) =>
  zone.kind === 'sell_pressure'
    ? Number(candle.low) >= zone.top
    : Number(candle.high) <= zone.bottom;

const buildRetestSignal = ({
  zone,
  candle,
  index,
  atr,
  topShadow,
  bottomShadow,
  candleBody,
  reactionCloseBeyondZone,
  requireReactionBody,
  maxRetestDistancePct,
  maxEntryZoneAgeBars,
  minRejectionEfficiencyRatio,
  retestOrdinal,
  candidateAction,
  candidateOrdinal,
}: {
  zone: LiquidityTailsZone;
  candle: Candle;
  index: number;
  atr: number;
  topShadow: number;
  bottomShadow: number;
  candleBody: number;
  reactionCloseBeyondZone: boolean;
  requireReactionBody: boolean;
  maxRetestDistancePct: number;
  maxEntryZoneAgeBars: number;
  minRejectionEfficiencyRatio: number;
  retestOrdinal: number;
  candidateAction: LiquidityTailsCandidateAction;
  candidateOrdinal: number;
}): LiquidityTailsSignal | null => {
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  const zoneHeight = Math.max(zone.top - zone.bottom, 1e-9);
  const zoneAgeBars = index - zone.birthIndex;
  const isLong = zone.kind === 'buy_pressure';
  const touched = isLong ? low <= zone.top : high >= zone.bottom;
  if (!touched) {
    return null;
  }

  const reactionBodyAligned = isLong ? close > open : close < open;
  if (requireReactionBody && !reactionBodyAligned) {
    return null;
  }

  const closeBeyondZone = isLong ? close > zone.top : close < zone.bottom;
  const closeBeyondMid = isLong ? close > zone.mid : close < zone.mid;
  if (reactionCloseBeyondZone ? !closeBeyondZone : !closeBeyondMid) {
    return null;
  }

  const retestDistance = isLong
    ? Math.max(0, zone.top - low)
    : Math.max(0, high - zone.bottom);
  const retestPenetrationPct = (retestDistance / zoneHeight) * 100;
  if (
    maxRetestDistancePct > 0 &&
    retestPenetrationPct > maxRetestDistancePct * 100
  ) {
    return null;
  }

  const reactionDistance = isLong
    ? Math.max(0, close - zone.top)
    : Math.max(0, zone.bottom - close);
  const rejectionEfficiencyRatio =
    reactionDistance / Math.max(retestDistance, zoneHeight * 1e-6);
  if (
    (candidateAction === 'initial_entry' &&
      maxEntryZoneAgeBars > 0 &&
      zoneAgeBars > maxEntryZoneAgeBars) ||
    (minRejectionEfficiencyRatio > 0 &&
      rejectionEfficiencyRatio < minRejectionEfficiencyRatio)
  ) {
    return null;
  }
  const activeWick = isLong ? bottomShadow : topShadow;
  const oppositeWick = isLong ? topShadow : bottomShadow;
  const wickBodyRatio = activeWick / Math.max(candleBody, 1e-9);
  const wickDominanceRatio = activeWick / Math.max(oppositeWick, 1e-9);

  return {
    setupId: zone.id,
    candidateAction,
    candidateOrdinal,
    direction: zone.direction,
    zone: cloneZone(zone),
    timestamp: candle.timestamp,
    close,
    atr,
    zoneAgeBars,
    topShadow,
    bottomShadow,
    candleBody,
    wickBodyRatio,
    wickDominanceRatio,
    retestPenetrationPct,
    reactionCloseDistancePct: (reactionDistance / Math.max(close, 1e-9)) * 100,
    rejectionEfficiencyRatio,
    reactionBodyAligned,
    retestOrdinal,
  };
};

export const buildLiquidityTailsSignalContext = (
  signal: LiquidityTailsSignal,
  executionContext?: LiquidityTailsExecutionContext,
) => ({
  setupId: signal.setupId,
  signalDirection: signal.direction,
  candidateAction: signal.candidateAction,
  candidateOrdinal: signal.candidateOrdinal,
  zoneId: signal.zone.id,
  zoneKind: signal.zone.kind,
  zoneTop: signal.zone.top,
  zoneBottom: signal.zone.bottom,
  zoneMid: signal.zone.mid,
  zoneHeight: signal.zone.top - signal.zone.bottom,
  zoneAgeBars: signal.zoneAgeBars,
  zoneTouches: signal.zone.touches,
  zoneRetestsObserved: signal.zone.retestsObserved,
  zoneCandidatesEmitted: signal.zone.candidatesEmitted,
  zoneEntryCandidatesEmitted: signal.zone.entryCandidatesEmitted,
  zoneScaleInCandidatesEmitted: signal.zone.scaleInCandidatesEmitted,
  zoneRetestOrdinal: signal.retestOrdinal,
  originVolume: signal.zone.originVolume,
  currentPrice: signal.close,
  atr: signal.atr,
  wickBodyRatio: signal.wickBodyRatio,
  wickDominanceRatio: signal.wickDominanceRatio,
  retestPenetrationPct: signal.retestPenetrationPct,
  reactionCloseDistancePct: signal.reactionCloseDistancePct,
  rejectionEfficiencyRatio: signal.rejectionEfficiencyRatio,
  reactionBodyAligned: signal.reactionBodyAligned,
  action: executionContext?.action ?? 'open',
  level: executionContext?.level ?? 1,
  levelsFilled: executionContext?.levelsFilled ?? 0,
  maxLevels: executionContext?.maxLevels ?? 1,
  targetRiskBudgetPct: executionContext?.targetRiskBudgetPct ?? 100,
  positionQty: executionContext?.positionQty ?? 0,
  positionAveragePrice: executionContext?.positionAveragePrice ?? null,
  priceImprovementAtr: executionContext?.priceImprovementAtr ?? null,
  projectedQty: executionContext?.projectedQty ?? 0,
  projectedAveragePrice:
    executionContext?.projectedAveragePrice ?? signal.close,
  stopLossPrice: executionContext?.stopLossPrice ?? null,
  takeProfitPrice: executionContext?.takeProfitPrice ?? null,
  existingRiskValue: executionContext?.existingRiskValue ?? 0,
  remainingRiskValue: executionContext?.remainingRiskValue ?? null,
  projectedRiskValue: executionContext?.projectedRiskValue ?? null,
  riskBudgetUsedPct: executionContext?.riskBudgetUsedPct ?? null,
  initialRiskFraction: executionContext?.initialRiskFraction ?? 1,
  grossRiskRatio: executionContext?.grossRiskRatio ?? null,
  netRiskRatio: executionContext?.netRiskRatio ?? null,
});

export type LiquidityTailsSignalContext = ReturnType<
  typeof buildLiquidityTailsSignalContext
>;

export const createLiquidityTailsEngine = ({
  config,
  initialCandles = [],
}: {
  config: LiquidityTailsConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => LiquidityTailsRuntimeState;
  getState: () => LiquidityTailsRuntimeState;
} => {
  const {
    atrLength,
    atrMult,
    minWickRatio,
    wickDominance,
    minGap,
    maxAge,
    keepBroken,
    reactionCloseBeyondZone,
    requireReactionBody,
    maxRetestDistancePct,
    minRetestAgeBars,
    minZoneTouches,
    maxEntryRetestOrdinal,
    maxEntryZoneAgeBars,
    minRejectionEfficiencyRatio,
    scaleInEnabled,
    scaleInCount,
    exitOnScaleInRetest,
  } = getConfigNumbers(config);
  const state: EngineState = {
    index: -1,
    prevClose: null,
    atrState: { value: null, count: 0 },
    lastFireIndex: 0,
    zones: [],
    signal: null,
    lastTimestamp: null,
  };

  const apply = (candle: Candle): LiquidityTailsRuntimeState => {
    if (state.lastTimestamp === candle.timestamp) {
      return {
        signal: state.signal,
        zones: snapshotZones(state.zones),
      };
    }
    state.lastTimestamp = candle.timestamp;
    state.index += 1;
    state.signal = null;

    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      return {
        signal: state.signal,
        zones: state.zones,
      };
    }

    const tr = calculateTrueRange(candle, state.prevClose);
    state.atrState = updateAtrState({
      atrState: state.atrState,
      tr,
      period: atrLength,
    });
    state.prevClose = close;

    const topShadow = high - Math.max(open, close);
    const bottomShadow = Math.min(open, close) - low;
    const candleBody = Math.max(Math.abs(close - open), 1e-9);
    const atr = state.atrState.value ?? 0;
    const atrReady = state.atrState.count >= atrLength;
    const atrThreshold = atrMult * atr;
    const ratioThreshold = minWickRatio * candleBody;
    const topDominant = topShadow > bottomShadow * wickDominance;
    const bottomDominant = bottomShadow > topShadow * wickDominance;
    const sellFire =
      atrReady &&
      topShadow >= atrThreshold &&
      topShadow >= ratioThreshold &&
      topDominant &&
      state.index - state.lastFireIndex > minGap;
    const buyFire =
      atrReady &&
      bottomShadow >= atrThreshold &&
      bottomShadow >= ratioThreshold &&
      bottomDominant &&
      state.index - state.lastFireIndex > minGap;

    if (sellFire) {
      state.lastFireIndex = state.index;
      const top = high;
      const bottom = Math.max(open, close);
      state.zones.push({
        id: `msltails-sell-${candle.timestamp}`,
        kind: 'sell_pressure',
        direction: 'SHORT',
        top,
        bottom,
        mid: (top + bottom) / 2,
        birthIndex: state.index,
        birthTimestamp: candle.timestamp,
        touches: 0,
        lastTouchIndex: 0,
        originVolume: Number.isFinite(volume) ? volume : 0,
        spent: false,
        traded: false,
        retestsObserved: 0,
        candidatesEmitted: 0,
        entryCandidatesEmitted: 0,
        scaleInCandidatesEmitted: 0,
        signalsEmitted: 0,
        lastRetestIndex: -1,
        lastSignalIndex: -1,
      });
    }

    if (buyFire) {
      state.lastFireIndex = state.index;
      const top = Math.min(open, close);
      const bottom = low;
      state.zones.push({
        id: `msltails-buy-${candle.timestamp}`,
        kind: 'buy_pressure',
        direction: 'LONG',
        top,
        bottom,
        mid: (top + bottom) / 2,
        birthIndex: state.index,
        birthTimestamp: candle.timestamp,
        touches: 0,
        lastTouchIndex: 0,
        originVolume: Number.isFinite(volume) ? volume : 0,
        spent: false,
        traded: false,
        retestsObserved: 0,
        candidatesEmitted: 0,
        entryCandidatesEmitted: 0,
        scaleInCandidatesEmitted: 0,
        signalsEmitted: 0,
        lastRetestIndex: -1,
        lastSignalIndex: -1,
      });
    }

    for (let index = state.zones.length - 1; index >= 0; index -= 1) {
      const zone = state.zones[index];
      if (!zone) {
        continue;
      }

      const isOlder = state.index > zone.birthIndex;
      const tooOld = state.index - zone.birthIndex > maxAge;
      if (tooOld) {
        state.zones.splice(index, 1);
        continue;
      }

      const broken = isOlder && isBroken(zone, candle);
      if (broken && !zone.spent) {
        if (keepBroken) {
          zone.spent = true;
        } else {
          state.zones.splice(index, 1);
        }
        continue;
      }

      if (!isOlder || zone.spent) {
        continue;
      }

      const inZone =
        zone.kind === 'sell_pressure' ? high >= zone.bottom : low <= zone.top;
      if (inZone && state.index - zone.lastTouchIndex > 2) {
        zone.touches += 1;
        zone.lastTouchIndex = state.index;
      }

      const retestSeparated =
        zone.lastRetestIndex < 0 || state.index - zone.lastRetestIndex > 2;
      if (retestSeparated && state.signal == null) {
        const retestOrdinal = zone.retestsObserved + 1;
        const observesInitialCandidate =
          zone.entryCandidatesEmitted === 0 &&
          retestOrdinal <= maxEntryRetestOrdinal;
        const candidateAction: LiquidityTailsCandidateAction =
          observesInitialCandidate ? 'initial_entry' : 'scale_in';
        const candidateOrdinal = zone.candidatesEmitted + 1;
        const observed = buildRetestSignal({
          zone,
          candle,
          index: state.index,
          atr,
          topShadow,
          bottomShadow,
          candleBody,
          reactionCloseBeyondZone,
          requireReactionBody,
          maxRetestDistancePct,
          maxEntryZoneAgeBars,
          minRejectionEfficiencyRatio,
          retestOrdinal,
          candidateAction,
          candidateOrdinal,
        });
        if (observed) {
          zone.retestsObserved += 1;
          zone.lastRetestIndex = state.index;
          const mature =
            observed.zoneAgeBars >= minRetestAgeBars &&
            zone.touches >= minZoneTouches;
          const scaleInCandidateAllowed =
            candidateAction === 'scale_in' &&
            ((scaleInEnabled && zone.scaleInCandidatesEmitted < scaleInCount) ||
              (exitOnScaleInRetest && zone.scaleInCandidatesEmitted < 1));
          const candidateAllowed =
            mature &&
            (candidateAction === 'initial_entry' || scaleInCandidateAllowed);
          if (!candidateAllowed) continue;

          zone.candidatesEmitted += 1;
          zone.signalsEmitted += 1;
          if (candidateAction === 'initial_entry') {
            zone.entryCandidatesEmitted += 1;
          } else {
            zone.scaleInCandidatesEmitted += 1;
          }
          zone.lastSignalIndex = state.index;
          state.signal = {
            ...observed,
            candidateOrdinal: zone.candidatesEmitted,
            zone: cloneZone(zone),
          };
        }
      }
    }

    return {
      signal: state.signal,
      zones: state.signal ? snapshotZones(state.zones) : state.zones,
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: () => ({
      signal: state.signal,
      zones: snapshotZones(state.zones),
    }),
  };
};
