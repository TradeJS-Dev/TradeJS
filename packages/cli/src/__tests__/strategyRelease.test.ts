import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  buildStrategyLiveDiagnosis,
  buildStrategyLiveDiagnosisFromScorecard,
  buildStrategyMonitoringProfile,
  createStrategyEvidenceMarkerEnvelope,
  createStrategyReleaseManifest,
  deriveStrategyReleaseResearchDecision,
  planStrategyEvidenceRetention,
  publishStrategyLiveDiagnosis,
  publishStrategyRelease,
  strategyReleaseSha256,
  verifyStrategyEvidenceMarkerEnvelope,
  verifyStrategyReleaseEnvelope,
} from '../lib/strategyRelease';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const FP_A = '1'.repeat(16);
const FP_B = '2'.repeat(16);
const FP_C = '3'.repeat(16);
const FP_D = '4'.repeat(16);
const matchingRuntimeLineage = {
  complete: true,
  conflicts: false,
  compositionId: 'set-from-manifest',
  gitSha: 'deadbeef',
  gitDirty: false,
  gateFingerprint: FP_B,
  configFingerprint: FP_C,
  contextFingerprint: FP_D,
  maxLossValue: 10,
};
const runtimeLineageFor = (manifest: ReturnType<typeof buildRelease>) => ({
  ...matchingRuntimeLineage,
  compositionId: manifest.composition.compositionId,
});

const buildRelease = () =>
  createStrategyReleaseManifest({
    strategy: 'DoubleTap',
    createdAt: Date.UTC(2026, 7, 12, 12),
    composition: {
      gitSha: 'deadbeef',
      coreConfigSha256: SHA_A,
      coreExportSha256: SHA_B,
      gateConfigIdsFingerprint: FP_A,
      runtimeConfigFingerprint: FP_C,
      gateFingerprint: FP_B,
      gateContextFingerprint: FP_C,
      runtimeContextFingerprint: FP_D,
      maxLossValue: 10,
      longEnabled: true,
      shortEnabled: true,
    },
    marketWindow: {
      startTime: Date.UTC(2023, 7, 8),
      endTime: Date.UTC(2026, 7, 12),
      universeSha256: SHA_D,
      symbols: 507,
      cacheOnly: true,
      terminalDays: [180, 90, 30, 7],
    },
    researchBudget: {
      hypothesisFamilies: 3,
      maximumVariantsPerFamily: 5,
      isolatedLongFinalists: 1,
      aiGateTuningRounds: 1,
    },
    evidence: [
      {
        kind: 'core_research',
        artifactId: 'core-1',
        path: 'data/research/core/core-1/manifest.json',
        sha256: SHA_A,
        verified: true,
        lineage: {
          strategy: 'DoubleTap',
          gitSha: 'deadbeef',
          gitDirty: false,
          coreConfigSha256: SHA_A,
          gateConfigIdsFingerprint: null,
          gateFingerprint: null,
          runtimeConfigFingerprint: null,
          gateContextFingerprint: null,
          runtimeContextFingerprint: null,
          maxLossValue: 10,
          sourceSha256s: [SHA_B],
        },
        releaseAssertions: {
          coreEdgeVerified: true,
          currentMarketSuitable: true,
        },
      },
      {
        kind: 'ai_gate',
        artifactId: 'gate-1',
        path: 'data/ai/output/gate-1.json',
        sha256: SHA_B,
        verified: true,
        lineage: {
          strategy: 'DoubleTap',
          gitSha: 'deadbeef',
          gitDirty: false,
          coreConfigSha256: null,
          gateConfigIdsFingerprint: FP_A,
          gateFingerprint: FP_B,
          runtimeConfigFingerprint: null,
          gateContextFingerprint: FP_C,
          runtimeContextFingerprint: null,
          maxLossValue: null,
          sourceSha256s: [SHA_B],
        },
        releaseAssertions: { aiGateAddsValue: true },
      },
      {
        kind: 'runtime_parity',
        artifactId: 'parity-1',
        path: 'output/parity-1.json',
        sha256: SHA_C,
        verified: true,
        lineage: {
          strategy: 'DoubleTap',
          gitSha: 'deadbeef',
          gitDirty: false,
          coreConfigSha256: null,
          gateConfigIdsFingerprint: null,
          gateFingerprint: FP_B,
          runtimeConfigFingerprint: FP_C,
          gateContextFingerprint: null,
          runtimeContextFingerprint: FP_D,
          maxLossValue: 10,
          sourceSha256s: [],
        },
        releaseAssertions: { runtimeParityVerified: true },
      },
      {
        kind: 'execution_calibration',
        artifactId: 'execution-1',
        path: 'output/execution-1.json',
        sha256: SHA_D,
        verified: true,
        lineage: {
          strategy: 'DoubleTap',
          gitSha: 'deadbeef',
          gitDirty: false,
          coreConfigSha256: null,
          gateConfigIdsFingerprint: null,
          gateFingerprint: FP_B,
          runtimeConfigFingerprint: FP_C,
          gateContextFingerprint: null,
          runtimeContextFingerprint: FP_D,
          maxLossValue: 10,
          sourceSha256s: [],
        },
        releaseAssertions: { executionModelVerified: true },
      },
    ],
    gates: {
      coreEdgeVerified: true,
      aiGateAddsValue: true,
      currentMarketSuitable: true,
      runtimeParityVerified: true,
      executionModelVerified: true,
    },
    monitoring: {
      minimumProspectiveClosedTrades: 20,
      minimumParityRatio: 0.95,
      maximumOrderFailureRate: 0.05,
      minimumRegimeCoverage: 0.5,
      drawdownEnvelopes: [
        { days: 7, p95: 100, maximum: 150 },
        { days: 30, p95: 250, maximum: 400 },
      ],
      rawCoreExpectancy: 1,
      aiGateExpectancy: 2,
      overfitProbability: 0.2,
    },
    summary: 'DoubleTap composition cleared every frozen evidence gate.',
    prospective: {
      status: 'not_started',
      evidenceBooks: [
        'micro_live',
        'shadow_composition',
        'shadow_raw_core',
        'gate_comparison',
      ],
      llmComparatorPolicy: 'ai_approved_only',
    },
  });

