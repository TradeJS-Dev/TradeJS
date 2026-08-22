import type { RuntimeDuplicateGroup } from '../../runtimeParity';
import type { RuntimeSignalEvaluationRecord, Signal } from '@tradejs/types';
import type {
  BacktestOnlyClassification,
  ClassifiedBacktestOnlyEntry,
  ClassifiedRuntimeOnlyEntry,
  RuntimeOnlyClassification,
} from '../classification';
import type { ReplayError } from '../targets';
import {
  buildRuntimeParityMessage,
  buildRuntimeParityMismatchAttachment,
  buildRuntimeParityNoTargetsMessage,
  buildRuntimeParityTerminalReport,
  printClassifiedBacktestOnlyDetails,
  printClassifiedRuntimeOnlyDetails,
  printRuntimeDuplicateDetails,
  writeRuntimeParityTerminalReport,
  type RuntimeParityReportContext,
  type RuntimeParityTerminalReportContext,
} from '../reporting';

const START = 1_700_000_000_000;
const END = 1_700_086_400_000;

const classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[] = [
  {
    entry: {
      id: 'rt-1',
      source: 'runtime',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timestamp: START,
      price: 100,
      orderId: 'ord-1',
      signalId: 'sig-rt',
    },
    classification: 'not_evaluated',
    reason: 'no replay evaluation',
  },
];

const classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[] = [
  {
    entry: {
      id: 'bt-1',
      source: 'backtest',
      strategy: 'Grid',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      timestamp: START + 60_000,
      price: null,
    },
    classification: 'true_mismatch',
    reason: 'no <runtime> entry',
  },
];

const strategyRows: RuntimeParityReportContext['strategyRows'] = [
  [
    'Grid',
    {
      targets: 1,
      compared: 0,
      errors: 1,
      runtime: 0,
      runtimeDuplicates: 0,
      backtest: 1,
      matched: 0,
      runtimeOnly: 0,
      backtestOnly: 1,
    },
  ],
  [
    'TrendLine',
    {
      targets: 1,
      compared: 1,
      errors: 0,
      runtime: 1,
      runtimeDuplicates: 1,
      backtest: 1,
      matched: 1,
      runtimeOnly: 1,
      backtestOnly: 0,
    },
  ],
];

const reportContext: RuntimeParityReportContext = {
  window: { start: START, end: END, source: 'explicit' },
  connectorName: 'bybit<prod>',
  replayEnv: 'PARITY',
  toleranceBars: 1,
  toleranceMs: 900_000,
  replayTargetsCount: 2,
  comparedTargetsCount: 1,
  replayErrors: [
    {
      strategy: 'Grid',
      symbol: 'ETHUSDT',
      sources: ['strategyResults'],
      message: 'boom <fail>',
    },
  ],
  sourceCounts: {
    runtime: 1,
    strategyResults: 1,
    explicitTickers: 0,
    connectorUniverse: 0,
  },
  rawRuntimeEntriesCount: 2,
  runtimeEntriesCount: 1,
  runtimeDuplicateEntriesCount: 1,
  backtestEntriesCount: 2,
  matchedCount: 1,
  runtimeOnlyCount: 1,
  backtestOnlyCount: 1,
  matchedSummary: {
    avgPriceDeltaPct: 0.25,
    maxPriceDeltaPct: 0.5,
    avgTimestampDiffMs: 60_000,
    maxTimestampDiffMs: 120_000,
  },
  classifiedRuntimeOnly,
  classifiedBacktestOnly,
  runtimeSignalEvaluationsCount: 0,
  strategyRows,
};

