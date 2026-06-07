import type {
  Direction,
  MarketFeatureInterval,
  OnchainContext,
  OnchainContextRiskFlag,
  OnchainFlowRow,
  OnchainIntervalContext,
  OnchainPressure,
} from '@tradejs/types';

const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_STALE_AFTER_MS: Record<MarketFeatureInterval, number> = {
  '1m': 10 * 60 * 1000,
  '5m': 30 * 60 * 1000,
  '15m': 60 * 60 * 1000,
  '1h': 4 * HOUR_MS,
};

type NormalizedOnchainRow = {
  tsMs: number;
  whaleNetFlowUsd: number | null;
  smartTraderNetFlowUsd: number | null;
  cexDepositUsd: number | null;
  cexWithdrawUsd: number | null;
  dexBuyUsd: number | null;
  dexSellUsd: number | null;
  entityCount: number | null;
  confidenceWeightedBias: number | null;
};

export const normalizeOnchainIntervals = (
  value: unknown,
): MarketFeatureInterval[] => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map((item) => item.trim());
  const allowed = new Set<MarketFeatureInterval>(['1m', '5m', '15m', '1h']);
  const intervals: MarketFeatureInterval[] = [];
  for (const item of raw) {
    const normalized = String(item || '').trim() as MarketFeatureInterval;
    if (allowed.has(normalized) && !intervals.includes(normalized)) {
      intervals.push(normalized);
    }
  }
  return intervals;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  const num = toFiniteNumberOrNull(value);
  if (num == null) return null;
  return num > 10_000_000_000 ? Math.floor(num) : Math.floor(num * 1000);
};

const roundNullable = (value: number | null, digits = 4): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};

const normalizeRows = (
  rows: OnchainFlowRow[] | undefined,
  timestamp: number,
): NormalizedOnchainRow[] => {
  const normalized: NormalizedOnchainRow[] = [];

  for (const row of rows ?? []) {
    const tsMs = toTimestampMs(row.ts);
    if (tsMs == null || tsMs > timestamp) continue;

    normalized.push({
      tsMs,
      whaleNetFlowUsd: toFiniteNumberOrNull(row.whaleNetFlowUsd),
      smartTraderNetFlowUsd: toFiniteNumberOrNull(row.smartTraderNetFlowUsd),
      cexDepositUsd: toFiniteNumberOrNull(row.cexDepositUsd),
      cexWithdrawUsd: toFiniteNumberOrNull(row.cexWithdrawUsd),
      dexBuyUsd: toFiniteNumberOrNull(row.dexBuyUsd),
      dexSellUsd: toFiniteNumberOrNull(row.dexSellUsd),
      entityCount: toFiniteNumberOrNull(row.entityCount),
      confidenceWeightedBias: toFiniteNumberOrNull(row.confidenceWeightedBias),
    });
  }

  normalized.sort((a, b) => a.tsMs - b.tsMs);
  return normalized;
};

const sumWindow = (
  rows: NormalizedOnchainRow[],
  latestTs: number,
  windowMs: number,
  readValue: (row: NormalizedOnchainRow) => number | null,
) => {
  let sum = 0;
  let count = 0;
  const fromTs = latestTs - windowMs;
  for (const row of rows) {
    if (row.tsMs < fromTs || row.tsMs > latestTs) continue;
    const value = readValue(row);
    if (value == null || !Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return count > 0 ? sum : null;
};

const averageBefore = (
  rows: NormalizedOnchainRow[],
  endIndex: number,
  readValue: (row: NormalizedOnchainRow) => number | null,
) => {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < endIndex; index += 1) {
    const value = readValue(rows[index]);
    if (value == null || !Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return count > 0 ? sum / count : null;
};

const getRowNetFlowUsd = (row: NormalizedOnchainRow) =>
  (row.whaleNetFlowUsd ?? 0) +
  (row.smartTraderNetFlowUsd ?? 0) +
  ((row.cexWithdrawUsd ?? 0) - (row.cexDepositUsd ?? 0)) +
  ((row.dexBuyUsd ?? 0) - (row.dexSellUsd ?? 0));

const toSpikeRatio = (current: number | null, average: number | null) =>
  current != null && average != null && average > 0 ? current / average : null;

const buildIntervalContext = (params: {
  interval: MarketFeatureInterval;
  rows: NormalizedOnchainRow[];
  timestamp: number;
}): OnchainIntervalContext | null => {
  const { interval, rows, timestamp } = params;
  let latestIndex = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].tsMs <= timestamp) {
      latestIndex = index;
      break;
    }
  }
  const latest = latestIndex >= 0 ? rows[latestIndex] : null;
  if (!latest) return null;

  const cexNetFlowUsd =
    latest.cexWithdrawUsd != null || latest.cexDepositUsd != null
      ? (latest.cexWithdrawUsd ?? 0) - (latest.cexDepositUsd ?? 0)
      : null;
  const dexNetBuyUsd =
    latest.dexBuyUsd != null || latest.dexSellUsd != null
      ? (latest.dexBuyUsd ?? 0) - (latest.dexSellUsd ?? 0)
      : null;
  const netFlowUsd1h = sumWindow(rows, latest.tsMs, HOUR_MS, getRowNetFlowUsd);
  const netFlowUsd4h = sumWindow(
    rows,
    latest.tsMs,
    4 * HOUR_MS,
    getRowNetFlowUsd,
  );
  const avgCexDeposit = averageBefore(
    rows,
    latestIndex,
    (row) => row.cexDepositUsd,
  );
  const avgCexWithdrawal = averageBefore(
    rows,
    latestIndex,
    (row) => row.cexWithdrawUsd,
  );

  return {
    interval,
    asOfTs: latest.tsMs,
    stale: timestamp - latest.tsMs > DEFAULT_STALE_AFTER_MS[interval],
    points: latestIndex + 1,
    whaleNetFlowUsd: roundNullable(latest.whaleNetFlowUsd, 2),
    smartTraderNetFlowUsd: roundNullable(latest.smartTraderNetFlowUsd, 2),
    cexDepositUsd: roundNullable(latest.cexDepositUsd, 2),
    cexWithdrawUsd: roundNullable(latest.cexWithdrawUsd, 2),
    cexNetFlowUsd: roundNullable(cexNetFlowUsd, 2),
    dexBuyUsd: roundNullable(latest.dexBuyUsd, 2),
    dexSellUsd: roundNullable(latest.dexSellUsd, 2),
    dexNetBuyUsd: roundNullable(dexNetBuyUsd, 2),
    entityCount: roundNullable(latest.entityCount, 0),
    confidenceWeightedBias: roundNullable(latest.confidenceWeightedBias, 4),
    netFlowUsd1h: roundNullable(netFlowUsd1h, 2),
    netFlowUsd4h: roundNullable(netFlowUsd4h, 2),
    cexDepositSpikeRatio: roundNullable(
      toSpikeRatio(latest.cexDepositUsd, avgCexDeposit),
      4,
    ),
    cexWithdrawalSpikeRatio: roundNullable(
      toSpikeRatio(latest.cexWithdrawUsd, avgCexWithdrawal),
      4,
    ),
  };
};

