import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { AiDatasetRow, Direction, TestTradeResult } from '@tradejs/types';
import type {
  CoreResearchRegime,
  CoreResearchTrade,
  CoreResearchVariant,
} from './types';

type ResearchDatasetRow = AiDatasetRow & {
  research?: { setupIdentity?: string };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const finiteNumber = (value: unknown, field: string): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be finite`);
  return numeric;
};

const normalizeDirection = (value: unknown): Direction => {
  const direction = String(value ?? '').toUpperCase();
  if (direction !== 'LONG' && direction !== 'SHORT') {
    throw new Error(`Unsupported trade direction: ${direction || '<empty>'}`);
  }
  return direction;
};

const findStrategySetupIdentity = (
  value: unknown,
  depth = 0,
): string | null => {
  if (depth > 5) return null;
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['setupIdentity', 'setupId', 'patternId', 'candidateId']) {
    const candidate = record[key];
    if (
      (typeof candidate === 'string' && candidate.trim()) ||
      (typeof candidate === 'number' && Number.isFinite(candidate))
    ) {
      return `${key}:${String(candidate)}`;
    }
  }
  for (const [key, nested] of Object.entries(record)) {
    if (
      /context|signal|setup|pattern|candidate|strategy/i.test(key) &&
      nested != null
    ) {
      const found = findStrategySetupIdentity(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

const classifyBreadth = (baseContext: Record<string, unknown> | null) => {
  const relative = asRecord(baseContext?.relative);
  const btcAlt = asRecord(relative?.btcAltRegime);
  const gateFeatures = asRecord(baseContext?.gateFeatures);
  const gateRelative = asRecord(gateFeatures?.relative);
  const regime = String(btcAlt?.regime ?? gateRelative?.btcAltRegime ?? '');
  if (regime === 'risk_on' || regime === 'alt_lead') return 'risk_on' as const;
  if (regime === 'risk_off') return 'risk_off' as const;
  if (['mixed', 'neutral', 'btc_lead'].includes(regime))
    return 'mixed' as const;

  const breadth = asRecord(relative?.marketBreadth);
  const equalWeightedReturn = Number(
    breadth?.equalWeightedReturn ?? gateRelative?.marketBreadthReturn,
  );
  const aboveMa50 = Number(breadth?.pctAboveMa50);
  if (Number.isFinite(equalWeightedReturn) || Number.isFinite(aboveMa50)) {
    if (
      equalWeightedReturn > 0 &&
      (!Number.isFinite(aboveMa50) || aboveMa50 >= 50)
    ) {
      return 'risk_on' as const;
    }
    if (
      equalWeightedReturn < 0 &&
      (!Number.isFinite(aboveMa50) || aboveMa50 < 50)
    ) {
      return 'risk_off' as const;
    }
    return 'mixed' as const;
  }
  return 'unknown' as const;
};

const classifyDerivatives = (baseContext: Record<string, unknown> | null) => {
  const derivatives = asRecord(baseContext?.derivatives);
  const targetContext = asRecord(derivatives?.targetContext);
  const summary =
    asRecord(targetContext?.summary) ?? asRecord(derivatives?.summary);
  const pressure = String(summary?.pressure ?? '');
  if (pressure === 'crowded_long' || pressure === 'crowded_short') {
    return 'crowded' as const;
  }
  if (pressure === 'long_flush' || pressure === 'short_flush') {
    return 'supportive' as const;
  }
  if (pressure === 'neutral') return 'neutral' as const;
  return 'unknown' as const;
};

export const resolveCoreResearchRegime = (
  row: ResearchDatasetRow,
): CoreResearchRegime => {
  const additional = asRecord(row.payload?.additionalIndicators);
  const baseContext = asRecord(additional?.baseContext);
  const regime = asRecord(baseContext?.regime);
  const trendContext = asRecord(regime?.trend);
  const volatilityContext = asRecord(regime?.volatility);
  const trendValue = String(trendContext?.bias ?? 'unknown');
  const volatilityValue = String(volatilityContext?.state ?? 'unknown');
  const trend = ['bull', 'bear', 'neutral'].includes(trendValue)
    ? (trendValue as CoreResearchRegime['trend'])
    : 'unknown';
  const volatility = ['compressed', 'normal', 'expanded'].includes(
    volatilityValue,
  )
    ? (volatilityValue as CoreResearchRegime['volatility'])
    : 'unknown';
  const breadth = classifyBreadth(baseContext);
  const derivatives = classifyDerivatives(baseContext);
  return {
    trend,
    volatility,
    breadth,
    derivatives,
    key: [trend, volatility, breadth, derivatives].join('|'),
  };
};

const normalizeCompletedTrade = (params: {
  filePath: string;
  fileSha256: string;
  lineNumber: number;
  row: ResearchDatasetRow;
}): CoreResearchTrade | null => {
  const { filePath, fileSha256, lineNumber, row } = params;
  const result = row.tradeResult as TestTradeResult | undefined;
  if (!result) return null;
  const signalTimestamp = finiteNumber(row.timestamp, 'row.timestamp');
  const strategyIdentity = findStrategySetupIdentity(
    row.payload?.additionalIndicators,
  );
  const explicitIdentity = row.research?.setupIdentity?.trim() || null;
  const direction = normalizeDirection(row.direction ?? result.direction);
  const signalId = String(row.signalId ?? result.signalId ?? '').trim();
  if (!signalId) throw new Error('signalId must be non-empty');
  const setupIdentity = explicitIdentity
    ? explicitIdentity
    : strategyIdentity
      ? `${row.strategyName}|${row.symbol}|${direction}|${strategyIdentity}`
      : `${row.strategyName}|${row.symbol}|${direction}|${signalTimestamp}`;
  return {
    sourceFile: filePath,
    sourceLine: lineNumber,
    sourceSha256: fileSha256,
    runId: row.backtestRunId ?? null,
    configId: row.configId?.trim() || '<missing-config-id>',
    signalId,
    positionCycleId:
      typeof result.positionCycleId === 'string' &&
      result.positionCycleId.trim()
        ? result.positionCycleId.trim()
        : null,
    setupIdentity,
    setupIdentitySource: explicitIdentity
      ? 'research.setupIdentity'
      : strategyIdentity
        ? 'strategy-context'
        : 'signal-time-fallback',
    strategy: row.strategyName,
    symbol: row.symbol,
    direction,
    signalTimestamp,
    entryTimestamp: finiteNumber(result.entryTimestamp, 'entryTimestamp'),
    exitTimestamp: finiteNumber(result.exitTimestamp, 'exitTimestamp'),
    entryPrice: finiteNumber(result.entryPrice, 'entryPrice'),
    exitPrice:
      result.exitPrice == null
        ? null
        : finiteNumber(result.exitPrice, 'exitPrice'),
    qty: finiteNumber(result.qty, 'qty'),
    netProfit: finiteNumber(result.netProfit, 'netProfit'),
    grossProfit: finiteNumber(result.grossProfit, 'grossProfit'),
    totalFee: finiteNumber(result.totalFee, 'totalFee'),
    totalSlippageCost: finiteNumber(
      result.totalSlippageCost,
      'totalSlippageCost',
    ),
    exitReason: result.exitReason,
    regime: resolveCoreResearchRegime(row),
  };
};

const completedTradeIdentity = (trade: CoreResearchTrade) =>
  [trade.runId ?? '', trade.configId, trade.signalId, trade.symbol].join('|');

const positionCycleIdentity = (trade: CoreResearchTrade) =>
  trade.positionCycleId
    ? [
        trade.runId ?? '',
        trade.configId,
        trade.strategy,
        trade.symbol,
        trade.direction,
        trade.positionCycleId,
      ].join('|')
    : null;

const sumBy = (
  trades: CoreResearchTrade[],
  select: (trade: CoreResearchTrade) => number,
) => trades.reduce((sum, trade) => sum + select(trade), 0);

const weightedPrice = (
  trades: CoreResearchTrade[],
  select: (trade: CoreResearchTrade) => number | null,
) => {
  const withPrice = trades.filter((trade) => select(trade) != null);
  const qty = sumBy(withPrice, (trade) => trade.qty);
  if (qty <= 0) return null;
  return sumBy(withPrice, (trade) => Number(select(trade)) * trade.qty) / qty;
};

const aggregatePositionCycles = (trades: CoreResearchTrade[]) => {
  const standalone: CoreResearchTrade[] = [];
  const cycles = new Map<string, CoreResearchTrade[]>();
  for (const trade of trades) {
    const identity = positionCycleIdentity(trade);
    if (!identity) {
      standalone.push(trade);
      continue;
    }
    const cycle = cycles.get(identity) ?? [];
    cycle.push(trade);
    cycles.set(identity, cycle);
  }

  for (const [identity, cycle] of cycles) {
    const primaryRows = cycle.filter(
      (trade) => trade.signalId === trade.positionCycleId,
    );
    if (primaryRows.length !== 1) {
      throw new Error(
        `Position cycle ${identity} must contain exactly one opening row; found ${primaryRows.length}`,
      );
    }
    const primary = primaryRows[0];
    if (
      cycle.some(
        (trade) =>
          trade.exitTimestamp !== primary.exitTimestamp ||
          trade.exitReason !== primary.exitReason,
      )
    ) {
      throw new Error(
        `Position cycle ${identity} contains inconsistent final exits`,
      );
    }
    if (cycle.length === 1) {
      standalone.push(primary);
      continue;
    }
    standalone.push({
      ...primary,
      entryTimestamp: Math.min(...cycle.map((trade) => trade.entryTimestamp)),
      entryPrice: weightedPrice(cycle, (trade) => trade.entryPrice) ?? 0,
      exitPrice: weightedPrice(cycle, (trade) => trade.exitPrice),
      qty: sumBy(cycle, (trade) => trade.qty),
      netProfit: sumBy(cycle, (trade) => trade.netProfit),
      grossProfit: sumBy(cycle, (trade) => trade.grossProfit),
      totalFee: sumBy(cycle, (trade) => trade.totalFee),
      totalSlippageCost: sumBy(cycle, (trade) => trade.totalSlippageCost),
    });
  }
  return standalone;
};

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const compareTrades = (left: CoreResearchTrade, right: CoreResearchTrade) =>
  left.exitTimestamp - right.exitTimestamp ||
  compareText(left.symbol, right.symbol) ||
  compareText(left.direction, right.direction) ||
  compareText(left.signalId, right.signalId) ||
  compareText(left.sourceFile, right.sourceFile) ||
  left.sourceLine - right.sourceLine;

export const readCoreResearchVariant = async (variant: CoreResearchVariant) => {
  const trades: CoreResearchTrade[] = [];
  const sources = [];
  const seen = new Map<string, CoreResearchTrade>();
  let duplicateRowsDropped = 0;
  for (const inputPath of variant.files) {
    const filePath = path.resolve(inputPath);
    const input = createReadStream(filePath);
    const hash = createHash('sha256');
    input.on('data', (chunk) => hash.update(chunk));
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const fileTrades: CoreResearchTrade[] = [];
    let lineNumber = 0;
    let rows = 0;
    let rowsForDifferentRun = 0;
    let rowsWithoutTradeResult = 0;
    let selectedTrades = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      rows += 1;
      let row: ResearchDatasetRow;
      try {
        row = JSON.parse(line) as ResearchDatasetRow;
      } catch (error) {
        throw new Error(
          `${filePath}:${lineNumber} contains invalid JSON: ${String(error)}`,
        );
      }
      if (variant.runId && row.backtestRunId !== variant.runId) {
        rowsForDifferentRun += 1;
        continue;
      }
      const trade = normalizeCompletedTrade({
        filePath,
        fileSha256: '',
        lineNumber,
        row,
      });
      if (!trade) {
        rowsWithoutTradeResult += 1;
        continue;
      }
      selectedTrades += 1;
      const identity = completedTradeIdentity(trade);
      const existing = seen.get(identity);
      if (existing) {
        if (
          existing.netProfit !== trade.netProfit ||
          existing.exitTimestamp !== trade.exitTimestamp ||
          existing.direction !== trade.direction
        ) {
          throw new Error(
            `Conflicting completed trades share identity ${identity}`,
          );
        }
        duplicateRowsDropped += 1;
        continue;
      }
      seen.set(identity, trade);
      trades.push(trade);
      fileTrades.push(trade);
    }
    const fileSha256 = hash.digest('hex');
    for (const trade of fileTrades) trade.sourceSha256 = fileSha256;
    sources.push({
      path: filePath,
      sha256: fileSha256,
      rows,
      selectedTrades,
      rowsForDifferentRun,
      rowsWithoutTradeResult,
    });
  }
  return {
    variant,
    files: sources,
    duplicateRowsDropped,
    trades: aggregatePositionCycles(trades).sort(compareTrades),
  };
};
