import { createHash } from 'crypto';
import type { AiDatasetRow } from '@tradejs/types';

export type AiTrainQuarantineEvaluation = {
  profit: number;
  profitableTrade: boolean;
  aiApproved: boolean;
  rawAiApproved?: boolean;
  quality: number | null;
  direction?: string | null;
  timestamp?: number | null;
  modelCandidate?: boolean;
  strategy?: string | null;
  symbol?: string | null;
};

export type AiTrainSymbolQuarantineOptions = {
  enabled: boolean;
  minApprovedLosses: number;
  minProfitFactor: number;
  cooldownDays: number;
};

export type AiTrainSymbolQuarantineEvent = {
  strategy: string;
  symbol: string;
  startedAt: number;
  until: number;
  approvedLosses: number;
  profitFactor: number | null;
  grossProfit: number;
  grossLoss: number;
};

export type AiTrainSymbolQuarantineSummary = {
  enabled: boolean;
  minApprovedLosses: number;
  minProfitFactor: number;
  cooldownDays: number;
  blocked: number;
  events: AiTrainSymbolQuarantineEvent[];
};

type SymbolState = {
  quarantineUntil: number | null;
  approvedLosses: number;
  grossProfit: number;
  grossLoss: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeKeyPart = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
};

const getProfitFactor = ({
  grossProfit,
  grossLoss,
}: Pick<SymbolState, 'grossProfit' | 'grossLoss'>) => {
  if (grossLoss <= 0) {
    return grossProfit > 0 ? null : 0;
  }

  return grossProfit / grossLoss;
};

const createEmptyState = (): SymbolState => ({
  quarantineUntil: null,
  approvedLosses: 0,
  grossProfit: 0,
  grossLoss: 0,
});

export const applyAiTrainSymbolQuarantine = <
  T extends AiTrainQuarantineEvaluation,
>(
  evaluations: T[],
  options: AiTrainSymbolQuarantineOptions,
): {
  evaluations: T[];
  summary: AiTrainSymbolQuarantineSummary;
} => {
  const summary: AiTrainSymbolQuarantineSummary = {
    enabled: options.enabled,
    minApprovedLosses: options.minApprovedLosses,
    minProfitFactor: options.minProfitFactor,
    cooldownDays: options.cooldownDays,
    blocked: 0,
    events: [],
  };

  if (!options.enabled) {
    return {
      evaluations: evaluations.map((evaluation) => ({
        ...evaluation,
        rawAiApproved: evaluation.aiApproved,
      })),
      summary,
    };
  }

  const cooldownMs = Math.max(0, options.cooldownDays) * DAY_MS;
  const minApprovedLosses = Math.max(1, Math.trunc(options.minApprovedLosses));
  const minProfitFactor = Math.max(0, options.minProfitFactor);
  const states = new Map<string, SymbolState>();
  const ordered = evaluations
    .map((evaluation, index) => ({ evaluation, index }))
    .sort((left, right) => {
      const leftTimestamp =
        typeof left.evaluation.timestamp === 'number' &&
        Number.isFinite(left.evaluation.timestamp)
          ? left.evaluation.timestamp
          : Number.POSITIVE_INFINITY;
      const rightTimestamp =
        typeof right.evaluation.timestamp === 'number' &&
        Number.isFinite(right.evaluation.timestamp)
          ? right.evaluation.timestamp
          : Number.POSITIVE_INFINITY;

      return leftTimestamp - rightTimestamp || left.index - right.index;
    });
  const result = evaluations.map((evaluation) => ({
    ...evaluation,
    rawAiApproved: evaluation.aiApproved,
  }));

  for (const { evaluation, index } of ordered) {
    const timestamp =
      typeof evaluation.timestamp === 'number' &&
      Number.isFinite(evaluation.timestamp)
        ? evaluation.timestamp
        : null;
    const strategy = normalizeKeyPart(evaluation.strategy, 'unknown');
    const symbol = normalizeKeyPart(evaluation.symbol, 'unknown');
    const key = `${strategy}:${symbol}`;
    const state = states.get(key) ?? createEmptyState();
    states.set(key, state);

    if (
      timestamp != null &&
      state.quarantineUntil != null &&
      timestamp >= state.quarantineUntil
    ) {
      state.quarantineUntil = null;
      state.approvedLosses = 0;
      state.grossProfit = 0;
      state.grossLoss = 0;
    }

    if (
      evaluation.aiApproved &&
      timestamp != null &&
      state.quarantineUntil != null &&
      timestamp < state.quarantineUntil
    ) {
      result[index] = {
        ...result[index],
        aiApproved: false,
      };
      summary.blocked += 1;
      continue;
    }

    if (!evaluation.aiApproved) {
      continue;
    }

    if (evaluation.profit > 0) {
      state.grossProfit += evaluation.profit;
    } else if (evaluation.profit < 0) {
      state.grossLoss += Math.abs(evaluation.profit);
      state.approvedLosses += 1;
    }

    const profitFactor = getProfitFactor(state);
    if (
      timestamp != null &&
      cooldownMs > 0 &&
      state.approvedLosses >= minApprovedLosses &&
      profitFactor != null &&
      profitFactor < minProfitFactor
    ) {
      state.quarantineUntil = timestamp + cooldownMs;
      summary.events.push({
        strategy,
        symbol,
        startedAt: timestamp,
        until: state.quarantineUntil,
        approvedLosses: state.approvedLosses,
        profitFactor,
        grossProfit: state.grossProfit,
        grossLoss: state.grossLoss,
      });
    }
  }

  return {
    evaluations: result,
    summary,
  };
};

