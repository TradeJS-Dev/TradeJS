import { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import { StructureZonesConfig } from './config';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

export type StructureZonesMarketState = 'Trend' | 'Range' | 'Transition';
export type StructureZonesSignalKind =
  | 'support_reaction'
  | 'resistance_reaction'
  | 'support_breakdown'
  | 'resistance_breakout';

export interface StructureZonesPivot {
  timestamp: number;
  index: number;
  value: number;
  kind: 'high' | 'low';
}

export interface StructureZone {
  kind: 'support' | 'resistance';
  top: number;
  bottom: number;
  level: number;
  sourcePivotTimestamp: number;
  sourcePivotIndex: number;
}

export interface StructureZonesSnapshot {
  marketState: StructureZonesMarketState;
  isUpStructure: boolean;
  isDownStructure: boolean;
  acceptBelowLower: boolean;
  acceptAboveUpper: boolean;
  lastHigh: StructureZonesPivot | null;
  prevHigh: StructureZonesPivot | null;
  lastLow: StructureZonesPivot | null;
  prevLow: StructureZonesPivot | null;
  supportZone: StructureZone | null;
  resistanceZone: StructureZone | null;
  supportZoneAgeBars: number | null;
  resistanceZoneAgeBars: number | null;
  supportTouchOrdinal: number;
  resistanceTouchOrdinal: number;
  atr: number;
  timestamp: number;
  close: number;
}

export interface StructureZonesSignal {
  direction: Direction;
  kind: StructureZonesSignalKind;
  marketState: StructureZonesMarketState;
  zone: StructureZone;
  supportZone: StructureZone;
  resistanceZone: StructureZone;
  lastHigh: StructureZonesPivot;
  lastLow: StructureZonesPivot;
  atr: number;
  zoneHeight: number;
  zoneAgeBars: number;
  touchOrdinal: number;
  reactionCloseDistancePct: number;
  reactionBodyAligned: boolean;
  structureBias: 'up' | 'down' | 'range';
  timestamp: number;
  close: number;
}

export interface StructureZonesRuntimeState {
  signal: StructureZonesSignal | null;
  snapshot: StructureZonesSnapshot | null;
  swingPoints: StrategyFigurePoint[];
}

type AtrState = {
  value: number | null;
  count: number;
};

type EngineState = {
  candles: Candle[];
  candleStartIndex: number;
  currentIndex: number;
  atrState: AtrState;
  prevClose: number | null;
  lastHigh: StructureZonesPivot | null;
  prevHigh: StructureZonesPivot | null;
  lastLow: StructureZonesPivot | null;
  prevLow: StructureZonesPivot | null;
  lastOppForHigh: number | null;
  lastOppForLow: number | null;
  supportZone: StructureZone | null;
  resistanceZone: StructureZone | null;
  supportTouchOrdinal: number;
  resistanceTouchOrdinal: number;
  supportWasTouched: boolean;
  resistanceWasTouched: boolean;
  lastSignalKey: string | null;
  signal: StructureZonesSignal | null;
  snapshot: StructureZonesSnapshot | null;
  swingPoints: StrategyFigurePoint[];
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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

const pushBoundedPoint = (
  series: StrategyFigurePoint[],
  point: StrategyFigurePoint,
  maxPoints: number,
) => {
  series.push(point);
  if (series.length > maxPoints) {
    series.splice(0, series.length - maxPoints);
  }
};

const pushBoundedCandle = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex' | 'currentIndex'>,
  candle: Candle,
  maxCandles: number,
) => {
  state.currentIndex += 1;
  state.candles.push(candle);
  if (state.candles.length > maxCandles) {
    const overflow = state.candles.length - maxCandles;
    state.candles.splice(0, overflow);
    state.candleStartIndex += overflow;
  }
  return state.currentIndex;
};

const getBufferedCandle = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  absoluteIndex: number,
) => state.candles[absoluteIndex - state.candleStartIndex] ?? null;

