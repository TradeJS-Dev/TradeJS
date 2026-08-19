import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectReleaseEvidenceReferences } from '../lib/strategyRelease';
import { runStrategyReleaseCommand } from '../scripts/strategyRelease';

const SHA = 'a'.repeat(64);
const FP = '1'.repeat(16);

describe('strategy-release command', () => {
  it('writes a deterministic micro-forward decision', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-decision-'),
    );
    const inputPath = path.join(rootDir, 'decision-input.json');
    const outputPath = path.join(rootDir, 'decision.json');
    const chartPath = path.join(rootDir, 'chart.json');
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
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        strategy: 'DoubleTap',
        historicalWindows: [1095, 1460, 1825, 365, 180, 90].map((days) => ({
          days,
          coveredDays: days === 1825 ? 1800 : undefined,
          pnl: 100,
          profitFactor: 1.1,
          long: { pnl: 60, profitFactor: 1.1 },
          short: { pnl: 40, profitFactor: 1.1 },
        })),
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
    );

    const result = await runStrategyReleaseCommand({
      command: 'decide',
      inputPath,
      outputPath,
    });

    expect(result).toMatchObject({
      kind: 'decided',
      action: 'START_MICRO_FORWARD',
      maxLossValue: 1,
      outputPath,
    });
    expect(JSON.parse(await fs.readFile(outputPath, 'utf8'))).toMatchObject({
      action: 'START_MICRO_FORWARD',
      maxLossValue: 1,
    });

    const unresolvedInput = JSON.parse(
      await fs.readFile(inputPath, 'utf8'),
    ) as any;
    unresolvedInput.forwardTest.runtimeTarget = null;
    await fs.writeFile(inputPath, JSON.stringify(unresolvedInput));
    await expect(
      runStrategyReleaseCommand({ command: 'decide', inputPath }),
    ).resolves.toMatchObject({
      action: 'MICRO_FORWARD_READY',
      requiresRuntimeBinding: true,
      blockers: [],
    });

    unresolvedInput.forwardTest.runtimeTarget = {
      userName: 'root',
      deploymentId: 'forward-doubletap',
      accountId: 'bybit-forward',
      strategyName: 'DoubleTap',
      version: 4,
    };
    await fs.writeFile(inputPath, JSON.stringify(unresolvedInput));
    await fs.appendFile(chartPath, '\n');
    await expect(
      runStrategyReleaseCommand({ command: 'decide', inputPath }),
    ).resolves.toMatchObject({
      action: 'FORWARD_BLOCKED',
      blockers: ['FULL_PERIOD_CHART_MISSING'],
    });
  });

  it('creates and verifies an immutable release from a draft', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-cli-'),
    );
    const draftPath = path.join(rootDir, 'draft.json');
    await fs.writeFile(
      draftPath,
      JSON.stringify({
        strategy: 'DoubleTap',
        createdAt: Date.UTC(2026, 7, 12),
        composition: {
          gitSha: 'deadbeef',
          coreConfigSha256: SHA,
          coreExportSha256: SHA,
          gateConfigIdsFingerprint: FP,
          runtimeConfigFingerprint: FP,
          gateFingerprint: FP,
          gateContextFingerprint: FP,
          runtimeContextFingerprint: FP,
          maxLossValue: 10,
          longEnabled: true,
          shortEnabled: true,
        },
        marketWindow: {
          startTime: 1,
          endTime: 2,
          universeSha256: SHA,
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
        evidence: [],
        gates: {
          coreEdgeVerified: false,
          aiGateAddsValue: false,
          currentMarketSuitable: false,
          runtimeParityVerified: false,
          executionModelVerified: false,
        },
        monitoring: {
          minimumProspectiveClosedTrades: 20,
          minimumParityRatio: 0.95,
          maximumOrderFailureRate: 0.05,
          minimumRegimeCoverage: 0.5,
          drawdownEnvelopes: [{ days: 7, p95: 10, maximum: 20 }],
          rawCoreExpectancy: null,
          aiGateExpectancy: null,
          overfitProbability: null,
        },
        summary: 'Evidence does not support release.',
        prospective: {
          status: 'not_started',
          evidenceBooks: ['micro_live'],
          llmComparatorPolicy: 'ai_approved_only',
        },
      }),
    );

    const created = await runStrategyReleaseCommand({
      command: 'create',
      inputPath: draftPath,
      rootDir: path.join(rootDir, 'evidence'),
    });
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') throw new Error('expected create result');

    const verified = await runStrategyReleaseCommand({
      command: 'verify',
      inputPath: created.releasePath,
    });
    expect(verified).toMatchObject({
      kind: 'verified',
      verdict: 'INSUFFICIENT_EVIDENCE',
    });
  });

  it('writes an advisory diagnosis without mutating runtime', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-diagnosis-cli-'),
    );
    const inputPath = path.join(rootDir, 'diagnosis-input.json');
    const outputPath = path.join(rootDir, 'diagnosis.json');
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        strategy: 'DoubleTap',
        compositionId: 'DoubleTap_1',
        createdAt: 1,
        lineageComparable: true,
        parityRatio: 1,
        orderFailureRate: 0,
        observedDrawdown: 5,
        historicalDrawdownP95: 10,
        historicalDrawdownMaximum: 20,
        closedTrades: 30,
        rawCoreExpectancyDelta: 0,
        aiGateAddedValue: 1,
        regimeCoverage: 1,
        overfitProbability: 0,
      }),
    );

    const result = await runStrategyReleaseCommand({
      command: 'diagnose',
      inputPath,
      outputPath,
    });

    expect(result).toMatchObject({
      kind: 'diagnosed',
      verdict: 'EXPECTED_DRAWDOWN',
      outputPath,
    });
    expect(JSON.parse(await fs.readFile(outputPath, 'utf8'))).toMatchObject({
      verdict: 'EXPECTED_DRAWDOWN',
    });
  });

  it('verifies evidence files instead of trusting the draft flag', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-evidence-'),
    );
    const evidencePath = path.join(rootDir, 'core.json');
    const draftPath = path.join(rootDir, 'draft.json');
    await fs.writeFile(evidencePath, '{"verified":true}\n');
    const wrongSha = 'f'.repeat(64);
    const draft = {
      strategy: 'DoubleTap',
      createdAt: 1,
      composition: {
        gitSha: 'deadbeef',
        coreConfigSha256: SHA,
        coreExportSha256: SHA,
        gateConfigIdsFingerprint: FP,
        runtimeConfigFingerprint: FP,
        gateFingerprint: FP,
        gateContextFingerprint: FP,
        runtimeContextFingerprint: FP,
        maxLossValue: 10,
        longEnabled: true,
        shortEnabled: true,
      },
      marketWindow: {
        startTime: 1,
        endTime: 2,
        universeSha256: SHA,
        symbols: 507,
        cacheOnly: true,
        terminalDays: [180, 90, 30, 7],
      },
      researchBudget: {
        hypothesisFamilies: 1,
        maximumVariantsPerFamily: 1,
        isolatedLongFinalists: 0,
        aiGateTuningRounds: 0,
      },
      evidence: [
        {
          kind: 'core_research',
          artifactId: 'core',
          path: evidencePath,
          sha256: wrongSha,
          verified: true,
        },
      ],
      gates: {
        coreEdgeVerified: true,
        aiGateAddsValue: false,
        currentMarketSuitable: false,
        runtimeParityVerified: false,
        executionModelVerified: false,
      },
      monitoring: {
        minimumProspectiveClosedTrades: 20,
        minimumParityRatio: 0.95,
        maximumOrderFailureRate: 0.05,
        minimumRegimeCoverage: 0.5,
        drawdownEnvelopes: [{ days: 7, p95: 10, maximum: 20 }],
        rawCoreExpectancy: null,
        aiGateExpectancy: null,
        overfitProbability: null,
      },
      summary: 'Must not trust the draft.',
      prospective: {
        status: 'not_started',
        evidenceBooks: ['micro_live'],
        llmComparatorPolicy: 'ai_approved_only',
      },
    };
    await fs.writeFile(draftPath, JSON.stringify(draft));

    await expect(
      runStrategyReleaseCommand({
        command: 'create',
        inputPath: draftPath,
        rootDir: path.join(rootDir, 'evidence'),
      }),
    ).rejects.toThrow('checksum mismatch');
  });

  it('rejects checksum-valid evidence with the wrong semantic contract', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-semantic-evidence-'),
    );
    const evidencePath = path.join(rootDir, 'core.json');
    const content = '{"verified":true}\n';
    await fs.writeFile(evidencePath, content);
    const sha256 = createHash('sha256').update(content).digest('hex');

    await expect(
      collectReleaseEvidenceReferences([
        {
          kind: 'core_research',
          artifactId: 'not-core-research',
          path: evidencePath,
          sha256,
          verified: true,
        },
      ]),
    ).rejects.toThrow('does not match core_research');
  });

  it('rejects a core result that is not bound by its completed bundle manifest', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-core-bundle-'),
    );
    const evidencePath = path.join(rootDir, 'result.json');
    const content = JSON.stringify({
      schema: 'tradejs-core-research-result/v1',
      researchId: 'core-release',
      stage: 'isolated_long',
      specSha256: 'b'.repeat(64),
      variants: [],
      comparisons: [],
      evidence: {},
    });
    await fs.writeFile(evidencePath, content);
    const sha256 = createHash('sha256').update(content).digest('hex');

    await expect(
      collectReleaseEvidenceReferences([
        {
          kind: 'core_research',
          artifactId: 'unbound-core-result',
          path: evidencePath,
          sha256,
          verified: false,
        },
      ]),
    ).rejects.toThrow('completed core research bundle');
  });

  it('derives gate lineage and rejects a draft bound to another export', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-gate-lineage-'),
    );
    const evidencePath = path.join(rootDir, 'gate.json');
    const content = JSON.stringify({
      run: {
        strategy: 'DoubleTap',
        mode: 'local-deterministic',
        directionPolicy: 'long_only',
      },
      outcome: {
        expectancyDelta: 1,
        approvedRisk: { totalProfit: 1, profitFactor: 2 },
      },
      byDirection: [
        { direction: 'LONG', summary: { approved: 1 } },
        { direction: 'SHORT', summary: { approved: 0 } },
      ],
      research: {
        lineage: {
          gitSha: 'deadbeef',
          gitDirty: false,
          directionPolicy: 'long_only',
          gateFingerprint: FP,
          configIdsFingerprint: FP,
          contextFingerprint: FP,
          sourceSha256s: ['b'.repeat(64)],
        },
        terminalWindows: [
          {
            complete: true,
            outcome: { approved: 1, approvedRisk: { totalProfit: 1 } },
            byDirection: [
              { direction: 'LONG', summary: { approved: 1 } },
              { direction: 'SHORT', summary: { approved: 0 } },
            ],
          },
        ],
      },
    });
    await fs.writeFile(evidencePath, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const [evidence] = await collectReleaseEvidenceReferences([
      {
        kind: 'ai_gate',
        artifactId: 'gate',
        path: evidencePath,
        sha256,
        verified: false,
      },
    ]);

    expect(evidence).toMatchObject({
      verified: true,
      lineage: {
        strategy: 'DoubleTap',
        gitSha: 'deadbeef',
        gitDirty: false,
        gateConfigIdsFingerprint: FP,
        gateFingerprint: FP,
        gateContextFingerprint: FP,
        directionPolicy: 'long_only',
        sourceSha256s: ['b'.repeat(64)],
      },
      releaseAssertions: { aiGateAddsValue: true },
    });
  });

  it('fails AI release assertions when directional evidence is incomplete', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-gate-directions-'),
    );
    const evidencePath = path.join(rootDir, 'gate.json');
    const content = JSON.stringify({
      run: { strategy: 'DoubleTap', mode: 'local-deterministic' },
      outcome: {
        expectancyDelta: 1,
        approvedRisk: { totalProfit: 1, profitFactor: 2 },
      },
      byDirection: [{ direction: 'LONG', summary: { approved: 1 } }],
      research: {
        lineage: {
          gitSha: 'deadbeef',
          gitDirty: false,
          gateFingerprint: FP,
          configIdsFingerprint: FP,
          contextFingerprint: FP,
          sourceSha256s: ['b'.repeat(64)],
        },
        terminalWindows: [
          {
            complete: true,
            outcome: { approved: 1, approvedRisk: { totalProfit: 1 } },
            byDirection: [{ direction: 'LONG', summary: { approved: 1 } }],
          },
        ],
      },
    });
    await fs.writeFile(evidencePath, content);
    const sha256 = createHash('sha256').update(content).digest('hex');

    const [evidence] = await collectReleaseEvidenceReferences([
      {
        kind: 'ai_gate',
        artifactId: 'gate-without-short',
        path: evidencePath,
        sha256,
        verified: false,
      },
    ]);

    expect(evidence.releaseAssertions).toEqual({ aiGateAddsValue: false });
  });

  it('rejects a self-declared LONG-only gate that still approves SHORT rows', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-release-gate-policy-'),
    );
    const evidencePath = path.join(rootDir, 'gate.json');
    const byDirection = [
      { direction: 'LONG', summary: { approved: 10 } },
      { direction: 'SHORT', summary: { approved: 1 } },
    ];
    const content = JSON.stringify({
      run: {
        strategy: 'RelativeRotation',
        mode: 'local-deterministic',
        directionPolicy: 'long_only',
      },
      outcome: {
        expectancyDelta: 1,
        approvedRisk: { totalProfit: 10, profitFactor: 1.2 },
      },
      byDirection,
      research: {
        lineage: {
          gitSha: 'deadbeef',
          gitDirty: false,
          directionPolicy: 'long_only',
          gateFingerprint: FP,
          configIdsFingerprint: FP,
          contextFingerprint: FP,
          sourceSha256s: ['b'.repeat(64)],
        },
        terminalWindows: [
          {
            complete: true,
            outcome: { approved: 11, approvedRisk: { totalProfit: 10 } },
            byDirection,
          },
        ],
      },
    });
    await fs.writeFile(evidencePath, content);
    const [evidence] = await collectReleaseEvidenceReferences([
      {
        kind: 'ai_gate',
        artifactId: 'false-long-only',
        path: evidencePath,
        sha256: createHash('sha256').update(content).digest('hex'),
        verified: false,
      },
    ]);

    expect(evidence.releaseAssertions).toEqual({ aiGateAddsValue: false });
  });

  it('creates a historical monitoring profile from one core variant', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-profile-cli-'),
    );
    const inputPath = path.join(rootDir, 'trades.jsonl');
    const outputPath = path.join(rootDir, 'profile.json');
    const day = 86_400_000;
    await fs.writeFile(
      inputPath,
      [
        { variantId: 'control', exitTimestamp: day, netProfit: 10 },
        { variantId: 'candidate', exitTimestamp: day, netProfit: 100 },
        { variantId: 'control', exitTimestamp: 2 * day, netProfit: -5 },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n'),
    );

    const result = await runStrategyReleaseCommand({
      command: 'profile',
      inputPath,
      outputPath,
      variantId: 'control',
      startTime: 0,
      endTime: 3 * day,
      days: [2],
    });

    expect(result).toMatchObject({
      kind: 'profiled',
      trades: 2,
      outputPath,
      profile: { rawCoreExpectancy: 2.5 },
    });
    expect(JSON.parse(await fs.readFile(outputPath, 'utf8'))).toMatchObject({
      rawCoreExpectancy: 2.5,
    });
  });

  it('keeps retention advisory unless apply is explicit', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'strategy-retention-cli-'),
    );
    const inventoryPath = path.join(rootDir, 'inventory.json');
    const oldPath = path.join(rootDir, 'old.json');
    await fs.writeFile(oldPath, 'old');
    await fs.writeFile(
      inventoryPath,
      JSON.stringify({
        now: 100 * 86_400_000,
        entries: [
          {
            path: oldPath,
            kind: 'verified_runtime_bundle',
            createdAt: 0,
            verified: true,
            aggregated: true,
            bytes: 3,
          },
        ],
      }),
    );

    const dryRun = await runStrategyReleaseCommand({
      command: 'retention',
      inputPath: inventoryPath,
      apply: false,
    });
    expect(dryRun).toMatchObject({
      kind: 'retention',
      applied: false,
      deleteCount: 1,
    });
    await expect(fs.readFile(oldPath, 'utf8')).resolves.toBe('old');

    const applied = await runStrategyReleaseCommand({
      command: 'retention',
      inputPath: inventoryPath,
      apply: true,
    });
    expect(applied).toMatchObject({ applied: true, deleteCount: 1 });
    await expect(fs.access(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