describe('strategy release evidence', () => {
  it('keeps a verified LONG-only composition eligible for forward evidence', async () => {
    expect(
      await deriveStrategyReleaseResearchDecision({
        strategy: 'RelativeRotation',
        directionPolicy: 'long_only',
        historicalWindows: [1095, 1460, 1825, 365, 180, 90].map((days) => ({
          days,
          pnl: 120,
          profitFactor: 1.2,
          long: { trades: 180, pnl: 120, profitFactor: 1.2 },
          short: { trades: 0, pnl: 0, profitFactor: 0 },
        })),
        candidateImplemented: false,
        exposedEvaluation: true,
        chartArtifact: null,
        recentFailure: null,
        forwardTest: {
          authorized: false,
          runtimeTarget: null,
          maxLossValue: 1,
        },
      }),
    ).toMatchObject({
      action: 'FORWARD_BLOCKED',
      blockers: ['CANDIDATE_NOT_IMPLEMENTED', 'FULL_PERIOD_CHART_MISSING'],
    });
  });

  it('starts an authorized micro-forward instead of tuning four exposed recent losses', async () => {
    const chartPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'strategy-release-chart-')),
      'chart.json',
    );
    await fs.writeFile(
      chartPath,
      JSON.stringify({
        chart: { persisted: true, cardIds: ['DoubleTap-q4'] },
        errors: { failed: 0 },
        run: {
          strategy: 'DoubleTap',
          mode: 'local-deterministic',
          recent: 0,
          since: null,
          until: null,
          sourceRows: 541,
        },
      }),
    );
    expect(
      await deriveStrategyReleaseResearchDecision({
        strategy: 'DoubleTap',
        historicalWindows: [
          {
            days: 1095,
            pnl: 1036,
            profitFactor: 1.39,
            long: { pnl: 608, profitFactor: 1.49 },
            short: { pnl: 429, profitFactor: 1.37 },
          },
          {
            days: 1460,
            pnl: 1125,
            profitFactor: 1.4,
            long: { pnl: 624, profitFactor: 1.5 },
            short: { pnl: 501, profitFactor: 1.33 },
          },
          {
            days: 1825,
            coveredDays: 1800,
            pnl: 1084,
            profitFactor: 1.39,
            long: { pnl: 624, profitFactor: 1.5 },
            short: { pnl: 460, profitFactor: 1.31 },
          },
          ...[365, 180, 90].map((days) => ({
            days,
            pnl: 100,
            profitFactor: 1.2,
            long: { pnl: 60, profitFactor: 1.2 },
            short: { pnl: 40, profitFactor: 1.1 },
          })),
        ],
        candidateImplemented: true,
        exposedEvaluation: true,
        chartArtifact: {
          path: chartPath,
          sha256: createHash('sha256')
            .update(await fs.readFile(chartPath))
            .digest('hex'),
        },
        recentFailure: {
          days: 30,
          direction: 'SHORT',
          closedTrades: 4,
          causalMechanismIdentified: false,
          repairRoundsUsed: 0,
        },
        forwardTest: {
          authorized: true,
          runtimeTarget: {
            userName: 'root',
            deploymentId: 'forward-doubletap',
            accountId: 'bybit-forward',
            strategyName: 'DoubleTap',
            version: 4,
          },
          maxLossValue: 1,
        },
      }),
    ).toMatchObject({
      action: 'START_MICRO_FORWARD',
      maxLossValue: 1,
      repairAllowed: false,
      requiresRuntimeBinding: false,
    });
  });

  it('spends one bounded repair round on a supported causal side failure', async () => {
    expect(
      await deriveStrategyReleaseResearchDecision({
        strategy: 'DoubleTap',
        historicalWindows: [
          {
            days: 1095,
            pnl: 1036,
            profitFactor: 1.39,
            long: { pnl: 608, profitFactor: 1.49 },
            short: { pnl: 429, profitFactor: 1.37 },
          },
          {
            days: 1460,
            pnl: 1125,
            profitFactor: 1.4,
            long: { pnl: 624, profitFactor: 1.5 },
            short: { pnl: 501, profitFactor: 1.33 },
          },
          {
            days: 1825,
            coveredDays: 1800,
            pnl: 1084,
            profitFactor: 1.39,
            long: { pnl: 624, profitFactor: 1.5 },
            short: { pnl: 460, profitFactor: 1.31 },
          },
          ...[365, 180, 90].map((days) => ({
            days,
            pnl: 100,
            profitFactor: 1.2,
            long: { pnl: 60, profitFactor: 1.2 },
            short: { pnl: 40, profitFactor: 1.1 },
          })),
        ],
        candidateImplemented: true,
        exposedEvaluation: false,
        chartArtifact: null,
        recentFailure: {
          days: 30,
          direction: 'SHORT',
          closedTrades: 24,
          causalMechanismIdentified: true,
          repairRoundsUsed: 0,
        },
        forwardTest: {
          authorized: true,
          runtimeTarget: null,
          maxLossValue: 1,
        },
      }),
    ).toMatchObject({
      action: 'REPAIR_RECENT_DIRECTION',
      repairAllowed: true,
      targetDirection: 'SHORT',
      requiresRuntimeBinding: false,
    });
  });

  it('blocks forward execution until the mandatory full-period chart exists', async () => {
    expect(
      await deriveStrategyReleaseResearchDecision({
        strategy: 'DoubleTap',
        historicalWindows: [
          {
            days: 1095,
            pnl: 1036,
            profitFactor: 1.39,
            long: { pnl: 608, profitFactor: 1.49 },
            short: { pnl: 429, profitFactor: 1.37 },
          },
          {
            days: 1460,
            pnl: 1125,
            profitFactor: 1.4,
            long: { pnl: 624, profitFactor: 1.5 },
            short: { pnl: 501, profitFactor: 1.33 },
          },
          {
            days: 1825,
            coveredDays: 1800,
            pnl: 1084,
            profitFactor: 1.39,
            long: { pnl: 624, profitFactor: 1.5 },
            short: { pnl: 460, profitFactor: 1.31 },
          },
          ...[365, 180, 90].map((days) => ({
            days,
            pnl: 100,
            profitFactor: 1.2,
            long: { pnl: 60, profitFactor: 1.2 },
            short: { pnl: 40, profitFactor: 1.1 },
          })),
        ],
        candidateImplemented: true,
        exposedEvaluation: true,
        chartArtifact: null,
        recentFailure: null,
        forwardTest: {
          authorized: true,
          runtimeTarget: {
            userName: 'root',
            deploymentId: 'forward-doubletap',
            accountId: 'bybit-forward',
            strategyName: 'DoubleTap',
            version: 4,
          },
          maxLossValue: 1,
        },
      }),
    ).toMatchObject({
      action: 'FORWARD_BLOCKED',
      blockers: ['FULL_PERIOD_CHART_MISSING'],
      requiresRuntimeBinding: false,
    });
  });

  it('derives an immutable ready manifest from verified bounded research', () => {
    const manifest = buildRelease();

    expect(manifest.releaseId).toMatch(/^DoubleTap_20260812T120000Z_/);
    expect(manifest.composition.compositionId).toMatch(/^DoubleTap_/);
    expect(manifest.verdict).toEqual({
      status: 'READY_FOR_RUNTIME',
      reasons: [],
      summary: 'DoubleTap composition cleared every frozen evidence gate.',
    });
  });

  it('binds an explicit direction policy to gate and runtime evidence lineage', () => {
    const ready = buildRelease();
    const { compositionId: _, ...composition } = ready.composition;
    const evidence = ready.evidence.map((entry) => ({
      ...entry,
      lineage:
        entry.kind === 'core_research'
          ? entry.lineage
          : { ...entry.lineage!, directionPolicy: 'long_only' as const },
    }));
    const manifest = createStrategyReleaseManifest({
      ...ready,
      composition: { ...composition, directionPolicy: 'long_only' },
      evidence,
      summary: ready.verdict.summary,
    });

    expect(manifest.composition.directionPolicy).toBe('long_only');
    expect(() =>
      createStrategyReleaseManifest({
        ...ready,
        composition: { ...composition, directionPolicy: 'long_only' },
        evidence: evidence.map((entry) =>
          entry.kind === 'ai_gate'
            ? {
                ...entry,
                lineage: {
                  ...entry.lineage!,
                  directionPolicy: 'short_only' as const,
                },
              }
            : entry,
        ),
        summary: ready.verdict.summary,
      }),
    ).toThrow('directionPolicy does not match the frozen composition');
  });

  it('keeps a release immutable while runtime risk scale is compared separately', () => {
    const original = buildRelease();
    const { compositionId: _compositionId, ...scaledComposition } =
      original.composition;
    const scaled = createStrategyReleaseManifest({
      ...original,
      composition: {
        ...scaledComposition,
        maxLossValue: 1,
      },
      evidence: original.evidence.map((entry) => ({
        ...entry,
        lineage: entry.lineage
          ? {
              ...entry.lineage,
              maxLossValue: entry.lineage.maxLossValue == null ? null : 1,
            }
          : undefined,
      })),
      summary: 'Same logic composition at a smaller risk scale.',
    });

    expect(scaled.composition.compositionId).not.toBe(
      original.composition.compositionId,
    );
    expect(scaled.composition.maxLossValue).toBe(1);
  });

  it('cannot report ready when a required evidence class is missing', () => {
    const ready = buildRelease();
    const manifest = createStrategyReleaseManifest({
      ...ready,
      composition: {
        ...ready.composition,
        compositionId: undefined,
      },
      evidence: ready.evidence.filter(
        (entry) => entry.kind !== 'runtime_parity',
      ),
      gates: { ...ready.gates, runtimeParityVerified: false },
      summary: 'Parity evidence is missing.',
    } as any);

    expect(manifest.verdict.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(manifest.verdict.reasons).toContain('EVIDENCE_INCOMPLETE');
  });

  it('cannot trust draft gates without matching verified evidence assertions', () => {
    const ready = buildRelease();
    expect(() =>
      createStrategyReleaseManifest({
        ...ready,
        composition: {
          gitSha: ready.composition.gitSha,
          coreConfigSha256: ready.composition.coreConfigSha256,
          coreExportSha256: ready.composition.coreExportSha256,
          gateConfigIdsFingerprint: ready.composition.gateConfigIdsFingerprint,
          runtimeConfigFingerprint: ready.composition.runtimeConfigFingerprint,
          gateFingerprint: ready.composition.gateFingerprint,
          gateContextFingerprint: ready.composition.gateContextFingerprint,
          runtimeContextFingerprint:
            ready.composition.runtimeContextFingerprint,
          maxLossValue: ready.composition.maxLossValue,
          longEnabled: ready.composition.longEnabled,
          shortEnabled: ready.composition.shortEnabled,
        },
        evidence: ready.evidence.map(
          ({ releaseAssertions: _, ...entry }) => entry,
        ),
        summary: ready.verdict.summary,
      }),
    ).toThrow('derived from verified evidence assertions');
  });

  it('rejects verified evidence from a different frozen composition', () => {
    const ready = buildRelease();
    expect(() =>
      createStrategyReleaseManifest({
        ...ready,
        composition: {
          gitSha: ready.composition.gitSha,
          coreConfigSha256: ready.composition.coreConfigSha256,
          coreExportSha256: ready.composition.coreExportSha256,
          gateConfigIdsFingerprint: ready.composition.gateConfigIdsFingerprint,
          runtimeConfigFingerprint: ready.composition.runtimeConfigFingerprint,
          gateFingerprint: ready.composition.gateFingerprint,
          gateContextFingerprint: ready.composition.gateContextFingerprint,
          runtimeContextFingerprint:
            ready.composition.runtimeContextFingerprint,
          maxLossValue: ready.composition.maxLossValue,
          longEnabled: ready.composition.longEnabled,
          shortEnabled: ready.composition.shortEnabled,
        },
        evidence: ready.evidence.map((entry) =>
          entry.kind === 'ai_gate'
            ? {
                ...entry,
                lineage: {
                  ...entry.lineage!,
                  gateFingerprint: FP_D,
                },
              }
            : entry,
        ),
        summary: ready.verdict.summary,
      }),
    ).toThrow('gateFingerprint does not match the frozen composition');
  });

  it('keeps incomplete evidence above unfavorable economics in verdict precedence', () => {
    const ready = buildRelease();
    const manifest = createStrategyReleaseManifest({
      ...ready,
      composition: { ...ready.composition, compositionId: undefined },
      evidence: [],
      gates: {
        coreEdgeVerified: false,
        aiGateAddsValue: false,
        currentMarketSuitable: false,
        runtimeParityVerified: false,
        executionModelVerified: false,
      },
      summary: 'Evidence is incomplete.',
    } as any);

    expect(manifest.verdict.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('rejects a release that exceeds the frozen research budget', () => {
    expect(() =>
      createStrategyReleaseManifest({
        ...buildRelease(),
        researchBudget: {
          hypothesisFamilies: 4,
          maximumVariantsPerFamily: 5,
          isolatedLongFinalists: 1,
          aiGateTuningRounds: 1,
        },
        summary: 'invalid',
      } as any),
    ).toThrow('at most 3 hypothesis families');
  });

  it('publishes checksum-verified release and marker envelopes', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-'),
    );
    const published = await publishStrategyRelease({
      rootDir,
      manifest: buildRelease(),
    });

    const release = await verifyStrategyReleaseEnvelope(published.releasePath);
    const markers = await verifyStrategyEvidenceMarkerEnvelope(
      published.markerPath,
    );

    expect(release.manifest.verdict.status).toBe('READY_FOR_RUNTIME');
    expect(markers.payload.markers.map((marker) => marker.type)).toEqual([
      'E',
      'G',
      'L',
      'D',
      'R',
    ]);
    expect(markers.payload.sourceArtifacts).toHaveLength(4);
  });

  it('rejects a marker envelope after a payload mutation', async () => {
    const envelope = createStrategyEvidenceMarkerEnvelope({
      strategy: 'DoubleTap',
      createdAt: 100,
      markers: [],
      sourceArtifacts: [],
    });

    await expect(
      verifyStrategyEvidenceMarkerEnvelope({
        ...envelope,
        payload: { ...envelope.payload, strategy: 'TrendLine' },
      }),
    ).rejects.toThrow('checksum');
  });

  it('rejects a checksum-valid manifest with self-declared derived verdicts', async () => {
    const manifest = buildRelease();
    const tampered = {
      ...manifest,
      gates: { ...manifest.gates, coreEdgeVerified: false },
    };
    const envelope = {
      schema: 'tradejs-strategy-release-envelope/v1' as const,
      releaseId: tampered.releaseId,
      manifestSha256: strategyReleaseSha256(tampered),
      manifest: tampered,
    };

    await expect(verifyStrategyReleaseEnvelope(envelope)).rejects.toThrow(
      'derived from verified evidence assertions',
    );
  });
});