const getRecentBufferedCandles = (
  state: Pick<EngineState, 'candles'>,
  count: number,
) =>
  count <= 0
    ? []
    : state.candles.slice(Math.max(0, state.candles.length - count));

const getConfigNumbers = (config: StructureZonesConfig) => ({
  pivotLength: Math.max(
    2,
    Math.floor(config.STRUCTURE_ZONES_PIVOT_LENGTH ?? 5),
  ),
  atrLength: Math.max(5, Math.floor(config.STRUCTURE_ZONES_ATR_LENGTH ?? 14)),
  minSwingAtr: Math.max(
    0.1,
    Number(config.STRUCTURE_ZONES_MIN_SWING_ATR ?? 0.8),
  ),
  zoneWidthAtr: Math.max(
    0.05,
    Number(config.STRUCTURE_ZONES_ZONE_WIDTH_ATR ?? 0.5),
  ),
  acceptBars: Math.max(2, Math.floor(config.STRUCTURE_ZONES_ACCEPT_BARS ?? 2)),
  reactionCloseBeyondZone: Boolean(
    config.STRUCTURE_ZONES_REACTION_CLOSE_BEYOND_ZONE,
  ),
  requireReactionBody: Boolean(config.STRUCTURE_ZONES_REQUIRE_REACTION_BODY),
  requireBiasAlignment: Boolean(
    config.STRUCTURE_ZONES_REQUIRE_BIAS_ALIGNMENT ?? true,
  ),
  minReactionDistanceAtrLong: Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR',
      direction: 'LONG',
      fallback: 0.1,
    }),
  ),
  minReactionDistanceAtrShort: Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR',
      direction: 'SHORT',
      fallback: 0.1,
    }),
  ),
  minZoneAgeBars: Math.max(
    0,
    Math.floor(Number(config.STRUCTURE_ZONES_MIN_ZONE_AGE_BARS ?? 0)),
  ),
  maxZoneAgeBars: Math.max(
    0,
    Math.floor(Number(config.STRUCTURE_ZONES_MAX_ZONE_AGE_BARS ?? 0)),
  ),
  minTouchOrdinal: Math.max(
    1,
    Math.floor(Number(config.STRUCTURE_ZONES_MIN_TOUCH_ORDINAL ?? 1)),
  ),
  maxTouchOrdinal: Math.max(
    0,
    Math.floor(Number(config.STRUCTURE_ZONES_MAX_TOUCH_ORDINAL ?? 0)),
  ),
  tradeTransitionBreakouts: Boolean(
    config.STRUCTURE_ZONES_TRADE_TRANSITION_BREAKOUTS,
  ),
  maxFigurePoints: Math.max(
    20,
    Math.floor(config.STRUCTURE_ZONES_MAX_FIGURE_POINTS ?? 180),
  ),
});

const getWindow = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  candidateIndex: number,
  lookback: number,
) => {
  const window: Candle[] = [];
  for (
    let index = candidateIndex - lookback;
    index <= candidateIndex + lookback;
    index += 1
  ) {
    const candle = getBufferedCandle(state, index);
    if (!candle) {
      return [];
    }
    window.push(candle);
  }
  return window;
};

const isPivotHigh = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  candidateIndex: number,
  lookback: number,
) => {
  const candidate = getBufferedCandle(state, candidateIndex);
  const candidateHigh = asFiniteNumber(candidate?.high);
  if (candidateHigh == null) {
    return false;
  }
  const window = getWindow(state, candidateIndex, lookback);
  return (
    window.length === lookback * 2 + 1 &&
    window.every((candle) => candidateHigh >= Number(candle.high))
  );
};

const isPivotLow = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  candidateIndex: number,
  lookback: number,
) => {
  const candidate = getBufferedCandle(state, candidateIndex);
  const candidateLow = asFiniteNumber(candidate?.low);
  if (candidateLow == null) {
    return false;
  }
  const window = getWindow(state, candidateIndex, lookback);
  return (
    window.length === lookback * 2 + 1 &&
    window.every((candle) => candidateLow <= Number(candle.low))
  );
};

