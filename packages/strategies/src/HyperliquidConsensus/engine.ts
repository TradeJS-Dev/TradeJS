import type {
  BaseHyperliquidWhaleFlowContext,
  Direction,
} from '@tradejs/types';
import type { HyperliquidConsensusConfig } from './config';

export interface HyperliquidConsensusSignalContext {
  signalDirection: Direction;
  symbol: string;
  interval: BaseHyperliquidWhaleFlowContext['interval'];
  asOfTs: number | null;
  windowEndTs: number;
  ageMs: number | null;
  uniqueWhales: number;
  coveredWhales: number;
  expectedWhales: number;
  coveragePct: number;
  positionAwarePct: number;
  entryWhales: number;
  longEntryWhales: number;
  shortEntryWhales: number;
  longExitWhales: number;
  shortExitWhales: number;
  totalEntryNotionalUsd: number;
  longEntryNotionalUsd: number;
  shortEntryNotionalUsd: number;
  longExitNotionalUsd: number;
  shortExitNotionalUsd: number;
  entryNetNotionalUsd: number;
  entryLongSharePct: number;
  consensusScore: number;
  absoluteConsensusScore: number;
}

export type HyperliquidConsensusEvaluation =
  | { kind: 'skip'; code: string }
  | { kind: 'signal'; context: HyperliquidConsensusSignalContext };

export type HyperliquidConsensusExitEvaluation =
  | { kind: 'hold' }
  | {
      kind: 'exit';
      code: 'HLC_POSITION_REDUCTION_EXIT';
      exitWhales: number;
      exitNotionalUsd: number;
      exitDirectionShare: number;
    };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const evaluateHyperliquidConsensus = ({
  flow,
  config,
}: {
  flow: BaseHyperliquidWhaleFlowContext | null | undefined;
  config: HyperliquidConsensusConfig;
}): HyperliquidConsensusEvaluation => {
  if (!flow) return { kind: 'skip', code: 'HLC_NO_CONTEXT' };
  if (flow.stale) return { kind: 'skip', code: 'HLC_CONTEXT_STALE' };
  if (
    !flow.coverageSufficient ||
    !isFiniteNumber(flow.coveragePct) ||
    flow.coveragePct < Number(config.HLC_MIN_COVERAGE_PCT)
  ) {
    return { kind: 'skip', code: 'HLC_INSUFFICIENT_COVERAGE' };
  }
  if (
    !isFiniteNumber(flow.ageMs) ||
    flow.ageMs < 0 ||
    flow.ageMs > Number(config.HLC_MAX_CONTEXT_AGE_MS)
  ) {
    return { kind: 'skip', code: 'HLC_CONTEXT_TOO_OLD' };
  }
  if (flow.uniqueWhales < Number(config.HLC_MIN_UNIQUE_WHALES)) {
    return { kind: 'skip', code: 'HLC_INSUFFICIENT_WALLETS' };
  }
  if (
    !isFiniteNumber(flow.positionAwarePct) ||
    flow.positionAwarePct < Number(config.HLC_MIN_POSITION_AWARE_PCT)
  ) {
    return { kind: 'skip', code: 'HLC_INSUFFICIENT_POSITION_DATA' };
  }

  const totalEntryNotionalUsd =
    flow.longEntryNotionalUsd + flow.shortEntryNotionalUsd;
  if (
    !isFiniteNumber(totalEntryNotionalUsd) ||
    totalEntryNotionalUsd < Number(config.HLC_MIN_TOTAL_ENTRY_NOTIONAL_USD)
  ) {
    return { kind: 'skip', code: 'HLC_INSUFFICIENT_ENTRY_NOTIONAL' };
  }
  if (
    !isFiniteNumber(flow.entryNetNotionalUsd) ||
    Math.abs(flow.entryNetNotionalUsd) <
      Number(config.HLC_MIN_NET_ENTRY_NOTIONAL_USD)
  ) {
    return { kind: 'skip', code: 'HLC_INSUFFICIENT_ENTRY_IMBALANCE' };
  }
  if (!isFiniteNumber(flow.entryLongSharePct)) {
    return { kind: 'skip', code: 'HLC_MISSING_ENTRY_SHARE' };
  }

  const entryLongSharePct = clamp(flow.entryLongSharePct, 0, 1);
  const consensusScore = clamp(
    (flow.longEntryNotionalUsd - flow.shortEntryNotionalUsd) /
      totalEntryNotionalUsd,
    -1,
    1,
  );
  let signalDirection: Direction | null = null;
  if (
    entryLongSharePct >= Number(config.HLC_LONG_MIN_ENTRY_SHARE) &&
    consensusScore > 0
  ) {
    signalDirection = 'LONG';
  } else if (
    entryLongSharePct <= Number(config.HLC_SHORT_MAX_ENTRY_SHARE) &&
    consensusScore < 0
  ) {
    signalDirection = 'SHORT';
  }

  if (!signalDirection) {
    return { kind: 'skip', code: 'HLC_NEUTRAL_CONSENSUS' };
  }
  const entryWhales =
    signalDirection === 'LONG' ? flow.longEntryWhales : flow.shortEntryWhales;
  if (entryWhales < Number(config.HLC_MIN_UNIQUE_WHALES)) {
    return { kind: 'skip', code: 'HLC_INSUFFICIENT_ENTRY_WALLETS' };
  }

  return {
    kind: 'signal',
    context: {
      signalDirection,
      symbol: flow.symbol,
      interval: flow.interval,
      asOfTs: flow.asOfTs,
      windowEndTs: flow.windowEndTs,
      ageMs: flow.ageMs,
      uniqueWhales: flow.uniqueWhales,
      coveredWhales: flow.coveredWhales,
      expectedWhales: flow.expectedWhales,
      coveragePct: flow.coveragePct,
      positionAwarePct: flow.positionAwarePct,
      entryWhales,
      longEntryWhales: flow.longEntryWhales,
      shortEntryWhales: flow.shortEntryWhales,
      longExitWhales: flow.longExitWhales,
      shortExitWhales: flow.shortExitWhales,
      totalEntryNotionalUsd,
      longEntryNotionalUsd: flow.longEntryNotionalUsd,
      shortEntryNotionalUsd: flow.shortEntryNotionalUsd,
      longExitNotionalUsd: flow.longExitNotionalUsd,
      shortExitNotionalUsd: flow.shortExitNotionalUsd,
      entryNetNotionalUsd: flow.entryNetNotionalUsd,
      entryLongSharePct,
      consensusScore,
      absoluteConsensusScore: Math.abs(consensusScore),
    },
  };
};

