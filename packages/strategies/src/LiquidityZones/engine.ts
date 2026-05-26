import { Candle, Direction } from '@tradejs/types';
import {
  LiquidityZonesConfig,
  LiquidityZonesFilterMode,
  LiquidityZonesSwingAreaMode,
} from './config';

export type LiquidityZonesKind = 'swing_high_liquidity' | 'swing_low_liquidity';

export interface LiquidityZone {
  id: string;
  kind: LiquidityZonesKind;
  direction: Direction;
  top: number;
  bottom: number;
  level: number;
  mid: number;
  startIndex: number;
  startTimestamp: number;
  hitCount: number;
  hitVolume: number;
  crossed: boolean;
  traded: boolean;
  lastTouchIndex: number;
}

export interface LiquidityZonesSignal {
  direction: Direction;
  zone: LiquidityZone;
  timestamp: number;
  close: number;
  zoneAgeBars: number;
  zoneHeight: number;
  filterMode: LiquidityZonesFilterMode;
  filterMetric: number;
  retestPenetrationPct: number;
  reactionCloseDistancePct: number;
  reactionBodyAligned: boolean;
}

export interface LiquidityZonesRuntimeState {
  signal: LiquidityZonesSignal | null;
  zones: LiquidityZone[];
}

type EngineState = {
  candles: Candle[];
  zones: LiquidityZone[];
  signal: LiquidityZonesSignal | null;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getConfigNumbers = (config: LiquidityZonesConfig) => ({
  pivotLookback: Math.max(
    1,
    Math.floor(config.LIQUIDITY_ZONES_PIVOT_LOOKBACK ?? 15),
  ),
  swingAreaMode: config.LIQUIDITY_ZONES_SWING_AREA_MODE,
  filterMode: config.LIQUIDITY_ZONES_FILTER_MODE,
  minFilterValue: Math.max(
    0,
    Number(config.LIQUIDITY_ZONES_MIN_FILTER_VALUE ?? 0),
  ),
  showSwingHighZones: Boolean(config.LIQUIDITY_ZONES_SHOW_SWING_HIGH_ZONES),
  showSwingLowZones: Boolean(config.LIQUIDITY_ZONES_SHOW_SWING_LOW_ZONES),
  maxAge: Math.max(1, Math.floor(config.LIQUIDITY_ZONES_MAX_AGE ?? 500)),
  reactionCloseBeyondZone: Boolean(
    config.LIQUIDITY_ZONES_REACTION_CLOSE_BEYOND_ZONE,
  ),
  requireReactionBody: Boolean(config.LIQUIDITY_ZONES_REQUIRE_REACTION_BODY),
  maxRetestPenetrationPct: Math.max(
    0,
    Number(config.LIQUIDITY_ZONES_MAX_RETEST_PENETRATION_PCT ?? 125),
  ),
});

const cloneZone = (zone: LiquidityZone): LiquidityZone => ({ ...zone });

const getFilterMetric = (
  zone: LiquidityZone,
  mode: LiquidityZonesFilterMode,
) => (mode === 'volume' ? zone.hitVolume : zone.hitCount);

const getWindow = (
  candles: Candle[],
  candidateIndex: number,
  lookback: number,
) =>
  candles.slice(
    Math.max(0, candidateIndex - lookback),
    candidateIndex + lookback + 1,
  );

const isPivotHigh = (
  candles: Candle[],
  candidateIndex: number,
  lookback: number,
) => {
  const candidate = candles[candidateIndex];
  const candidateHigh = asFiniteNumber(candidate?.high);
  if (candidateHigh == null) {
    return false;
  }
  const window = getWindow(candles, candidateIndex, lookback);
  return window.every((candle) => candidateHigh >= Number(candle.high));
};

const isPivotLow = (
  candles: Candle[],
  candidateIndex: number,
  lookback: number,
) => {
  const candidate = candles[candidateIndex];
  const candidateLow = asFiniteNumber(candidate?.low);
  if (candidateLow == null) {
    return false;
  }
  const window = getWindow(candles, candidateIndex, lookback);
  return window.every((candle) => candidateLow <= Number(candle.low));
};

const createZoneFromPivot = ({
  candle,
  index,
  kind,
  swingAreaMode,
}: {
  candle: Candle;
  index: number;
  kind: LiquidityZonesKind;
  swingAreaMode: LiquidityZonesSwingAreaMode;
}): LiquidityZone => {
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  const isHighZone = kind === 'swing_high_liquidity';
  const top = isHighZone
    ? high
    : swingAreaMode === 'wick_extremity'
      ? Math.min(open, close)
      : high;
  const bottom = isHighZone
    ? swingAreaMode === 'wick_extremity'
      ? Math.max(open, close)
      : low
    : low;
  const level = isHighZone ? top : bottom;

  return {
    id: `mslzones-${isHighZone ? 'high' : 'low'}-${candle.timestamp}`,
    kind,
    direction: isHighZone ? 'SHORT' : 'LONG',
    top,
    bottom,
    level,
    mid: (top + bottom) / 2,
    startIndex: index,
    startTimestamp: candle.timestamp,
    hitCount: 0,
    hitVolume: 0,
    crossed: false,
    traded: false,
    lastTouchIndex: -1,
  };
};

const overlapsZone = (candle: Candle, zone: LiquidityZone) =>
  Number(candle.low) < zone.top && Number(candle.high) > zone.bottom;

const isZoneCrossed = (candle: Candle, zone: LiquidityZone) =>
  zone.kind === 'swing_high_liquidity'
    ? Number(candle.close) > zone.top
    : Number(candle.close) < zone.bottom;

const buildRetestSignal = ({
  zone,
  candle,
  index,
  filterMode,
  reactionCloseBeyondZone,
  requireReactionBody,
  maxRetestPenetrationPct,
}: {
  zone: LiquidityZone;
  candle: Candle;
  index: number;
  filterMode: LiquidityZonesFilterMode;
  reactionCloseBeyondZone: boolean;
  requireReactionBody: boolean;
  maxRetestPenetrationPct: number;
}): LiquidityZonesSignal | null => {
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  const isLong = zone.direction === 'LONG';
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

  const zoneHeight = Math.max(zone.top - zone.bottom, 1e-9);
  const retestDistance = isLong
    ? Math.max(0, zone.top - low)
    : Math.max(0, high - zone.bottom);
  const retestPenetrationPct = (retestDistance / zoneHeight) * 100;
  if (
    maxRetestPenetrationPct > 0 &&
    retestPenetrationPct > maxRetestPenetrationPct
  ) {
    return null;
  }

  const reactionDistance = isLong
    ? Math.max(0, close - zone.top)
    : Math.max(0, zone.bottom - close);

  return {
    direction: zone.direction,
    zone: cloneZone(zone),
    timestamp: candle.timestamp,
    close,
    zoneAgeBars: index - zone.startIndex,
    zoneHeight,
    filterMode,
    filterMetric: getFilterMetric(zone, filterMode),
    retestPenetrationPct,
    reactionCloseDistancePct: (reactionDistance / Math.max(close, 1e-9)) * 100,
    reactionBodyAligned,
  };
};

export const buildLiquidityZonesSignalContext = (
  signal: LiquidityZonesSignal,
) => ({
  signalDirection: signal.direction,
  zoneKind: signal.zone.kind,
  zoneTop: signal.zone.top,
  zoneBottom: signal.zone.bottom,
  zoneMid: signal.zone.mid,
  zoneLevel: signal.zone.level,
  zoneHeight: signal.zoneHeight,
  zoneAgeBars: signal.zoneAgeBars,
  hitCount: signal.zone.hitCount,
  hitVolume: signal.zone.hitVolume,
  filterMode: signal.filterMode,
  filterMetric: signal.filterMetric,
  currentPrice: signal.close,
  retestPenetrationPct: signal.retestPenetrationPct,
  reactionCloseDistancePct: signal.reactionCloseDistancePct,
  reactionBodyAligned: signal.reactionBodyAligned,
});

export type LiquidityZonesSignalContext = ReturnType<
  typeof buildLiquidityZonesSignalContext
>;

export const createLiquidityZonesEngine = ({
  config,
  initialCandles = [],
}: {
  config: LiquidityZonesConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => LiquidityZonesRuntimeState;
  getState: () => LiquidityZonesRuntimeState;
} => {
  const {
    pivotLookback,
    swingAreaMode,
    filterMode,
    minFilterValue,
    showSwingHighZones,
    showSwingLowZones,
    maxAge,
    reactionCloseBeyondZone,
    requireReactionBody,
    maxRetestPenetrationPct,
  } = getConfigNumbers(config);
  const state: EngineState = {
    candles: [],
    zones: [],
    signal: null,
  };

  const apply = (candle: Candle): LiquidityZonesRuntimeState => {
    state.signal = null;
    state.candles.push(candle);
    const currentIndex = state.candles.length - 1;
    const candidateIndex = currentIndex - pivotLookback;
    const canConfirmPivot = candidateIndex >= pivotLookback;
    const candidate = canConfirmPivot ? state.candles[candidateIndex] : null;
    const highPivotDetected =
      Boolean(candidate) &&
      showSwingHighZones &&
      isPivotHigh(state.candles, candidateIndex, pivotLookback);
    const lowPivotDetected =
      Boolean(candidate) &&
      showSwingLowZones &&
      isPivotLow(state.candles, candidateIndex, pivotLookback);

    if (candidate) {
      for (const zone of state.zones) {
        if (!zone.crossed && overlapsZone(candidate, zone)) {
          zone.hitCount += 1;
          zone.hitVolume += Number(candidate.volume) || 0;
        }
      }
    }

    if (highPivotDetected && candidate) {
      state.zones.push(
        createZoneFromPivot({
          candle: candidate,
          index: candidateIndex,
          kind: 'swing_high_liquidity',
          swingAreaMode,
        }),
      );
    }

    if (lowPivotDetected && candidate) {
      state.zones.push(
        createZoneFromPivot({
          candle: candidate,
          index: candidateIndex,
          kind: 'swing_low_liquidity',
          swingAreaMode,
        }),
      );
    }

    for (let index = state.zones.length - 1; index >= 0; index -= 1) {
      const zone = state.zones[index];
      if (!zone) {
        continue;
      }

      if (currentIndex - zone.startIndex > maxAge) {
        state.zones.splice(index, 1);
        continue;
      }

      if (!zone.crossed && isZoneCrossed(candle, zone)) {
        zone.crossed = true;
        continue;
      }

      if (zone.crossed || zone.traded) {
        continue;
      }

      const filterMetric = getFilterMetric(zone, filterMode);
      if (filterMetric < minFilterValue) {
        continue;
      }

      if (currentIndex - zone.lastTouchIndex <= 2) {
        continue;
      }

      const signal = buildRetestSignal({
        zone,
        candle,
        index: currentIndex,
        filterMode,
        reactionCloseBeyondZone,
        requireReactionBody,
        maxRetestPenetrationPct,
      });
      if (signal) {
        zone.traded = true;
        zone.lastTouchIndex = currentIndex;
        state.signal = signal;
      }
    }

    return {
      signal: state.signal,
      zones: state.zones.map(cloneZone),
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: () => ({
      signal: state.signal,
      zones: state.zones.map(cloneZone),
    }),
  };
};