export type AiTrainDuplicateSignalRow = Pick<
  AiDatasetRow,
  | 'strategyName'
  | 'signalId'
  | 'symbol'
  | 'direction'
  | 'timestamp'
  | 'profit'
  | 'payload'
>;

export type AiTrainDuplicateSignalSummary = {
  groups: number;
  rows: number;
  maxGroupSize: number;
  worstGroups: Array<{
    key: string;
    strategy: string;
    symbol: string;
    direction: string;
    timestamp: number;
    count: number;
    totalProfit: number;
  }>;
};

const stableStringify = (value: unknown): string => {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

const hashContext = (row: AiTrainDuplicateSignalRow) => {
  const payload = row.payload;
  const signal = payload?.signal;
  const additional =
    payload?.additionalIndicators &&
    typeof payload.additionalIndicators === 'object' &&
    !Array.isArray(payload.additionalIndicators)
      ? (payload.additionalIndicators as Record<string, unknown>)
      : {};
  const context = {
    prices: signal?.prices ?? null,
    trendShiftContext: additional.trendShiftContext ?? null,
    marketContext: additional.marketContext ?? null,
  };

  return createHash('sha1').update(stableStringify(context)).digest('hex');
};

export const summarizeAiTrainDuplicateSignals = (
  rows: AiTrainDuplicateSignalRow[],
): AiTrainDuplicateSignalSummary => {
  const groups = new Map<
    string,
    {
      key: string;
      strategy: string;
      symbol: string;
      direction: string;
      timestamp: number;
      count: number;
      totalProfit: number;
    }
  >();

  for (const row of rows) {
    const strategy = normalizeKeyPart(row.strategyName, 'unknown');
    const symbol = normalizeKeyPart(row.symbol, 'unknown');
    const direction = normalizeKeyPart(row.direction, 'UNKNOWN');
    const timestamp = Number(row.timestamp);
    const profit = Number(row.profit);
    const key = [
      strategy,
      symbol,
      direction,
      Number.isFinite(timestamp) ? timestamp : 'no_timestamp',
      Number.isFinite(profit) ? profit : 'no_profit',
      hashContext(row),
    ].join('|');
    const group =
      groups.get(key) ??
      ({
        key,
        strategy,
        symbol,
        direction,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        count: 0,
        totalProfit: 0,
      } satisfies {
        key: string;
        strategy: string;
        symbol: string;
        direction: string;
        timestamp: number;
        count: number;
        totalProfit: number;
      });

    group.count += 1;
    group.totalProfit += Number.isFinite(profit) ? profit : 0;
    groups.set(key, group);
  }

  const duplicateGroups = [...groups.values()]
    .filter((group) => group.count > 1)
    .sort(
      (left, right) =>
        left.totalProfit - right.totalProfit ||
        right.count - left.count ||
        left.key.localeCompare(right.key),
    );

  return {
    groups: duplicateGroups.length,
    rows: duplicateGroups.reduce((total, group) => total + group.count, 0),
    maxGroupSize: duplicateGroups.reduce(
      (max, group) => Math.max(max, group.count),
      0,
    ),
    worstGroups: duplicateGroups.slice(0, 10),
  };
};
