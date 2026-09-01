import fs from 'node:fs/promises';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import { getData, getKeys, redisKeys } from '@tradejs/infra/redis';
import {
  buildRuntimeEvidenceReportPayload,
  collectRuntimeDebugEvidence,
} from '../lib/runtimeDebugEvidence';
import { REPLAY_RESULTS_CONFIG } from '../lib/replay/support';

args.option(['u', 'user'], 'Use user config', 'root');
args.option(
  ['S', 'startTime'],
  'Window start timestamp, seconds/ms, or ISO date',
);
args.option(['E', 'endTime'], 'Window end timestamp, seconds/ms, or ISO date');
args.option(
  ['H', 'hours'],
  'Fallback window in hours when start/end are omitted',
  24,
);
args.option(['s', 'strategy'], 'Strategy filter, comma-separated');
args.option('replayKey', 'Exact replay result Redis key');
args.option(
  'runtimeEvidence',
  'Runtime evidence JSON collected on the runtime server',
);
args.option(
  ['o', 'out'],
  'Output JSON path',
  'output/replay-runtime-evidence.json',
);

type JsonRecord = Record<string, any>;

const toEpochMs = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return parsed < 1e12 ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveWindow = (flags: JsonRecord) => {
  const endTime = toEpochMs(flags.endTime) ?? Date.now();
  const hours = Math.max(
    1,
    Number.parseInt(String(flags.hours ?? 24), 10) || 24,
  );
  const startTime =
    toEpochMs(flags.startTime) ?? endTime - hours * 60 * 60 * 1000;

  if (startTime >= endTime) {
    throw new Error(
      `Invalid window: startTime (${startTime}) must be less than endTime (${endTime})`,
    );
  }

  return {
    startTime,
    endTime,
    source:
      flags.startTime != null || flags.endTime != null ? 'explicit' : 'hours',
  };
};

const parseStrategyFilter = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? (value.filter(Boolean) as JsonRecord[]) : [];

const sum = (items: JsonRecord[], getter: (item: JsonRecord) => unknown) =>
  Number(
    items
      .reduce((total, item) => {
        const value = getter(item);
        return (
          total +
          (typeof value === 'number' && Number.isFinite(value) ? value : 0)
        );
      }, 0)
      .toFixed(12),
  );

const groupCount = (
  items: JsonRecord[],
  getter: (item: JsonRecord) => unknown,
) => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const raw = getter(item);
    const key = typeof raw === 'string' && raw.trim() ? raw : '[unknown]';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const compactMatched = (item: JsonRecord) => {
  const runtime = asRecord(item.runtime);
  const backtest = asRecord(item.backtest);
  const pnl = asRecord(item.pnl);
  const slippage = asRecord(item.slippage);

  return {
    strategy: backtest.strategy ?? runtime.inferredStrategy ?? null,
    runtimeInferredStrategy: runtime.inferredStrategy ?? null,
    symbol: backtest.symbol ?? runtime.symbol ?? null,
    direction: backtest.direction ?? runtime.direction ?? null,
    timestamp: backtest.timestamp ?? null,
    comparisonTimestamp: backtest.comparisonTimestamp ?? null,
    runtimeTimestamp: runtime.timestamp ?? null,
    timestampDiffMs: item.timestampDiffMs ?? null,
    backtestPrice: backtest.price ?? null,
    runtimePrice: runtime.price ?? null,
    backtestExitPrice: backtest.exitPrice ?? null,
    runtimeExitPrice: runtime.exitPrice ?? null,
    expectedPnl: pnl.expectedPnl ?? null,
    realizedPnl: pnl.realizedPnl ?? null,
    pnlDelta: pnl.delta ?? null,
    entrySlippageCost: slippage.entryCost ?? null,
    exitSlippageCost: slippage.exitCost ?? null,
    totalSlippageCost: slippage.totalCost ?? null,
    orderId: runtime.orderId ?? backtest.orderId ?? null,
    orderLinkId: runtime.orderLinkId ?? null,
    signalId: backtest.signalId ?? null,
  };
};

const resolveItemStrategy = (item: JsonRecord) =>
  asRecord(item.backtest).strategy ??
  asRecord(item.runtime).inferredStrategy ??
  item.strategy ??
  item.inferredStrategy ??
  null;

