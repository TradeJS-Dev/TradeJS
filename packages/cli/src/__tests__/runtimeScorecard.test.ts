import {
  buildRuntimeScorecard,
  formatRuntimeScorecardMarkdown,
} from '../lib/runtimeScorecard';

const createStrategy = (strategyName: string, seed: string) => ({
  strategyName,
  strategyRevision: `sr1:${seed.repeat(16)}`,
  enabled: true,
  controlState: 'active',
  interval: '15',
  universe: 'crypto',
  strategyPackage: `@tradejs/strategy-${strategyName.toLowerCase()}`,
  strategyPackageVersion: '3.0.0',
  strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.0' },
  runtimePackageVersion: '3.2.0',
  strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto', MAX_LOSS_VALUE: 1 },
});

const createDeployment = (...strategies: ReturnType<typeof createStrategy>[]) =>
  ({
    schemaVersion: 2,
    id: 'production',
    deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
    label: 'Production',
    connectorName: 'bybit',
    provider: 'bybit',
    accountId: 'bybit-main',
    enabled: true,
    tickers: ['BTCUSDT'],
    strategies,
  }) as const;

const createLineage = (
  strategy: ReturnType<typeof createStrategy>,
  maxLossValue = 1,
) =>
  ({
    schemaVersion: 3,
    strategyRevision: strategy.strategyRevision,
    deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
    strategyPackageVersion: strategy.strategyPackageVersion,
    strategyDependencyVersions: strategy.strategyDependencyVersions,
    runtimePackageVersion: strategy.runtimePackageVersion,
    maxLossValue,
  }) as const;

const bindRow = <T extends Record<string, unknown>>(
  strategy: ReturnType<typeof createStrategy>,
  row: T,
) => ({
  strategy: strategy.strategyName,
  deploymentId: 'production',
  accountId: 'bybit-main',
  runtimeLineage: createLineage(strategy),
  ...row,
});