describe('strategy live diagnosis', () => {
  it('classifies a comparable drawdown inside the historical envelope', () => {
    expect(
      buildStrategyLiveDiagnosis({
        strategy: 'DoubleTap',
        compositionId: 'DoubleTap_123',
        createdAt: 100,
        lineageComparable: true,
        parityRatio: 0.99,
        orderFailureRate: 0,
        observedDrawdown: 80,
        historicalDrawdownP95: 100,
        historicalDrawdownMaximum: 150,
        closedTrades: 30,
        rawCoreExpectancyDelta: -0.1,
        aiGateAddedValue: 0.2,
        regimeCoverage: 0.8,
        overfitProbability: 0.2,
      }).verdict,
    ).toBe('EXPECTED_DRAWDOWN');
  });

  it('prioritizes runtime divergence over economic attribution', () => {
    const diagnosis = buildStrategyLiveDiagnosis({
      strategy: 'DoubleTap',
      compositionId: 'DoubleTap_123',
      createdAt: 100,
      lineageComparable: true,
      parityRatio: 0.8,
      orderFailureRate: 0.01,
      observedDrawdown: 200,
      historicalDrawdownP95: 100,
      historicalDrawdownMaximum: 150,
      closedTrades: 30,
      rawCoreExpectancyDelta: -1,
      aiGateAddedValue: -1,
      regimeCoverage: 0.2,
      overfitProbability: 0.8,
    });

    expect(diagnosis.verdict).toBe('RUNTIME_DIVERGENCE');
    expect(diagnosis.recommendations[0]).toContain('parity');
  });

  it('keeps sparse prospective evidence unknown', () => {
    expect(
      buildStrategyLiveDiagnosis({
        strategy: 'DoubleTap',
        compositionId: 'DoubleTap_123',
        createdAt: 100,
        lineageComparable: true,
        parityRatio: 1,
        orderFailureRate: 0,
        observedDrawdown: 200,
        historicalDrawdownP95: 100,
        historicalDrawdownMaximum: 150,
        closedTrades: 3,
        rawCoreExpectancyDelta: -1,
        aiGateAddedValue: -1,
        regimeCoverage: 0.2,
        overfitProbability: 0.8,
      }).verdict,
    ).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('keeps missing parity evidence unknown even with a large trade sample', () => {
    expect(
      buildStrategyLiveDiagnosis({
        strategy: 'DoubleTap',
        compositionId: 'DoubleTap_123',
        createdAt: 100,
        lineageComparable: true,
        parityRatio: null,
        orderFailureRate: 0,
        observedDrawdown: 80,
        historicalDrawdownP95: 100,
        historicalDrawdownMaximum: 150,
        closedTrades: 100,
        rawCoreExpectancyDelta: 0,
        aiGateAddedValue: 1,
        regimeCoverage: 1,
        overfitProbability: 0,
      }).verdict,
    ).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('keeps an envelope breach unknown without causal attribution evidence', () => {
    expect(
      buildStrategyLiveDiagnosis({
        strategy: 'DoubleTap',
        compositionId: 'DoubleTap_123',
        createdAt: 100,
        lineageComparable: true,
        parityRatio: 1,
        orderFailureRate: 0,
        observedDrawdown: 200,
        historicalDrawdownP95: 100,
        historicalDrawdownMaximum: 150,
        closedTrades: 100,
        rawCoreExpectancyDelta: null,
        aiGateAddedValue: null,
        regimeCoverage: null,
        overfitProbability: 0,
      }).verdict,
    ).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('publishes parity and recommendation markers from diagnosis evidence', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-diagnosis-'),
    );
    const diagnosis = buildStrategyLiveDiagnosis({
      strategy: 'DoubleTap',
      compositionId: 'DoubleTap_123',
      createdAt: 100,
      lineageComparable: true,
      parityRatio: 0.8,
      orderFailureRate: 0,
      observedDrawdown: 20,
      historicalDrawdownP95: 10,
      historicalDrawdownMaximum: 15,
      closedTrades: 30,
      rawCoreExpectancyDelta: null,
      aiGateAddedValue: null,
      regimeCoverage: null,
      overfitProbability: null,
    });
    const published = await publishStrategyLiveDiagnosis({
      rootDir,
      diagnosis,
      sourceArtifacts: [],
    });
    const markers = await verifyStrategyEvidenceMarkerEnvelope(
      published.markerPath,
    );

    expect(markers.payload.markers.map((marker) => marker.type)).toEqual([
      'P',
      'R',
    ]);
  });

  it('uses the release drawdown envelope for scorecard diagnosis', () => {
    const manifest = buildRelease();
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: runtimeLineageFor(manifest),
        funnel: { orderAttempts: 30, orderFailures: 0 },
        rolling: [
          { days: 7, closedTrades: 25, maxDrawdown: 80, expectancy: 1.5 },
        ],
      },
      days: 7,
    });

    expect(diagnosis.verdict).toBe('EXPECTED_DRAWDOWN');
    expect(diagnosis.evidence.historicalDrawdownP95).toBe(100);
  });

  it('normalizes drawdown when runtime risk scale differs from research', () => {
    const manifest = buildRelease();
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: {
          ...runtimeLineageFor(manifest),
          maxLossValue: 20,
        },
        funnel: { orderAttempts: 30, orderFailures: 0 },
        rolling: [
          { days: 7, closedTrades: 25, maxDrawdown: 160, expectancy: 3 },
        ],
      },
      days: 7,
    });

    expect(diagnosis.verdict).toBe('EXPECTED_DRAWDOWN');
    expect(diagnosis.evidence.lineageComparable).toBe(true);
    expect(diagnosis.evidence).toMatchObject({
      observedDrawdown: 160,
      normalizedObservedDrawdown: 80,
      releaseMaxLossValue: 10,
      runtimeMaxLossValue: 20,
      riskScaleRatio: 2,
    });
  });

  it('publishes a verified loss-scale marker without changing composition lineage', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-risk-scale-'),
    );
    const manifest = buildRelease();
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: {
          ...runtimeLineageFor(manifest),
          maxLossValue: 20,
        },
        funnel: { orderAttempts: 30, orderFailures: 0 },
        rolling: [
          { days: 7, closedTrades: 25, maxDrawdown: 160, expectancy: 3 },
        ],
      },
      days: 7,
    });
    const published = await publishStrategyLiveDiagnosis({
      rootDir,
      diagnosis,
      composition: manifest.composition,
      sourceArtifacts: [],
    });

    expect(published.markerEnvelope.payload.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'L',
          compositionId: manifest.composition.compositionId,
          maxLossValue: 20,
          summary: 'MAX_LOSS_VALUE 20',
        }),
      ]),
    );
  });

  it('uses the release sample and parity thresholds for diagnosis', () => {
    const manifest = buildRelease();
    manifest.monitoring.minimumProspectiveClosedTrades = 40;
    manifest.monitoring.minimumParityRatio = 0.99;
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 0.98, lineageReason: null },
        lineage: runtimeLineageFor(manifest),
        funnel: { orderAttempts: 30, orderFailures: 0 },
        rolling: [
          { days: 7, closedTrades: 30, maxDrawdown: 80, expectancy: 1.5 },
        ],
      },
      days: 7,
    });

    expect(diagnosis.verdict).toBe('RUNTIME_DIVERGENCE');
  });

  it('blocks economic attribution when runtime composition lineage differs', () => {
    const manifest = buildRelease();
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: {
          ...runtimeLineageFor(manifest),
          contextFingerprint: FP_A,
        },
        funnel: { orderAttempts: 30, orderFailures: 0 },
        rolling: [
          { days: 7, closedTrades: 30, maxDrawdown: 80, expectancy: 1.5 },
        ],
      },
      days: 7,
    });

    expect(diagnosis.verdict).toBe('RUNTIME_DIVERGENCE');
    expect(diagnosis.evidence.lineageComparable).toBe(false);
  });

  it('blocks economic attribution when a bound runtime composition id differs', () => {
    const manifest = buildRelease();
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: {
          ...runtimeLineageFor(manifest),
          compositionId: 'another-composition',
        },
        funnel: { orderAttempts: 30, orderFailures: 0 },
        rolling: [
          { days: 7, closedTrades: 30, maxDrawdown: 80, expectancy: 1.5 },
        ],
      },
      days: 7,
    });

    expect(diagnosis.verdict).toBe('RUNTIME_DIVERGENCE');
    expect(diagnosis.evidence.lineageComparable).toBe(false);
  });
});