const isValidSwing = ({
  newPrice,
  oppositePrice,
  atr,
  minSwingAtr,
}: {
  newPrice: number;
  oppositePrice: number | null;
  atr: number;
  minSwingAtr: number;
}) =>
  oppositePrice == null ||
  Math.abs(newPrice - oppositePrice) >= minSwingAtr * atr;

const buildSignalContext = ({
  direction,
  kind,
  marketState,
  zone,
  supportZone,
  resistanceZone,
  lastHigh,
  lastLow,
  atr,
  zoneAgeBars,
  touchOrdinal,
  candle,
  structureBias,
}: {
  direction: Direction;
  kind: StructureZonesSignalKind;
  marketState: StructureZonesMarketState;
  zone: StructureZone;
  supportZone: StructureZone;
  resistanceZone: StructureZone;
  lastHigh: StructureZonesPivot;
  lastLow: StructureZonesPivot;
  atr: number;
  zoneAgeBars: number;
  touchOrdinal: number;
  candle: Candle;
  structureBias: 'up' | 'down' | 'range';
}): StructureZonesSignal => {
  const close = Number(candle.close);
  const open = Number(candle.open);
  const isLong = direction === 'LONG';
  const reactionDistance = isLong
    ? Math.max(0, close - zone.top)
    : Math.max(0, zone.bottom - close);
  return {
    direction,
    kind,
    marketState,
    zone,
    supportZone,
    resistanceZone,
    lastHigh,
    lastLow,
    atr,
    zoneHeight: Math.max(zone.top - zone.bottom, 1e-9),
    zoneAgeBars,
    touchOrdinal,
    reactionCloseDistancePct: (reactionDistance / Math.max(close, 1e-9)) * 100,
    reactionBodyAligned: isLong ? close > open : close < open,
    structureBias,
    timestamp: candle.timestamp,
    close,
  };
};

export const buildStructureZonesSignalContext = (
  signal: StructureZonesSignal,
) => ({
  signalDirection: signal.direction,
  signalKind: signal.kind,
  marketState: signal.marketState,
  structureBias: signal.structureBias,
  zoneKind: signal.zone.kind,
  zoneTop: signal.zone.top,
  zoneBottom: signal.zone.bottom,
  zoneLevel: signal.zone.level,
  zoneHeight: signal.zoneHeight,
  zoneAgeBars: signal.zoneAgeBars,
  touchOrdinal: signal.touchOrdinal,
  zoneSourcePivotTimestamp: signal.zone.sourcePivotTimestamp,
  supportTop: signal.supportZone.top,
  supportBottom: signal.supportZone.bottom,
  resistanceTop: signal.resistanceZone.top,
  resistanceBottom: signal.resistanceZone.bottom,
  lastHigh: signal.lastHigh.value,
  lastLow: signal.lastLow.value,
  atr: signal.atr,
  reactionCloseDistancePct: signal.reactionCloseDistancePct,
  reactionBodyAligned: signal.reactionBodyAligned,
  currentPrice: signal.close,
});

export type StructureZonesSignalContext = ReturnType<
  typeof buildStructureZonesSignalContext
>;