export const summarizeReplayComparison = (
  runtimeComparison: unknown,
  strategies: string[],
) => {
  const comparison = asRecord(runtimeComparison);
  const details = asRecord(comparison.details);
  const strategySet = new Set(strategies);
  const useFilter = strategySet.size > 0;
  const hasStrategy = (item: JsonRecord) => {
    const strategy = resolveItemStrategy(item);
    return (
      !useFilter || (typeof strategy === 'string' && strategySet.has(strategy))
    );
  };
  const matched = asArray(details.matched).filter(hasStrategy);
  const backtestOnly = asArray(details.backtestOnly).filter(hasStrategy);
  const runtimeOnly = asArray(details.runtimeOnly).filter(hasStrategy);
  const drilldown = asRecord(details.mismatchDrilldown);
  const drilldownBacktestOnly = asArray(drilldown.backtestOnly).filter((item) =>
    hasStrategy(asRecord(item.entry)),
  );
  const drilldownRuntimeOnly = asArray(drilldown.runtimeOnly).filter((item) =>
    hasStrategy(asRecord(item.entry)),
  );
  const strategyNames = useFilter
    ? strategies
    : [
        ...new Set(
          [...matched, ...backtestOnly, ...runtimeOnly]
            .map(resolveItemStrategy)
            .filter((value): value is string => typeof value === 'string'),
        ),
      ].sort((left, right) => left.localeCompare(right));
  const comparisonLineage = asRecord(comparison.lineage);
  const replayLineage = asArray(comparisonLineage.replay).filter(
    (entry) =>
      !useFilter || strategySet.has(String(asRecord(entry).strategy ?? '')),
  );
  const hasExcludedBacktestEntryDetails = Array.isArray(
    comparisonLineage.excludedBacktestEntryDetails,
  );
  const excludedBacktestEntryDetails = asArray(
    comparisonLineage.excludedBacktestEntryDetails,
  ).filter(
    (entry) =>
      !useFilter || strategySet.has(String(asRecord(entry).strategy ?? '')),
  );

  return {
    mode: comparison.mode ?? null,
    lineage: comparisonLineage
      ? {
          ...comparisonLineage,
          replay: replayLineage,
          ...(hasExcludedBacktestEntryDetails
            ? { excludedBacktestEntryDetails }
            : {}),
        }
      : null,
    rows: asArray(comparison.rows).filter(
      (row) => !useFilter || strategySet.has(String(row.strategyName ?? '')),
    ),
    counts: {
      matched: matched.length,
      backtestOnly: backtestOnly.length,
      runtimeOnly: runtimeOnly.length,
    },
    pnl: {
      matchedExpected: sum(matched, (item) => asRecord(item.pnl).expectedPnl),
      matchedRealized: sum(matched, (item) => asRecord(item.pnl).realizedPnl),
      matchedDelta: sum(matched, (item) => asRecord(item.pnl).delta),
      backtestOnlyExpected: sum(backtestOnly, (item) => item.pnl),
      runtimeOnlyRealized: sum(runtimeOnly, (item) => item.pnl),
    },
    byStrategy: Object.fromEntries(
      strategyNames.map((strategy) => {
        const strategyMatched = matched.filter(
          (item) => resolveItemStrategy(item) === strategy,
        );
        const strategyBacktestOnly = backtestOnly.filter(
          (item) => resolveItemStrategy(item) === strategy,
        );
        const strategyRuntimeOnly = runtimeOnly.filter(
          (item) => resolveItemStrategy(item) === strategy,
        );

        return [
          strategy,
          {
            matched: strategyMatched.length,
            backtestOnly: strategyBacktestOnly.length,
            runtimeOnly: strategyRuntimeOnly.length,
            matchedRuntimeInferredStrategy: groupCount(
              strategyMatched,
              (item) => asRecord(item.runtime).inferredStrategy,
            ),
            matchedExpectedPnl: sum(
              strategyMatched,
              (item) => asRecord(item.pnl).expectedPnl,
            ),
            matchedRealizedPnl: sum(
              strategyMatched,
              (item) => asRecord(item.pnl).realizedPnl,
            ),
            backtestOnlyExpectedPnl: sum(
              strategyBacktestOnly,
              (item) => item.pnl,
            ),
            runtimeOnlyRealizedPnl: sum(
              strategyRuntimeOnly,
              (item) => item.pnl,
            ),
          },
        ];
      }),
    ),
    matched: matched.map(compactMatched),
    backtestOnly,
    runtimeOnly,
    mismatchDrilldown: {
      summary: drilldown.summary ?? null,
      backtestOnly: drilldownBacktestOnly,
      runtimeOnly: drilldownRuntimeOnly,
    },
  };
};

const loadReplayResult = async ({
  userName,
  replayKey,
}: {
  userName: string;
  replayKey?: string;
}) => {
  if (replayKey) {
    return {
      key: replayKey,
      availableKeys: undefined,
      value: await getData(replayKey, null),
    };
  }

  const prefix = redisKeys.backtestResults(userName, REPLAY_RESULTS_CONFIG, '');
  const keys = (await getKeys(prefix)).sort((left, right) =>
    left.localeCompare(right),
  );
  const key = keys[keys.length - 1] ?? null;

  return {
    key,
    availableKeys: keys.slice(-10),
    value: key ? await getData(key, null) : null,
  };
};