describe('runtime parity reporting characterization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves the exact terminal report', () => {
    const context: RuntimeParityTerminalReportContext = {
      ...reportContext,
      window: { ...reportContext.window, source: 'explicit' },
      runtimeGatesEnabled: true,
      runtimeGatesRequested: false,
      runtimeDuplicateGroupsCount: 1,
      runtimeGateWarningCounts: new Map([['TrendLine', 1]]),
      detailLimit: 10,
    };

    expect(buildRuntimeParityTerminalReport(context)).toEqual([
      'TradeJS runtime parity',
      'Window: 15 Nov 2023 01:13:20 -> 16 Nov 2023 01:13:20 (explicit)',
      'Connector: bybit<prod>',
      'Replay env: PARITY (runtime AI/ML gates enabled)',
      'Tolerance: 1 bar(s) / 15m',
      'Summary: targets=2, compared=1, errors=1, runtime=1, backtest=2, runtimeOnly=1, backtestOnly=1, evaluations=0',
      'Sources: runtime trades=1, strategy results=1',
      'Runtime entries: 2 (deduped 1, dup 1)',
      'Matched deltas: price avg/max=0.25% / 0.50%, time avg/max=1.00m / 2.00m',
      'Runtime duplicate groups: 1, duplicate entries: 1',
      'Runtime only classifications: not_evaluated=1',
      'Backtest only classifications: true_mismatch=1',
      '',
      'Signal mismatches',
      '- runtimeOnly [not_evaluated] signalId=sig-rt orderId=ord-1 TrendLine BTCUSDT LONG 15 Nov 2023 01:13:20 reason=no replay evaluation',
      '- backtestOnly [true_mismatch] signalId=bt-1 Grid ETHUSDT SHORT 15 Nov 2023 01:14:20 reason=no <runtime> entry',
      '',
      'Strategy issues',
      '- Grid: backtestOnly=1, errors=1',
      '- TrendLine: runtimeOnly=1, runtimeDuplicates=1',
      '',
      'Warnings',
      '- TrendLine uses AI/ML runtime gates on 1 replay target(s); BACKTEST replay covers core execution, not live gating.',
      '',
      'Replay errors',
      '- Grid ETHUSDT: boom <fail>',
    ]);
  });

  it('preserves the exact Telegram report', () => {
    expect(
      buildRuntimeParityMessage({
        ...reportContext,
        runtimeGatesEnabled: false,
        runtimeGateWarningCounts: new Map([['TrendLine', 1]]),
      }),
    ).toBe(
      [
        '🧪 <b>TradeJS runtime parity</b>',
        '',
        '🕒 <b>Window</b>',
        '<b>15.11.2023, 01:13 - 16.11.2023, 01:13 MSK</b>',
        '',
        '🔌 Connector: <b>bybit&lt;prod&gt;</b>',
        '🧬 Replay env: <b>PARITY</b>',
        '🎯 Tolerance: <b>1 bar(s) / 15m</b>',
        '',
        '📌 <b>Overview</b>',
        '• Targets: <b>2</b> / compared <b>1</b> / errors <b>1</b>',
        '• Sources: <b>runtime trades=1, strategy results=1</b>',
        '',
        '📈 <b>Entries</b>',
        '• Runtime: <b>2 (deduped 1, dup 1)</b>',
        '• Backtest: <b>2</b>',
        '• Runtime only: <b>1</b> / Backtest only: <b>1</b>',
        '• Matched deltas: price avg/max=<b>0.25% / 0.50%</b>, time avg/max=<b>1.00m / 2.00m</b>',
        '• Runtime-only classes: <code>not_evaluated=1</code>',
        '• Backtest-only classes: <code>true_mismatch=1</code>',
        '',
        '🔎 <b>Mismatches</b>',
        '• <code>runtimeOnly [not_evaluated] signalId=sig-rt orderId=ord-1 TrendLine BTCUSDT LONG 15 Nov 2023 01:13:20 reason=no replay evaluation</code>',
        '• <code>backtestOnly [true_mismatch] signalId=bt-1 Grid ETHUSDT SHORT 15 Nov 2023 01:14:20 reason=no &lt;runtime&gt; entry</code>',
        '',
        '📊 <b>Strategy issues</b>',
        '• Grid: backtestOnly=1, errors=1',
        '• TrendLine: runtimeOnly=1, runtimeDuplicates=1',
        '',
        '⚠️ <b>Warnings</b>',
        '• <b>TrendLine</b>: AI/ML runtime gates configured on <b>1</b> target(s); BACKTEST replay covers core execution only.',
        '',
        '❌ <b>Replay errors</b>',
        '• <b>Grid</b> ETHUSDT: <code>boom &lt;fail&gt;</code>',
      ].join('\n'),
    );
  });

  it('preserves the exact JSON attachment', () => {
    jest.spyOn(Date, 'now').mockReturnValue(END + 1);

    const attachment = buildRuntimeParityMismatchAttachment(reportContext);
    expect(attachment).not.toBeNull();
    expect(attachment?.filename).toBe(
      `runtime-parity-mismatches-bybit<prod>-${START}-${END}.json`,
    );
    expect(attachment?.caption).toBe('Runtime parity mismatch JSON');

    const expectedPayload = {
      kind: 'tradejs-runtime-parity-mismatches',
      version: 1,
      generatedAt: END + 1,
      codexQuestion:
        'For each mismatch case, explain why runtime and replay/backtest diverged. Use why.classification first, then confirm with decisionTrace, timing, and artifacts.',
      window: { start: START, end: END, source: 'explicit' },
      connectorName: 'bybit<prod>',
      replayEnv: 'PARITY',
      tolerance: { bars: 1, ms: 900_000 },
      summary: {
        replayTargets: 2,
        comparedTargets: 1,
        replayErrors: 1,
        sourceCounts: reportContext.sourceCounts,
        runtimeEntriesRaw: 2,
        runtimeEntries: 1,
        runtimeDuplicateEntries: 1,
        backtestEntries: 2,
        matchedEntries: 1,
        runtimeOnlyEntries: 1,
        backtestOnlyEntries: 1,
        runtimeSignalEvaluations: 0,
        matchedDeltas: {
          priceAvgPct: 0.25,
          priceMaxPct: 0.5,
          timeAvgMs: 60_000,
          timeMaxMs: 120_000,
        },
        strategyIssues: [
          'Grid: backtestOnly=1, errors=1',
          'TrendLine: runtimeOnly=1, runtimeDuplicates=1',
        ],
      },
      replayErrors: [
        {
          strategy: 'Grid',
          symbol: 'ETHUSDT',
          sources: ['strategyResults'],
          message: 'boom <fail>',
        },
      ],
      cases: [
        {
          kind: 'runtimeOnly',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          signalRefs: { signalId: 'sig-rt', orderId: 'ord-1' },
          why: {
            classification: 'not_evaluated',
            reason: 'no replay evaluation',
            likelyCause:
              'Replay produced no evaluation close to the runtime trade timestamp.',
          },
          timing: { entryTimestamp: START },
          decisionTrace: {},
          recommendedChecks: [
            'Check replay target coverage',
            'Check replay evaluation generation',
            'Inspect symbol/strategy filtering',
          ],
          artifacts: {
            runtimeEntry: {
              id: 'rt-1',
              source: 'runtime',
              strategy: 'TrendLine',
              symbol: 'BTCUSDT',
              direction: 'LONG',
              timestamp: START,
              price: 100,
              orderId: 'ord-1',
              signalId: 'sig-rt',
            },
          },
        },
        {
          kind: 'backtestOnly',
          strategy: 'Grid',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          signalRefs: { signalId: 'bt-1' },
          why: {
            classification: 'true_mismatch',
            reason: 'no <runtime> entry',
            likelyCause:
              'Backtest opened a trade that runtime did not replicate; inspect signal/evaluation context.',
          },
          timing: { entryTimestamp: START + 60_000 },
          decisionTrace: {},
          recommendedChecks: [
            'Compare backtest entry vs runtime signal/evaluation',
            'Check direction and orderStatus',
            'Inspect runtime-specific filters',
          ],
          artifacts: {
            backtestEntry: {
              id: 'bt-1',
              source: 'backtest',
              strategy: 'Grid',
              symbol: 'ETHUSDT',
              direction: 'SHORT',
              timestamp: START + 60_000,
              price: null,
            },
          },
        },
      ],
      mismatches: {
        runtimeOnly: [
          {
            classification: 'not_evaluated',
            reason: 'no replay evaluation',
            runtimeEntry: {
              id: 'rt-1',
              source: 'runtime',
              strategy: 'TrendLine',
              symbol: 'BTCUSDT',
              direction: 'LONG',
              timestamp: START,
              price: 100,
              orderId: 'ord-1',
              signalId: 'sig-rt',
            },
          },
        ],
        backtestOnly: [
          {
            classification: 'true_mismatch',
            reason: 'no <runtime> entry',
            backtestEntry: {
              id: 'bt-1',
              source: 'backtest',
              strategy: 'Grid',
              symbol: 'ETHUSDT',
              direction: 'SHORT',
              timestamp: START + 60_000,
              price: null,
            },
          },
        ],
      },
    };

    expect(attachment?.content).toBe(JSON.stringify(expectedPayload, null, 2));
  });

  it('preserves exact no-target and terminal detail output', () => {
    expect(
      buildRuntimeParityNoTargetsMessage({
        window: { start: START, end: END },
        connectorName: 'bybit<prod>',
        replayEnv: 'BACKTEST',
        runtimeGatesEnabled: false,
        userName: 'root<ops>',
      }),
    ).toBe(
      [
        '🧪 <b>TradeJS runtime parity</b>',
        '',
        '🕒 <b>Window</b>',
        '<b>15.11.2023, 01:13 - 16.11.2023, 01:13 MSK</b>',
        '',
        '🔌 Connector: <b>bybit&lt;prod&gt;</b>',
        '🧬 Replay env: <b>BACKTEST</b>',
        '',
        '⚠️ No replay targets found for user <b>root&lt;ops&gt;</b>.',
      ].join('\n'),
    );

    const duplicateGroups: RuntimeDuplicateGroup[] = [
      {
        key: 'duplicate',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        timestamp: START,
        entries: [
          classifiedRuntimeOnly[0].entry,
          { ...classifiedRuntimeOnly[0].entry, id: 'rt-2', orderId: 'ord-2' },
        ],
      },
    ];
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    printRuntimeDuplicateDetails(duplicateGroups);
    printClassifiedRuntimeOnlyDetails(classifiedRuntimeOnly);
    printClassifiedBacktestOnlyDetails(classifiedBacktestOnly);

    expect(log.mock.calls.map(([line = '']) => line)).toEqual([
      '',
      'Runtime duplicates',
      '- TrendLine BTCUSDT LONG 15 Nov 2023 01:13:20 count=2, duplicateEntries=1, ids=ord-1,ord-2',
      '',
      'Runtime only',
      '- [not_evaluated] TrendLine BTCUSDT LONG 15 Nov 2023 01:13:20 price=100.000000 id=rt-1 reason=no replay evaluation',
      '',
      'Backtest only',
      '- [true_mismatch] Grid ETHUSDT SHORT 15 Nov 2023 01:14:20 price=n/a id=bt-1 reason=no <runtime> entry',
    ]);
  });

  it('describes every JSON mismatch classification and optional evidence field', () => {
    const evaluation: RuntimeSignalEvaluationRecord = {
      evaluationId: 'eval-1',
      userName: 'root',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      interval: '15',
      timestamp: START,
      evaluatedAt: START + 1,
      status: 'skip',
      reason: 'blocked',
      signalId: 'sig-eval',
      direction: 'LONG',
      orderStatus: 'skipped',
      orderSkipReason: 'gate',
    };
    const signal = {
      signalId: 'sig-live',
      orderId: 'ord-live',
      strategy: 'Grid',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      timestamp: START,
      orderStatus: 'skipped',
      orderSkipReason: 'gate',
    } as Signal;
    const runtimeClassifications: RuntimeOnlyClassification[] = [
      'gated_out',
      'order_failed',
      'core_skipped',
      'backtest_drift',
      'true_mismatch',
    ];
    const backtestClassifications: BacktestOnlyClassification[] = [
      'gated_out',
      'order_failed',
      'core_skipped',
      'not_evaluated',
    ];
    const runtimeOnly = runtimeClassifications.map(
      (classification, index): ClassifiedRuntimeOnlyEntry => ({
        entry: {
          ...classifiedRuntimeOnly[0].entry,
          id: `runtime-${index}`,
          timestamp: START + index,
        },
        classification,
        reason: classification,
        evaluation,
        evaluationTimestampDiffMs: 1,
        nearestBacktestEntry: classifiedBacktestOnly[0].entry,
        nearestBacktestEntryTimestampDiffMs: 2,
      }),
    );
    const backtestOnly = backtestClassifications.map(
      (classification, index): ClassifiedBacktestOnlyEntry => ({
        entry: {
          ...classifiedBacktestOnly[0].entry,
          id: `backtest-${index}`,
          timestamp: START + index,
        },
        classification,
        reason: classification,
        signal,
        signalTimestampDiffMs: 3,
        evaluation,
        evaluationTimestampDiffMs: 4,
      }),
    );

    const attachment = buildRuntimeParityMismatchAttachment({
      ...reportContext,
      classifiedRuntimeOnly: runtimeOnly,
      classifiedBacktestOnly: backtestOnly,
    });
    const content = attachment?.content ?? '';

    expect(content).toContain(
      'Replay saw the setup but blocked the trade with gate/order-skip logic.',
    );
    expect(content).toContain(
      'Replay saw the setup but order placement failed.',
    );
    expect(content).toContain(
      'Replay strategy core did not emit a signal for this runtime trade.',
    );
    expect(content).toContain(
      'Replay has a nearby backtest entry, but it is outside the allowed timestamp tolerance.',
    );
    expect(content).toContain(
      'Runtime and replay disagree after evaluation; inspect direction, statuses, and reason fields.',
    );
    expect(content).toContain(
      'Runtime/live path saw the setup but blocked the trade with gate/order-skip logic.',
    );
    expect(content).toContain(
      'Runtime/live path saw the setup but order placement failed.',
    );
    expect(content).toContain(
      'Runtime evaluation skipped the setup while replay/backtest opened a trade.',
    );
    expect(content).toContain(
      'Runtime produced no signal or evaluation close to the backtest trade timestamp.',
    );
    expect(content).toContain('"runtimeSignalDriftMs": 3');
    expect(content).toContain('"nearestBacktestDriftMs": 2');
  });

  it('keeps truncation, clean-summary and empty-attachment branches stable', () => {
    const manyRuntimeOnly = Array.from(
      { length: 6 },
      (_, index): ClassifiedRuntimeOnlyEntry => ({
        ...classifiedRuntimeOnly[0],
        entry: {
          ...classifiedRuntimeOnly[0].entry,
          id: `runtime-${index}`,
          timestamp: START + index,
        },
      }),
    );
    const manyErrors: ReplayError[] = Array.from({ length: 6 }, (_, index) => ({
      strategy: 'TrendLine',
      symbol: `SYMBOL${index}`,
      sources: ['runtime'],
      message: `error-${index}`,
    }));
    const cleanStrategyRows: RuntimeParityReportContext['strategyRows'] = [
      [
        'Clean',
        {
          targets: 1,
          compared: 1,
          errors: 0,
          runtime: 1,
          runtimeDuplicates: 0,
          backtest: 1,
          matched: 1,
          runtimeOnly: 0,
          backtestOnly: 0,
        },
      ],
    ];
    const terminalLines = buildRuntimeParityTerminalReport({
      ...reportContext,
      window: { ...reportContext.window, source: 'explicit' },
      replayErrors: manyErrors,
      classifiedRuntimeOnly: manyRuntimeOnly,
      classifiedBacktestOnly: [],
      runtimeSignalEvaluationsCount: 3,
      strategyRows: cleanStrategyRows,
      runtimeGatesEnabled: false,
      runtimeGatesRequested: false,
      runtimeDuplicateGroupsCount: 0,
      runtimeGateWarningCounts: new Map([
        ['Zulu', 1],
        ['Alpha', 2],
      ]),
      detailLimit: 1,
    });

    expect(terminalLines).toContain('- ... 5 more');
    expect(terminalLines).toContain('Runtime evaluations: 3');
    expect(terminalLines).toContain('Strategies: clean 1/1');
    expect(terminalLines).toContain('Warnings');
    expect(terminalLines).toContain(
      '- Alpha uses AI/ML runtime gates on 2 replay target(s); BACKTEST replay covers core execution, not live gating.',
    );

    const warningsSuppressed = buildRuntimeParityTerminalReport({
      ...reportContext,
      window: { ...reportContext.window, source: 'explicit' },
      runtimeGatesEnabled: false,
      runtimeGatesRequested: true,
      runtimeDuplicateGroupsCount: 0,
      runtimeGateWarningCounts: new Map([['Ignored', 1]]),
      detailLimit: 1,
    });
    expect(warningsSuppressed).not.toContain('Warnings');

    const telegramMessage = buildRuntimeParityMessage({
      ...reportContext,
      replayErrors: manyErrors,
      classifiedRuntimeOnly: manyRuntimeOnly,
      classifiedBacktestOnly: [],
      runtimeSignalEvaluationsCount: 3,
      strategyRows: cleanStrategyRows,
      runtimeGatesEnabled: false,
      runtimeGateWarningCounts: new Map([
        ['Zulu', 1],
        ['Alpha', 2],
      ]),
    });
    expect(telegramMessage.match(/\.\.\. <b>1<\/b> more/g)).toHaveLength(2);
    expect(telegramMessage).toContain('• Runtime evaluations: <b>3</b>');
    expect(telegramMessage).toContain(
      '📊 <b>Strategies</b>: clean <b>1</b> / total <b>1</b>',
    );

    expect(
      buildRuntimeParityMismatchAttachment({
        ...reportContext,
        classifiedRuntimeOnly: [],
        classifiedBacktestOnly: [],
      }),
    ).toBeNull();
  });

  it('keeps terminal writer, evidence suffix and detail limits stable', () => {
    const evaluation: RuntimeSignalEvaluationRecord = {
      evaluationId: 'eval-detail',
      userName: 'root',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      interval: '15',
      timestamp: START,
      evaluatedAt: START,
      status: 'skip',
    };
    const signal = {
      signalId: 'sig-detail',
      strategy: 'Grid',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      timestamp: START,
    } as Signal;
    const duplicateGroups: RuntimeDuplicateGroup[] = Array.from(
      { length: 11 },
      (_, index) => ({
        key: `duplicate-${index}`,
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        timestamp: START + index,
        entries: [
          {
            ...classifiedRuntimeOnly[0].entry,
            id: `runtime-${index}`,
            timestamp: START + index,
          },
        ],
      }),
    );
    const backtestDetails: ClassifiedBacktestOnlyEntry[] = Array.from(
      { length: 11 },
      (_, index) => ({
        ...classifiedBacktestOnly[0],
        entry: {
          ...classifiedBacktestOnly[0].entry,
          id: `backtest-${index}`,
          timestamp: START + index,
        },
        ...(index % 2 === 0
          ? { signal, signalTimestampDiffMs: 60_000 }
          : { evaluation, evaluationTimestampDiffMs: 120_000 }),
      }),
    );
    const runtimeDetails: ClassifiedRuntimeOnlyEntry[] = Array.from(
      { length: 11 },
      (_, index) => ({
        ...classifiedRuntimeOnly[0],
        entry: {
          ...classifiedRuntimeOnly[0].entry,
          id: `runtime-${index}`,
          timestamp: START + index,
        },
        ...(index % 2 === 0
          ? {
              nearestBacktestEntry: classifiedBacktestOnly[0].entry,
              nearestBacktestEntryTimestampDiffMs: 60_000,
            }
          : { evaluation, evaluationTimestampDiffMs: 120_000 }),
      }),
    );
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    writeRuntimeParityTerminalReport(['line-1', 'line-2']);
    printRuntimeDuplicateDetails([]);
    printClassifiedRuntimeOnlyDetails([]);
    printClassifiedBacktestOnlyDetails([]);
    printRuntimeDuplicateDetails(duplicateGroups);
    printClassifiedRuntimeOnlyDetails(runtimeDetails);
    printClassifiedBacktestOnlyDetails(backtestDetails);

    const lines = log.mock.calls.map(([line = '']) => line);
    expect(lines.slice(0, 2)).toEqual(['line-1', 'line-2']);
    expect(lines).toContain('- ... 1 more');
    expect(lines.join('\n')).toContain(
      'nearestBacktestId=bt-1 backtestDrift=1.00m',
    );
    expect(lines.join('\n')).toContain(
      'replayEvaluationId=eval-detail replayDrift=2.00m status=skip',
    );
    expect(lines.join('\n')).toContain('signalId=sig-detail signalDrift=1.00m');
    expect(lines.join('\n')).toContain(
      'evaluationId=eval-detail evaluationDrift=2.00m',
    );
  });
});