export const createStructureZonesEngine = ({
  config,
  initialCandles = [],
}: {
  config: StructureZonesConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => StructureZonesRuntimeState;
  getState: () => StructureZonesRuntimeState;
} => {
  const {
    pivotLength,
    atrLength,
    minSwingAtr,
    zoneWidthAtr,
    acceptBars,
    reactionCloseBeyondZone,
    requireReactionBody,
    requireBiasAlignment,
    minReactionDistanceAtrLong,
    minReactionDistanceAtrShort,
    minZoneAgeBars,
    maxZoneAgeBars,
    minTouchOrdinal,
    maxTouchOrdinal,
    tradeTransitionBreakouts,
    maxFigurePoints,
  } = getConfigNumbers(config);
  const maxCandles = Math.max(pivotLength * 2 + 1, acceptBars);
  const state: EngineState = {
    candles: [],
    candleStartIndex: 0,
    currentIndex: -1,
    atrState: { value: null, count: 0 },
    prevClose: null,
    lastHigh: null,
    prevHigh: null,
    lastLow: null,
    prevLow: null,
    lastOppForHigh: null,
    lastOppForLow: null,
    supportZone: null,
    resistanceZone: null,
    supportTouchOrdinal: 0,
    resistanceTouchOrdinal: 0,
    supportWasTouched: false,
    resistanceWasTouched: false,
    lastSignalKey: null,
    signal: null,
    snapshot: null,
    swingPoints: [],
  };

  const apply = (candle: Candle): StructureZonesRuntimeState => {
    state.signal = null;
    const close = Number(candle.close);
    const tr = calculateTrueRange(candle, state.prevClose);
    state.atrState = updateAtrState({
      atrState: state.atrState,
      tr,
      period: atrLength,
    });
    state.prevClose = close;
    const currentIndex = pushBoundedCandle(state, candle, maxCandles);
    const candidateIndex = currentIndex - pivotLength;
    const candidate =
      candidateIndex >= pivotLength
        ? getBufferedCandle(state, candidateIndex)
        : null;
    const atr = state.atrState.value ?? 0;
    let structureUpdated = false;

    if (candidate && isPivotHigh(state, candidateIndex, pivotLength)) {
      const newHigh = Number(candidate.high);
      if (
        isValidSwing({
          newPrice: newHigh,
          oppositePrice: state.lastOppForHigh,
          atr,
          minSwingAtr,
        })
      ) {
        state.prevHigh = state.lastHigh;
        state.lastHigh = {
          timestamp: candidate.timestamp,
          index: candidateIndex,
          value: newHigh,
          kind: 'high',
        };
        state.lastOppForLow = newHigh;
        pushBoundedPoint(
          state.swingPoints,
          { timestamp: candidate.timestamp, value: newHigh },
          maxFigurePoints,
        );
        structureUpdated = true;
      }
    }

    if (candidate && isPivotLow(state, candidateIndex, pivotLength)) {
      const newLow = Number(candidate.low);
      if (
        isValidSwing({
          newPrice: newLow,
          oppositePrice: state.lastOppForLow,
          atr,
          minSwingAtr,
        })
      ) {
        state.prevLow = state.lastLow;
        state.lastLow = {
          timestamp: candidate.timestamp,
          index: candidateIndex,
          value: newLow,
          kind: 'low',
        };
        state.lastOppForHigh = newLow;
        pushBoundedPoint(
          state.swingPoints,
          { timestamp: candidate.timestamp, value: newLow },
          maxFigurePoints,
        );
        structureUpdated = true;
      }
    }

    if (structureUpdated && state.lastHigh && state.lastLow) {
      const half = zoneWidthAtr * atr;
      const resistanceChanged =
        state.resistanceZone?.sourcePivotTimestamp !== state.lastHigh.timestamp;
      const supportChanged =
        state.supportZone?.sourcePivotTimestamp !== state.lastLow.timestamp;
      state.resistanceZone = {
        kind: 'resistance',
        top: state.lastHigh.value + half,
        bottom: state.lastHigh.value - half,
        level: state.lastHigh.value,
        sourcePivotTimestamp: state.lastHigh.timestamp,
        sourcePivotIndex: state.lastHigh.index,
      };
      state.supportZone = {
        kind: 'support',
        top: state.lastLow.value + half,
        bottom: state.lastLow.value - half,
        level: state.lastLow.value,
        sourcePivotTimestamp: state.lastLow.timestamp,
        sourcePivotIndex: state.lastLow.index,
      };
      if (resistanceChanged) {
        state.resistanceTouchOrdinal = 0;
        state.resistanceWasTouched = false;
      }
      if (supportChanged) {
        state.supportTouchOrdinal = 0;
        state.supportWasTouched = false;
      }
    }

    const isUpStructure = Boolean(
      state.lastHigh &&
        state.prevHigh &&
        state.lastLow &&
        state.prevLow &&
        state.lastHigh.value > state.prevHigh.value &&
        state.lastLow.value > state.prevLow.value,
    );
    const isDownStructure = Boolean(
      state.lastHigh &&
        state.prevHigh &&
        state.lastLow &&
        state.prevLow &&
        state.lastHigh.value < state.prevHigh.value &&
        state.lastLow.value < state.prevLow.value,
    );
    const structureBias = isUpStructure
      ? 'up'
      : isDownStructure
        ? 'down'
        : 'range';
    const recent = getRecentBufferedCandles(state, acceptBars);
    const canDraw = Boolean(state.supportZone && state.resistanceZone);
    const acceptBelowLower =
      canDraw &&
      recent.length >= acceptBars &&
      recent.every((row) => Number(row.close) < state.supportZone!.bottom);
    const acceptAboveUpper =
      canDraw &&
      recent.length >= acceptBars &&
      recent.every((row) => Number(row.close) > state.resistanceZone!.top);
    const marketState: StructureZonesMarketState =
      (isUpStructure && acceptBelowLower) ||
      (isDownStructure && acceptAboveUpper)
        ? 'Transition'
        : isUpStructure || isDownStructure
          ? 'Trend'
          : 'Range';

    if (
      state.supportZone &&
      state.resistanceZone &&
      state.lastHigh &&
      state.lastLow
    ) {
      const supportTouched = Number(candle.low) <= state.supportZone.top;
      const resistanceTouched =
        Number(candle.high) >= state.resistanceZone.bottom;
      const supportOverlapped =
        Number(candle.low) <= state.supportZone.top &&
        Number(candle.high) >= state.supportZone.bottom;
      const resistanceOverlapped =
        Number(candle.high) >= state.resistanceZone.bottom &&
        Number(candle.low) <= state.resistanceZone.top;
      if (supportOverlapped && !state.supportWasTouched) {
        state.supportTouchOrdinal += 1;
      }
      if (resistanceOverlapped && !state.resistanceWasTouched) {
        state.resistanceTouchOrdinal += 1;
      }
      state.supportWasTouched = supportOverlapped;
      state.resistanceWasTouched = resistanceOverlapped;
      const supportZoneAgeBars = Math.max(
        0,
        currentIndex - state.supportZone.sourcePivotIndex,
      );
      const resistanceZoneAgeBars = Math.max(
        0,
        currentIndex - state.resistanceZone.sourcePivotIndex,
      );
      const lifecycleAccepted = (ageBars: number, touchOrdinal: number) =>
        ageBars >= minZoneAgeBars &&
        (maxZoneAgeBars <= 0 || ageBars <= maxZoneAgeBars) &&
        touchOrdinal >= minTouchOrdinal &&
        (maxTouchOrdinal <= 0 || touchOrdinal <= maxTouchOrdinal);
      const supportReactionClose = reactionCloseBeyondZone
        ? close > state.supportZone.top
        : close > state.supportZone.level;
      const resistanceReactionClose = reactionCloseBeyondZone
        ? close < state.resistanceZone.bottom
        : close < state.resistanceZone.level;
      const bullBody = close > Number(candle.open);
      const bearBody = close < Number(candle.open);
      const longReactionDistance = Math.max(0, close - state.supportZone.top);
      const shortReactionDistance = Math.max(
        0,
        state.resistanceZone.bottom - close,
      );
      const longReaction =
        supportTouched &&
        lifecycleAccepted(supportZoneAgeBars, state.supportTouchOrdinal) &&
        supportReactionClose &&
        (!requireReactionBody || bullBody) &&
        (!requireBiasAlignment || structureBias !== 'down') &&
        longReactionDistance >= minReactionDistanceAtrLong * atr &&
        marketState !== 'Transition';
      const shortReaction =
        resistanceTouched &&
        lifecycleAccepted(
          resistanceZoneAgeBars,
          state.resistanceTouchOrdinal,
        ) &&
        resistanceReactionClose &&
        (!requireReactionBody || bearBody) &&
        (!requireBiasAlignment || structureBias !== 'up') &&
        shortReactionDistance >= minReactionDistanceAtrShort * atr &&
        marketState !== 'Transition';
      const longTransition =
        tradeTransitionBreakouts &&
        marketState === 'Transition' &&
        acceptAboveUpper;
      const shortTransition =
        tradeTransitionBreakouts &&
        marketState === 'Transition' &&
        acceptBelowLower;

      const signal = longTransition
        ? buildSignalContext({
            direction: 'LONG',
            kind: 'resistance_breakout',
            marketState,
            zone: state.resistanceZone,
            supportZone: state.supportZone,
            resistanceZone: state.resistanceZone,
            lastHigh: state.lastHigh,
            lastLow: state.lastLow,
            atr,
            zoneAgeBars: resistanceZoneAgeBars,
            touchOrdinal: state.resistanceTouchOrdinal,
            candle,
            structureBias,
          })
        : shortTransition
          ? buildSignalContext({
              direction: 'SHORT',
              kind: 'support_breakdown',
              marketState,
              zone: state.supportZone,
              supportZone: state.supportZone,
              resistanceZone: state.resistanceZone,
              lastHigh: state.lastHigh,
              lastLow: state.lastLow,
              atr,
              zoneAgeBars: supportZoneAgeBars,
              touchOrdinal: state.supportTouchOrdinal,
              candle,
              structureBias,
            })
          : longReaction
            ? buildSignalContext({
                direction: 'LONG',
                kind: 'support_reaction',
                marketState,
                zone: state.supportZone,
                supportZone: state.supportZone,
                resistanceZone: state.resistanceZone,
                lastHigh: state.lastHigh,
                lastLow: state.lastLow,
                atr,
                zoneAgeBars: supportZoneAgeBars,
                touchOrdinal: state.supportTouchOrdinal,
                candle,
                structureBias,
              })
            : shortReaction
              ? buildSignalContext({
                  direction: 'SHORT',
                  kind: 'resistance_reaction',
                  marketState,
                  zone: state.resistanceZone,
                  supportZone: state.supportZone,
                  resistanceZone: state.resistanceZone,
                  lastHigh: state.lastHigh,
                  lastLow: state.lastLow,
                  atr,
                  zoneAgeBars: resistanceZoneAgeBars,
                  touchOrdinal: state.resistanceTouchOrdinal,
                  candle,
                  structureBias,
                })
              : null;

      const signalKey = signal
        ? `${signal.kind}:${signal.zone.sourcePivotTimestamp}`
        : null;
      if (signal && signalKey !== state.lastSignalKey) {
        state.signal = signal;
        state.lastSignalKey = signalKey;
      }
    }

    state.snapshot = {
      marketState,
      isUpStructure,
      isDownStructure,
      acceptBelowLower,
      acceptAboveUpper,
      lastHigh: state.lastHigh,
      prevHigh: state.prevHigh,
      lastLow: state.lastLow,
      prevLow: state.prevLow,
      supportZone: state.supportZone,
      resistanceZone: state.resistanceZone,
      supportZoneAgeBars: state.supportZone
        ? Math.max(0, currentIndex - state.supportZone.sourcePivotIndex)
        : null,
      resistanceZoneAgeBars: state.resistanceZone
        ? Math.max(0, currentIndex - state.resistanceZone.sourcePivotIndex)
        : null,
      supportTouchOrdinal: state.supportTouchOrdinal,
      resistanceTouchOrdinal: state.resistanceTouchOrdinal,
      atr,
      timestamp: candle.timestamp,
      close,
    };

    return {
      signal: state.signal,
      snapshot: state.snapshot,
      swingPoints: state.swingPoints,
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: () => ({
      signal: state.signal,
      snapshot: state.snapshot,
      swingPoints: state.swingPoints,
    }),
  };
};
