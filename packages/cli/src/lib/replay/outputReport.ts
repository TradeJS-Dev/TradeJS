import fs from 'node:fs/promises';
import path from 'node:path';
import { toJson } from '@tradejs/core/data';
import {
  getReplayRuntimeUnmatchedCount,
  type ReplayParityEntryDetail,
  type ReplayRuntimeComparisonDetails,
  type ReplayRuntimeComparisonSummary,
  type ReplayStrategyResultsSnapshot,
} from './support';
import type { HistoricalSignalsReplayResult } from './historicalSignalsReplay';

type ReplayOutputWindow = {
  start: number;
  end: number;
};

type ReplayOutputReportParams = {
  projectRoot: string;
  timestamp: string;
  replayKey: string;
  userName: string;
  connectorName: string;
  interval: string;
  tickers: string[];
  window: ReplayOutputWindow;
  durationSeconds: number;
  replayResult: HistoricalSignalsReplayResult;
  strategySnapshot: ReplayStrategyResultsSnapshot;
  runtimeComparison: ReplayRuntimeComparisonSummary | null;
};

type ReplayOutputPaths = {
  markdownPath: string;
  jsonPath: string;
};

const formatMsk = (timestamp: number | null | undefined) =>
  typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(timestamp)
    : '';

const formatNumber = (value: unknown, digits = 6) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : '';

const formatMoney = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(2)}$`
    : '';

const formatPct = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(3)}%`
    : '';

const tableCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');

