import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildStrategyLiveDiagnosis,
  buildStrategyLiveDiagnosisFromScorecard,
  buildStrategyMonitoringProfile,
  createStrategyEvidenceMarkerEnvelope,
  createStrategyReleaseManifest,
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
const matchingRuntimeLineage = {
  complete: true,
  conflicts: false,
  gitSha: 'deadbeef',
  gitDirty: false,
  gateFingerprint: SHA_B,
  configFingerprint: SHA_A,
  contextFingerprint: SHA_C,
  maxLossValue: 10,
};

const buildRelease = () =>
  createStrategyReleaseManifest({
    strategy: 'DoubleTap',
    createdAt: Date.UTC(2026, 7, 12, 12),
    composition: {
      gitSha: 'deadbeef',
      coreConfigFingerprint: SHA_A,
      gateFingerprint: SHA_B,
      contextFingerprint: SHA_C,
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
        releaseAssertions: { aiGateAddsValue: true },
      },
      {
        kind: 'runtime_parity',
        artifactId: 'parity-1',
        path: 'output/parity-1.json',
        sha256: SHA_C,
        verified: true,
        releaseAssertions: { runtimeParityVerified: true },
      },
      {
        kind: 'execution_calibration',
        artifactId: 'execution-1',
        path: 'output/execution-1.json',
        sha256: SHA_D,
        verified: true,
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
          coreConfigFingerprint: ready.composition.coreConfigFingerprint,
          gateFingerprint: ready.composition.gateFingerprint,
          contextFingerprint: ready.composition.contextFingerprint,
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
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest: buildRelease(),
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: matchingRuntimeLineage,
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

  it('uses the release sample and parity thresholds for diagnosis', () => {
    const manifest = buildRelease();
    manifest.monitoring.minimumProspectiveClosedTrades = 40;
    manifest.monitoring.minimumParityRatio = 0.99;
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest,
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 0.98, lineageReason: null },
        lineage: matchingRuntimeLineage,
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
    const diagnosis = buildStrategyLiveDiagnosisFromScorecard({
      manifest: buildRelease(),
      scorecard: {
        generatedAt: 100,
        parity: { ratio: 1, lineageReason: null },
        lineage: { ...matchingRuntimeLineage, contextFingerprint: SHA_D },
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