const getReplayStrategies = (replayValue: unknown): string[] => {
  const replay = asRecord(replayValue);
  const rows = [
    ...asArray(replay.resultsByStrategies).map((row) => row.strategyName),
    ...asArray(asRecord(replay.runtimeComparison).rows).map(
      (row) => row.strategyName,
    ),
  ];

  return [
    ...new Set(
      rows.filter((value): value is string => typeof value === 'string'),
    ),
  ].sort((left, right) => left.localeCompare(right));
};

const loadRuntimePayload = async ({
  startTime,
  endTime,
  strategies,
  userName,
  runtimeEvidenceFile,
  projectRoot,
}: {
  startTime: number;
  endTime: number;
  strategies: string[];
  userName: string;
  runtimeEvidenceFile: unknown;
  projectRoot: string;
}) => {
  const runtimeEvidencePath =
    typeof runtimeEvidenceFile === 'string' && runtimeEvidenceFile.trim()
      ? path.resolve(projectRoot, runtimeEvidenceFile.trim())
      : null;

  if (runtimeEvidencePath) {
    const artifact = JSON.parse(
      await fs.readFile(runtimeEvidencePath, 'utf8'),
    ) as JsonRecord;

    return {
      source: 'file',
      path: runtimeEvidencePath,
      payload: artifact.runtime ?? artifact,
      deployment: artifact.deployment ?? null,
    };
  }

  const runtimeEvidence = await collectRuntimeDebugEvidence({
    userName,
    startTime,
    endTime,
    strategies: strategies.length ? strategies : undefined,
  });

  return {
    source: 'local-redis',
    path: null,
    deployment: null,
    payload: buildRuntimeEvidenceReportPayload({
      userName,
      startTime,
      endTime,
      signals: runtimeEvidence.signals,
      evaluations: runtimeEvidence.evaluations,
      trades: runtimeEvidence.trades,
      lineageScopes: runtimeEvidence.lineageScopes,
    }),
  };
};

export const replayRuntimeEvidence = async () => {
  const flags = args.parse(process.argv) as JsonRecord;
  const projectRoot =
    String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
  const userName = String(flags.user ?? 'root');
  const { startTime, endTime, source } = resolveWindow(flags);
  const replay = await loadReplayResult({
    userName,
    replayKey:
      typeof flags.replayKey === 'string' && flags.replayKey.trim()
        ? flags.replayKey.trim()
        : undefined,
  });
  const explicitStrategies = parseStrategyFilter(flags.strategy);
  const strategies = explicitStrategies.length
    ? explicitStrategies
    : getReplayStrategies(replay.value);
  const runtime = await loadRuntimePayload({
    startTime,
    endTime,
    strategies,
    userName,
    runtimeEvidenceFile: flags.runtimeEvidence,
    projectRoot,
  });
  const replayValue = asRecord(replay.value);
  const artifact = {
    reportType: 'replay-runtime-evidence',
    generatedAt: Date.now(),
    userName,
    window: {
      startTime,
      endTime,
      startIso: new Date(startTime).toISOString(),
      endIso: new Date(endTime).toISOString(),
      source,
    },
    strategies,
    runtimeSource: {
      type: runtime.source,
      path: runtime.path,
    },
    deployment: runtime.deployment,
    replay: {
      key: replay.key,
      availableKeys: replay.availableKeys,
      startedAt: replayValue.startedAt ?? null,
      finishedAt: replayValue.finishedAt ?? null,
      durationSeconds: replayValue.durationSeconds ?? null,
      cycleCount: replayValue.cycleCount ?? null,
      abortedCycles: replayValue.abortedCycles ?? null,
      signalsCount: replayValue.signalsCount ?? null,
      resultsByStrategies: asArray(replayValue.resultsByStrategies).filter(
        (row) =>
          !strategies.length ||
          strategies.includes(String(row.strategyName ?? '')),
      ),
      runtimeComparison: summarizeReplayComparison(
        replayValue.runtimeComparison,
        strategies,
      ),
    },
    runtime: runtime.payload,
  };
  const outPath = path.resolve(projectRoot, String(flags.out));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(chalk.green(`Wrote ${outPath}`));
  console.log(
    JSON.stringify(
      {
        replayKey: artifact.replay.key,
        strategies: artifact.strategies,
        replayRows: artifact.replay.runtimeComparison.rows,
        replayPnl: artifact.replay.runtimeComparison.pnl,
        runtimeSource: artifact.runtimeSource,
        runtimeCounts: asRecord(artifact.runtime).counts ?? null,
      },
      null,
      2,
    ),
  );
};

export const main = replayRuntimeEvidence;