describe('runtime scorecard', () => {
  it('builds the current-lineage funnel, parity, execution drift, and outcomes', () => {
    const strategy = createStrategy('TrendLine', '1');
    const deployment = createDeployment(strategy);
    const endTime = Date.UTC(2026, 7, 7, 18);
    const startTime = endTime - 86_400_000;
    const runtimeArtifact = {
      reportType: 'runtime-evidence',
      window: { startTime, endTime },
      deployment,
      runtime: {
        evaluations: [
          {
            evaluation: bindRow(strategy, {
              status: 'signal',
              aiAnalysis: {
                quality: 4,
                gateDecision: 'approved',
                llmDecision: 'rejected',
              },
              allocatorDecision: {
                stage: 'runtime_admission',
                status: 'approved',
                reason: 'ENTRY_ADMITTED',
              },
              riskDecision: {
                stage: 'order_plan',
                status: 'approved',
                reason: 'PLANNED_LOSS_WITHIN_MAX_LOSS_VALUE',
                enforced: false,
              },
            }),
          },
          {
            evaluation: bindRow(strategy, {
              status: 'signal',
              aiAnalysis: {
                quality: 2,
                approved: true,
                llmDecision: 'approved',
              },
              allocatorDecision: {
                stage: 'runtime_admission',
                status: 'not_applicable',
                reason: 'ENTRY_POLICY_REJECTED',
              },
              riskDecision: {
                stage: 'order_plan',
                status: 'approved',
                reason: 'PLANNED_LOSS_WITHIN_MAX_LOSS_VALUE',
                enforced: false,
              },
            }),
          },
        ],
        signals: [
          { signal: bindRow(strategy, { orderStatus: 'completed' }) },
          {
            signal: bindRow(strategy, {
              orderStatus: 'failed',
              orderFailureReason: 'INSUFFICIENT_MARGIN',
            }),
          },
        ],
        trades: [
          {
            trade: bindRow(strategy, {
              orderId: 'order-1',
              status: 'closed',
              entryTimestamp: startTime,
              exitTimestamp: endTime - 1_000,
              closedPnl: 12,
              totalFee: 1,
              fundingFee: 0.2,
            }),
          },
        ],
        lineageScopes: [],
      },
    };
    const previousRuntimeArtifact = {
      reportType: 'runtime-evidence',
      window: { startTime: startTime - 86_400_000, endTime: startTime },
      deployment,
      runtime: {
        evaluations: [
          {
            evaluation: bindRow(strategy, {
              status: 'signal',
              aiAnalysis: { quality: 4, gateDecision: 'approved' },
            }),
          },
        ],
        signals: [{ signal: bindRow(strategy, { orderStatus: 'completed' }) }],
        trades: [],
        lineageScopes: [],
      },
    };
    const scorecard = buildRuntimeScorecard({
      runtimeArtifact,
      replayEvidenceArtifact: {
        replay: {
          runtimeComparison: {
            lineage: { reason: null },
            counts: { matched: 18, backtestOnly: 1, runtimeOnly: 1 },
          },
        },
      },
      calibrationArtifact: {
        samples: [
          {
            strategy: strategy.strategyName,
            runtimeLineage: createLineage(strategy),
            signalToFillAdverseBps: 5,
            residualVsCurrentModelBps: 4,
            signalCloseToSubmitMs: 100_000,
            submitToFillMs: 2_000,
            telemetryQuality: 'partial',
            arrivalSource: 'unavailable',
          },
        ],
      },
      prospectiveEvidenceArtifact: {
        reportType: 'strategy-prospective-evidence',
        rawCoreExpectancy: 0.2,
        aiGateExpectancy: 0.5,
        regimeCoverage: 0.8,
      },
      historyRuntimeArtifacts: [previousRuntimeArtifact],
      generatedAt: endTime,
      thresholds: {
        minimumParityRatio: 0.95,
        maximumSlippageResidualBps: 3,
        maximumSignalCloseToSubmitMs: 30_000,
        minimumClosedTrades: 1,
        minimumExpectancy: 0,
      },
    });

    expect(scorecard.lineage).toMatchObject({
      complete: true,
      schemaVersion: 3,
      strategyRevision: strategy.strategyRevision,
      deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
      maxLossValue: 1,
    });
    expect(scorecard.funnel).toMatchObject({
      evaluations: 2,
      coreCandidates: 2,
      gate: {
        approved: 2,
        rejected: 0,
        coverage: 1,
        legacyApprovedFallback: 1,
      },
      allocator: {
        available: true,
        approved: 1,
        rejected: 0,
        notApplicable: 1,
        unavailable: 0,
      },
      risk: {
        available: true,
        approved: 2,
        rejected: 0,
        unavailable: 0,
        enforced: false,
      },
      orderAttempts: 2,
      orderFailures: 1,
      fills: 1,
      comparableClosedTrades: 1,
    });
    expect(scorecard.parity.ratio).toBe(0.9);
    expect(scorecard.execution).toMatchObject({
      residualVsCurrentModelBps: 4,
      metricScope: 'signal_close_to_fill',
      samples: 1,
      fullTelemetryTrades: 0,
      arrivalQuoteCoverage: 0,
      averageSignalCloseToSubmitMs: 100_000,
      averageSubmitToFillMs: 2_000,
      signalToArrivalAdverseBps: null,
      arrivalToFillAdverseBps: null,
    });
    expect(scorecard.rolling[0]).toMatchObject({
      closedTrades: 1,
      realizedPnl: 12,
      expectancy: 12,
    });
    expect(scorecard.promotionStatus).toBe('PROMOTION_BLOCKED');
    expect(scorecard.reactions.map(({ code }) => code)).toEqual([
      'PARITY_REGRESSION',
      'SLIPPAGE_DRIFT',
      'PRE_SUBMIT_LATENCY',
      'EXECUTION_TELEMETRY_INCOMPLETE',
    ]);
    const markdown = formatRuntimeScorecardMarkdown(scorecard);
    expect(markdown).toContain('AI / LLM disagreement: 1/2');
    expect(markdown).toContain('Signal-close-to-fill adverse move: 5 bps');
    expect(markdown).toContain('Arrival-to-fill exchange slippage: n/a bps');
    expect(markdown).toContain('Average signal-close-to-submit: 100000 ms');
  });

  it('isolates current deployment rows to the requested strategy', () => {
    const doubleTap = createStrategy('DoubleTap', '2');
    const trendLine = createStrategy('TrendLine', '3');
    const endTime = 1_000_000;
    const runtimeArtifact = {
      reportType: 'runtime-evidence',
      window: { startTime: 0, endTime },
      deployment: createDeployment(doubleTap, trendLine),
      runtime: {
        evaluations: [
          bindRow(doubleTap, { status: 'signal' }),
          bindRow(trendLine, { status: 'signal' }),
        ],
        signals: [
          bindRow(doubleTap, { orderStatus: 'completed' }),
          bindRow(trendLine, { orderStatus: 'failed' }),
        ],
        trades: [
          bindRow(doubleTap, {
            orderId: 'dt',
            status: 'closed',
            exitTimestamp: endTime - 1,
            closedPnl: 5,
          }),
          bindRow(trendLine, {
            orderId: 'tl',
            status: 'closed',
            exitTimestamp: endTime - 1,
            closedPnl: -100,
          }),
        ],
        lineageScopes: [],
      },
    };
    const scorecard = buildRuntimeScorecard({
      runtimeArtifact,
      replayEvidenceArtifact: {
        replay: {
          runtimeComparison: {
            byStrategy: {
              DoubleTap: { matched: 9, backtestOnly: 1, runtimeOnly: 0 },
              TrendLine: { matched: 0, backtestOnly: 10, runtimeOnly: 10 },
            },
          },
        },
      },
      strategy: 'DoubleTap',
      generatedAt: endTime,
    });

    expect(scorecard.strategy).toBe('DoubleTap');
    expect(scorecard.funnel).toMatchObject({
      evaluations: 1,
      coreCandidates: 1,
      orderAttempts: 1,
      orderFailures: 0,
      closedTrades: 1,
      comparableClosedTrades: 1,
      nonComparableClosedTrades: 0,
    });
    expect(scorecard.realized.pnl).toBe(5);
    expect(scorecard.parity.ratio).toBe(0.9);
  });

  it('rejects any bundle row outside the current lineage schema', () => {
    const strategy = createStrategy('DoubleTap', '4');
    expect(() =>
      buildRuntimeScorecard({
        runtimeArtifact: {
          reportType: 'runtime-evidence',
          deployment: createDeployment(strategy),
          runtime: {
            evaluations: [
              {
                ...bindRow(strategy, { status: 'signal' }),
                runtimeLineage: { schemaVersion: 2 },
              },
            ],
            signals: [],
            trades: [],
            lineageScopes: [],
          },
        },
      }),
    ).toThrow(
      'Runtime evidence evaluation row is outside the current embedded deployment lineage',
    );
  });
});