const getPrimaryContext = (
  intervals: Partial<Record<MarketFeatureInterval, OnchainIntervalContext>>,
) => intervals['15m'] ?? intervals['1h'] ?? intervals['5m'] ?? null;

const detectPressure = (
  context: OnchainIntervalContext | null,
): OnchainPressure => {
  if (!context || context.stale) return 'unknown';
  const flow = context.netFlowUsd1h ?? context.netFlowUsd4h;
  const bias = context.confidenceWeightedBias;
  if ((flow != null && flow > 0) || (bias != null && bias >= 0.2)) {
    return 'accumulation';
  }
  if ((flow != null && flow < 0) || (bias != null && bias <= -0.2)) {
    return 'distribution';
  }
  return 'neutral';
};

const isDirectionAligned = (
  pressure: OnchainPressure,
  direction: Direction,
) => {
  if (pressure === 'accumulation') return direction === 'LONG';
  if (pressure === 'distribution') return direction === 'SHORT';
  return null;
};

const buildRiskFlags = (
  context: OnchainIntervalContext | null,
): OnchainContextRiskFlag[] => {
  if (!context) return ['missing_onchain'];
  const flags = new Set<OnchainContextRiskFlag>();
  if (context.stale) flags.add('stale_onchain');
  if ((context.whaleNetFlowUsd ?? 0) > 0) flags.add('whale_accumulation');
  if ((context.whaleNetFlowUsd ?? 0) < 0) flags.add('whale_distribution');
  if ((context.smartTraderNetFlowUsd ?? 0) > 0) {
    flags.add('smart_money_accumulation');
  }
  if ((context.smartTraderNetFlowUsd ?? 0) < 0) {
    flags.add('smart_money_distribution');
  }
  if ((context.cexDepositSpikeRatio ?? 0) >= 2) {
    flags.add('cex_deposit_spike');
  }
  if ((context.cexWithdrawalSpikeRatio ?? 0) >= 2) {
    flags.add('cex_withdrawal_spike');
  }
  if (
    context.confidenceWeightedBias != null &&
    Math.abs(context.confidenceWeightedBias) < 0.1
  ) {
    flags.add('low_confidence');
  }
  return [...flags];
};

export const buildOnchainContext = (params: {
  symbol: string;
  direction: Direction;
  timestamp: number;
  rowsByInterval: Partial<Record<MarketFeatureInterval, OnchainFlowRow[]>>;
  intervals?: MarketFeatureInterval[];
}): OnchainContext => {
  const intervals = params.intervals?.length
    ? params.intervals
    : (['15m', '1h'] as MarketFeatureInterval[]);
  const intervalContexts: Partial<
    Record<MarketFeatureInterval, OnchainIntervalContext>
  > = {};

  for (const interval of intervals) {
    const rows = normalizeRows(
      params.rowsByInterval[interval],
      params.timestamp,
    );
    const context = buildIntervalContext({
      interval,
      rows,
      timestamp: params.timestamp,
    });
    if (context) {
      intervalContexts[interval] = context;
    }
  }

  const primaryContext = getPrimaryContext(intervalContexts);
  const pressure = detectPressure(primaryContext);
  const riskFlags = buildRiskFlags(primaryContext);

  return {
    source: 'arkham',
    symbol: params.symbol,
    timestamp: params.timestamp,
    intervals: intervalContexts,
    summary: {
      pressure,
      directionAligned: isDirectionAligned(pressure, params.direction),
      riskFlags,
      confidenceWeightedBias: primaryContext?.confidenceWeightedBias ?? null,
      netFlowUsd:
        primaryContext?.netFlowUsd1h ?? primaryContext?.netFlowUsd4h ?? null,
    },
  };
};