describe('strategy monitoring profile', () => {
  it('builds equal-length rolling drawdown envelopes and expectancy', () => {
    const day = 86_400_000;
    const profile = buildStrategyMonitoringProfile({
      startTime: 0,
      endTime: 5 * day,
      days: [2],
      trades: [
        { exitTimestamp: day, netProfit: 10 },
        { exitTimestamp: 2 * day, netProfit: -6 },
        { exitTimestamp: 3 * day, netProfit: -4 },
        { exitTimestamp: 4 * day, netProfit: 8 },
      ],
    });

    expect(profile.rawCoreExpectancy).toBe(2);
    expect(profile.drawdownEnvelopes).toHaveLength(1);
    expect(profile.drawdownEnvelopes[0]).toMatchObject({
      days: 2,
      maximum: 10,
    });
    expect(profile.drawdownEnvelopes[0].p95).toBeCloseTo(9.4);
    expect(profile).toMatchObject({
      minimumProspectiveClosedTrades: 20,
      minimumParityRatio: 0.95,
      maximumOrderFailureRate: 0.05,
      minimumRegimeCoverage: 0.5,
    });
  });
});

describe('strategy evidence retention', () => {
  it('never expires compact ledgers and protects unverified payloads', () => {
    const now = Date.UTC(2026, 7, 12);
    const plan = planStrategyEvidenceRetention({
      now,
      entries: [
        {
          path: 'ledger.jsonl',
          kind: 'compact_ledger',
          createdAt: 0,
          verified: true,
          aggregated: true,
          bytes: 10,
        },
        {
          path: 'old-runtime.json',
          kind: 'verified_runtime_bundle',
          createdAt: now - 91 * 86_400_000,
          verified: true,
          aggregated: true,
          bytes: 20,
        },
        {
          path: 'unverified.json',
          kind: 'verbose_payload',
          createdAt: 0,
          verified: false,
          aggregated: false,
          bytes: 30,
        },
      ],
    });

    expect(plan.delete.map((entry) => entry.path)).toEqual([
      'old-runtime.json',
    ]);
    expect(plan.keep.map((entry) => entry.path)).toEqual([
      'ledger.jsonl',
      'unverified.json',
    ]);
  });
});