const createMarkdownTable = (headers: string[], rows: unknown[][]) => {
  const header = `| ${headers.map(tableCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
};

const entryStrategy = (entry: ReplayParityEntryDetail) =>
  entry.strategy ?? entry.inferredStrategy ?? '[unknown]';

const entryKey = (entry: ReplayParityEntryDetail) =>
  [
    entry.source,
    entryStrategy(entry),
    entry.symbol,
    entry.direction,
    entry.timestamp,
    entry.comparisonTimestamp ?? '',
    entry.orderId ?? '',
    entry.orderLinkId ?? '',
    entry.signalId ?? '',
  ].join('|');

const buildDrilldownMap = (
  items: NonNullable<
    ReplayRuntimeComparisonDetails['mismatchDrilldown']
  >['runtimeOnly'],
) => new Map(items.map((item) => [entryKey(item.entry), item]));

const buildPerTradeAnalysis = (
  runtimeComparison: ReplayRuntimeComparisonSummary | null,
) => {
  const details = runtimeComparison?.details;
  if (!details) {
    return {
      matched: [],
      orderFailed: [],
      runtimeOnly: [],
      backtestOnly: [],
    };
  }

  const runtimeOnlyDrilldown = buildDrilldownMap(
    details.mismatchDrilldown?.runtimeOnly ?? [],
  );
  const backtestOnlyDrilldown = buildDrilldownMap(
    details.mismatchDrilldown?.backtestOnly ?? [],
  );

  return {
    matched: details.matched.map((item) => ({
      status: 'matched',
      strategy: entryStrategy(item.backtest),
      symbol: item.backtest.symbol,
      direction: item.backtest.direction,
      runtime: item.runtime,
      backtest: item.backtest,
      comparison: {
        timestampDiffMs: item.timestampDiffMs,
        entryPriceDeltaPct: item.priceDeltaPct,
        exitTimestampDiffMs: item.exitTimestampDiffMs,
        exitPriceDeltaPct: item.exitPriceDeltaPct,
        exitType: item.exitType,
        pnl: item.pnl,
        slippage: item.slippage,
      },
    })),
    orderFailed: details.orderFailed.map((item) => ({
      status: 'orderFailed',
      strategy: entryStrategy(item.backtest),
      symbol: item.backtest.symbol,
      direction: item.backtest.direction,
      runtime: item.runtime,
      backtest: item.backtest,
      reason: item.reason,
      timestampDiffMs: item.timestampDiffMs,
      entryPriceDeltaPct: item.priceDeltaPct,
    })),
    runtimeOnly: details.runtimeOnly.map((entry) => ({
      status: 'runtimeOnly',
      strategy: entryStrategy(entry),
      symbol: entry.symbol,
      direction: entry.direction,
      runtime: entry,
      drilldown: runtimeOnlyDrilldown.get(entryKey(entry)) ?? null,
    })),
    backtestOnly: details.backtestOnly.map((entry) => ({
      status: 'backtestOnly',
      strategy: entryStrategy(entry),
      symbol: entry.symbol,
      direction: entry.direction,
      backtest: entry,
      drilldown: backtestOnlyDrilldown.get(entryKey(entry)) ?? null,
    })),
  };
};

const renderMatchedRows = (
  perTrade: ReturnType<typeof buildPerTradeAnalysis>['matched'],
) =>
  perTrade.length
    ? createMarkdownTable(
        [
          'Strategy',
          'Symbol',
          'Dir',
          'BT time',
          'RT time',
          'BT entry',
          'RT entry',
          'Entry delta',
          'BT exit',
          'RT exit',
          'Exit delta',
          'BT PnL',
          'RT PnL',
          'PnL delta',
          'Exit type',
        ],
        perTrade.map((item) => [
          item.strategy,
          item.symbol,
          item.direction,
          formatMsk(item.backtest.timestamp),
          formatMsk(item.runtime.timestamp),
          formatNumber(item.backtest.price),
          formatNumber(item.runtime.price),
          formatPct(item.comparison.entryPriceDeltaPct),
          formatNumber(item.backtest.exitPrice),
          formatNumber(item.runtime.exitPrice),
          formatPct(item.comparison.exitPriceDeltaPct),
          formatMoney(item.comparison.pnl.expectedPnl),
          formatMoney(item.comparison.pnl.realizedPnl),
          formatMoney(item.comparison.pnl.delta),
          `${item.comparison.exitType.expected ?? ''}/${item.comparison.exitType.actual ?? ''}`,
        ]),
      )
    : '_No matched trades._';

const renderRuntimeOnlyRows = (
  perTrade: ReturnType<typeof buildPerTradeAnalysis>['runtimeOnly'],
) =>
  perTrade.length
    ? createMarkdownTable(
        [
          'Strategy',
          'Symbol',
          'Dir',
          'RT time',
          'RT entry',
          'RT exit',
          'RT PnL',
          'Classification',
          'Reason',
          'Nearest',
        ],
        perTrade.map((item) => {
          const nearest = item.drilldown?.nearestCandidate?.nearest;
          return [
            item.strategy,
            item.symbol,
            item.direction,
            formatMsk(item.runtime.timestamp),
            formatNumber(item.runtime.price),
            formatNumber(item.runtime.exitPrice),
            formatMoney(item.runtime.pnl),
            item.drilldown?.classification ?? '',
            item.drilldown?.reason ?? '',
            nearest
              ? `${entryStrategy(nearest)} ${nearest.symbol} ${formatMsk(nearest.timestamp)}`
              : '',
          ];
        }),
      )
    : '_No runtime-only trades._';

const renderOrderFailedRows = (
  perTrade: ReturnType<typeof buildPerTradeAnalysis>['orderFailed'],
) =>
  perTrade.length
    ? createMarkdownTable(
        [
          'Strategy',
          'Symbol',
          'Dir',
          'BT time',
          'RT time',
          'Entry delta',
          'Reason',
        ],
        perTrade.map((item) => [
          item.strategy,
          item.symbol,
          item.direction,
          formatMsk(item.backtest.timestamp),
          formatMsk(item.runtime.timestamp),
          formatPct(item.entryPriceDeltaPct),
          item.reason,
        ]),
      )
    : '_No failed runtime orders._';

const renderBacktestOnlyRows = (
  perTrade: ReturnType<typeof buildPerTradeAnalysis>['backtestOnly'],
) =>
  perTrade.length
    ? createMarkdownTable(
        [
          'Strategy',
          'Symbol',
          'Dir',
          'BT time',
          'BT entry',
          'BT exit',
          'BT PnL',
          'Classification',
          'Reason',
          'Nearest',
        ],
        perTrade.map((item) => {
          const nearest = item.drilldown?.nearestCandidate?.nearest;
          return [
            item.strategy,
            item.symbol,
            item.direction,
            formatMsk(item.backtest.timestamp),
            formatNumber(item.backtest.price),
            formatNumber(item.backtest.exitPrice),
            formatMoney(item.backtest.pnl),
            item.drilldown?.classification ?? '',
            item.drilldown?.reason ?? '',
            nearest
              ? `${entryStrategy(nearest)} ${nearest.symbol} ${formatMsk(nearest.timestamp)}`
              : '',
          ];
        }),
      )
    : '_No backtest-only trades._';

const renderStrategyRows = (
  runtimeComparison: ReplayRuntimeComparisonSummary | null,
) =>
  runtimeComparison?.rows.length
    ? createMarkdownTable(
        [
          'Strategy',
          'BT entries',
          'BT PnL',
          'RT trades',
          'RT PnL',
          'Matched',
          'Order failed',
          'RT only',
          'BT only',
          'Unmatched',
        ],
        runtimeComparison.rows.map((row) => [
          row.strategyName,
          row.backtestEntries,
          formatMoney(row.backtestNetProfit),
          row.runtimeTrades,
          formatMoney(row.runtimePnl),
          row.matched,
          row.orderFailed,
          row.runtimeOnly,
          row.backtestOnly,
          getReplayRuntimeUnmatchedCount(row),
        ]),
      )
    : '_No runtime comparison rows._';

const renderLineageRows = (
  runtimeComparison: ReplayRuntimeComparisonSummary | null,
) => {
  const grouped = new Map<
    string,
    {
      strategy: string;
      scopes: number;
      deploymentCompositions: Set<string>;
      strategyRevisions: Set<string>;
      strategyPackages: Set<string>;
      dependencySets: Set<string>;
      runtimePackages: Set<string>;
    }
  >();
  for (const record of runtimeComparison?.lineage.replay ?? []) {
    const existing = grouped.get(record.strategy) ?? {
      strategy: record.strategy,
      scopes: 0,
      deploymentCompositions: new Set<string>(),
      strategyRevisions: new Set<string>(),
      strategyPackages: new Set<string>(),
      dependencySets: new Set<string>(),
      runtimePackages: new Set<string>(),
    };
    existing.scopes += 1;
    existing.deploymentCompositions.add(record.lineage.deploymentCompositionId);
    existing.strategyRevisions.add(record.lineage.strategyRevision);
    existing.strategyPackages.add(record.lineage.strategyPackageVersion);
    existing.dependencySets.add(
      Object.entries(record.lineage.strategyDependencyVersions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, version]) => `${name}@${version}`)
        .join(', '),
    );
    existing.runtimePackages.add(record.lineage.runtimePackageVersion);
    grouped.set(record.strategy, existing);
  }
  const formatSet = (values: Set<string>) => {
    const sorted = [...values].sort();
    return sorted.length <= 3
      ? sorted.join(', ')
      : `${sorted.slice(0, 3).join(', ')} … (+${sorted.length - 3})`;
  };

  return grouped.size
    ? createMarkdownTable(
        [
          'Strategy',
          'Scopes',
          'Deployment composition',
          'Strategy revision',
          'Strategy package',
          'Dependencies',
          'Runtime package',
        ],
        [...grouped.values()]
          .sort((left, right) => left.strategy.localeCompare(right.strategy))
          .map(
            ({
              strategy,
              scopes,
              deploymentCompositions,
              strategyRevisions,
              strategyPackages,
              dependencySets,
              runtimePackages,
            }) => [
              strategy,
              scopes,
              formatSet(deploymentCompositions),
              formatSet(strategyRevisions),
              formatSet(strategyPackages),
              formatSet(dependencySets),
              formatSet(runtimePackages),
            ],
          ),
      )
    : '_No replay lineage records._';
};

export const writeReplayOutputReport = async ({
  projectRoot,
  timestamp,
  replayKey,
  userName,
  connectorName,
  interval,
  tickers,
  window,
  durationSeconds,
  replayResult,
  strategySnapshot,
  runtimeComparison,
}: ReplayOutputReportParams): Promise<ReplayOutputPaths> => {
  const outputDir = path.resolve(projectRoot, 'data/replay/output');
  await fs.mkdir(outputDir, { recursive: true });

  const perTradeAnalysis = buildPerTradeAnalysis(runtimeComparison);
  const report = {
    reportType: 'replay-output',
    generatedAt: Date.now(),
    replayKey,
    userName,
    connectorName,
    interval,
    command: process.argv.join(' '),
    window: {
      startTime: window.start,
      endTime: window.end,
      startIso: new Date(window.start).toISOString(),
      endIso: new Date(window.end).toISOString(),
      startMsk: formatMsk(window.start),
      endMsk: formatMsk(window.end),
    },
    durationSeconds,
    counts: {
      tickers: tickers.length,
      strategies: replayResult.strategies.length,
      signals: replayResult.signals.length,
      cycleCount: replayResult.cycleCount,
      abortedCycles: replayResult.abortedCycles,
      matched: runtimeComparison?.matchedCount ?? 0,
      orderFailed: runtimeComparison?.orderFailedCount ?? 0,
      runtimeOnly: runtimeComparison?.runtimeOnlyCount ?? 0,
      backtestOnly: runtimeComparison?.backtestOnlyCount ?? 0,
    },
    resultsByStrategies: strategySnapshot.summaries,
    replayLineage: replayResult.runtimeLineages,
    runtimeComparison,
    perTradeAnalysis,
  };

  const markdownPath = path.join(outputDir, `${timestamp}-replay-report.md`);
  const jsonPath = path.join(outputDir, `${timestamp}-replay-report.json`);
  const lines = [
    '# Replay Report',
    '',
    '## Summary',
    '',
    createMarkdownTable(
      ['Metric', 'Value'],
      [
        ['Replay key', replayKey],
        ['User', userName],
        ['Connector', connectorName],
        ['Interval', interval],
        ['Tickers', tickers.length],
        ['Strategies', replayResult.strategies.length],
        ['Signals', replayResult.signals.length],
        ['Duration', `${durationSeconds.toFixed(2)}s`],
        ['Window', `${formatMsk(window.start)} - ${formatMsk(window.end)} MSK`],
        ['Runtime compare mode', runtimeComparison?.mode ?? 'none'],
        ['Matched', runtimeComparison?.matchedCount ?? 0],
        ['Order failed', runtimeComparison?.orderFailedCount ?? 0],
        ['Runtime-only', runtimeComparison?.runtimeOnlyCount ?? 0],
        ['Backtest-only', runtimeComparison?.backtestOnlyCount ?? 0],
        [
          'Comparable lineage scopes',
          runtimeComparison
            ? `${runtimeComparison.lineage.comparableScopes}/${runtimeComparison.lineage.replayScopes}`
            : '0/0',
        ],
        [
          'Lineage exclusions',
          runtimeComparison
            ? `runtime=${runtimeComparison.lineage.excludedRuntimeTrades}, exchange=${runtimeComparison.lineage.excludedExchangeEntries}, backtest=${runtimeComparison.lineage.excludedBacktestEntries}`
            : '',
        ],
        ['Command', `\`${process.argv.join(' ')}\``],
        ['JSON report', jsonPath],
      ],
    ),
    '',
    '## Replay Lineage',
    '',
    renderLineageRows(runtimeComparison),
    '',
    '## Strategy Comparison',
    '',
    renderStrategyRows(runtimeComparison),
    '',
    '## Matched Trades',
    '',
    renderMatchedRows(perTradeAnalysis.matched),
    '',
    '## Failed Runtime Orders',
    '',
    renderOrderFailedRows(perTradeAnalysis.orderFailed),
    '',
    '## Runtime-Only Trades',
    '',
    renderRuntimeOnlyRows(perTradeAnalysis.runtimeOnly),
    '',
    '## Backtest-Only Trades',
    '',
    renderBacktestOnlyRows(perTradeAnalysis.backtestOnly),
    '',
    '## Details',
    '',
    'Full machine-readable details are stored in the JSON sidecar.',
    '',
  ];

  await Promise.all([
    fs.writeFile(markdownPath, lines.join('\n'), 'utf8'),
    fs.writeFile(jsonPath, `${toJson(report, true)}\n`, 'utf8'),
  ]);

  return {
    markdownPath,
    jsonPath,
  };
};
