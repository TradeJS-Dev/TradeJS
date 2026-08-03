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
  traded: boolean;
}

export interface LiquidityTailsSignal {
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
  reactionBodyAligned: boolean;
}

export interface LiquidityTailsExecutionContext {
  action: 'open' | 'increase';
  level: 1 | 2;
  levelsFilled: number;
  positionQty: number;
  projectedQty: number;
  projectedAveragePrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  existingRiskValue: number;
  remainingRiskValue: number;
  projectedRiskValue: number;
  riskBudgetUsedPct: number;
  initialRiskFraction: number;
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
}): LiquidityTailsSignal | null => {
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  const zoneHeight = Math.max(zone.top - zone.bottom, 1e-9);
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
  const activeWick = isLong ? bottomShadow : topShadow;
  const oppositeWick = isLong ? topShadow : bottomShadow;
  const wickBodyRatio = activeWick / Math.max(candleBody, 1e-9);
  const wickDominanceRatio = activeWick / Math.max(oppositeWick, 1e-9);

  return {
    direction: zone.direction,
    zone: cloneZone(zone),
    timestamp: candle.timestamp,
    close,
    atr,
    zoneAgeBars: index - zone.birthIndex,
    topShadow,
    bottomShadow,
    candleBody,
    wickBodyRatio,
    wickDominanceRatio,
    retestPenetrationPct,
    reactionCloseDistancePct: (reactionDistance / Math.max(close, 1e-9)) * 100,
    reactionBodyAligned,
  };
};

export const buildLiquidityTailsSignalContext = (
  signal: LiquidityTailsSignal,
  executionContext?: LiquidityTailsExecutionContext,
) => ({
  signalDirection: signal.direction,
  zoneId: signal.zone.id,
  zoneKind: signal.zone.kind,
  zoneTop: signal.zone.top,
  zoneBottom: signal.zone.bottom,
  zoneMid: signal.zone.mid,
  zoneHeight: signal.zone.top - signal.zone.bottom,
  zoneAgeBars: signal.zoneAgeBars,
  zoneTouches: signal.zone.touches,
  originVolume: signal.zone.originVolume,
  currentPrice: signal.close,
  atr: signal.atr,
  wickBodyRatio: signal.wickBodyRatio,
  wickDominanceRatio: signal.wickDominanceRatio,
  retestPenetrationPct: signal.retestPenetrationPct,
  reactionCloseDistancePct: signal.reactionCloseDistancePct,
  reactionBodyAligned: signal.reactionBodyAligned,
  action: executionContext?.action ?? 'open',
  level: executionContext?.level ?? 1,
  levelsFilled: executionContext?.levelsFilled ?? 0,
  positionQty: executionContext?.positionQty ?? 0,
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
  } = getConfigNumbers(config);
  const state: EngineState = {
    index: -1,
    prevClose: null,
    atrState: { value: null, count: 0 },
    lastFireIndex: 0,
    zones: [],
    signal: null,
  };

  const apply = (candle: Candle): LiquidityTailsRuntimeState => {
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

      if (!zone.traded && state.signal == null) {
        const signal = buildRetestSignal({
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
        });
        if (signal) {
          zone.traded = true;
          state.signal = signal;
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