export const evaluateHyperliquidConsensusExit = ({
  flow,
  positionDirection,
  config,
}: {
  flow: BaseHyperliquidWhaleFlowContext | null | undefined;
  positionDirection: Direction;
  config: HyperliquidConsensusConfig;
}): HyperliquidConsensusExitEvaluation => {
  if (
    !flow ||
    flow.stale ||
    !flow.coverageSufficient ||
    flow.coveragePct < Number(config.HLC_MIN_COVERAGE_PCT) ||
    flow.positionAwarePct < Number(config.HLC_MIN_POSITION_AWARE_PCT)
  ) {
    return { kind: 'hold' };
  }

  const exitWhales =
    positionDirection === 'LONG' ? flow.longExitWhales : flow.shortExitWhales;
  const exitNotionalUsd =
    positionDirection === 'LONG'
      ? flow.longExitNotionalUsd
      : flow.shortExitNotionalUsd;
  const totalExitNotionalUsd =
    flow.longExitNotionalUsd + flow.shortExitNotionalUsd;
  const exitDirectionShare =
    totalExitNotionalUsd > 0 ? exitNotionalUsd / totalExitNotionalUsd : 0;

  if (
    exitWhales < Number(config.HLC_EXIT_MIN_UNIQUE_WHALES) ||
    exitNotionalUsd < Number(config.HLC_EXIT_MIN_NOTIONAL_USD) ||
    exitDirectionShare < Number(config.HLC_EXIT_MIN_DIRECTION_SHARE)
  ) {
    return { kind: 'hold' };
  }

  return {
    kind: 'exit',
    code: 'HLC_POSITION_REDUCTION_EXIT',
    exitWhales,
    exitNotionalUsd,
    exitDirectionShare,
  };
};
