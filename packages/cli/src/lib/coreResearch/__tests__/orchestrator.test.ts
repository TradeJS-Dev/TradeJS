import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiDatasetRow, Direction } from '@tradejs/types';
import {
  readCoreResearchLedger,
  sha256Json,
  verifyCoreResearchArtifacts,
  verifyCoreResearchLedger,
  writeCoreResearchStageIndex,
} from '../io';
import {
  analyzeCoreResearch,
  validateCoreResearchRunCommand,
} from '../orchestrator';
import { collectReleaseEvidenceReferences } from '../../strategyRelease';
import type { CoreResearchSpec } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);
const END = START + 10 * DAY_MS;

const makeRow = (params: {
  signalId: string;
  setupIdentity: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  netProfit: number;
  runId: string;
  trend?: 'bull' | 'bear' | 'neutral';
}): AiDatasetRow => ({
  signalId: params.signalId,
  strategyName: 'FixtureStrategy',
  symbol: params.symbol,
  direction: params.direction,
  timestamp: params.timestamp,
  profit: params.netProfit,
  configId: 'fixture',
  backtestRunId: params.runId,
  research: {
    schema: 'tradejs-core-research-row/v1',
    setupIdentity: params.setupIdentity,
    setupIdentitySource: 'strategy-context',
  },
  payload: {
    signal: {
      symbol: params.symbol,
      signalId: params.signalId,
      interval: '15',
      direction: params.direction,
      timestamp: params.timestamp,
      strategy: 'FixtureStrategy',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      baseContext: {
        regime: {
          trend: { bias: params.trend ?? 'bull' },
          volatility: { state: 'normal' },
        },
        relative: {
          btcAltRegime: { regime: 'risk_on' },
        },
        derivatives: {
          summary: { pressure: 'neutral' },
        },
      },
    },
  },
  tradeResult: {
    signalId: params.signalId,
    direction: params.direction,
    qty: 1,
    closedQty: 1,
    entryTimestamp: params.timestamp + 1,
    exitTimestamp: params.timestamp + DAY_MS / 2,
    exitReason: params.netProfit > 0 ? 'take_profit' : 'stop_loss',
    requestedEntryPrice: 100,
    entryPrice: 100,
    requestedExitPrice: params.netProfit > 0 ? 110 : 90,
    exitPrice: params.netProfit > 0 ? 110 : 90,
    grossProfit: params.netProfit + 2,
    netProfit: params.netProfit,
    openFee: 1,
    closeFee: 1,
    fundingFee: null,
    totalFee: 2,
    entrySlippagePrice: 0,
    entrySlippageBps: 0,
    entryBaseSlippageBps: 0,
    entrySpreadBps: 0,
    entrySpreadSlippageBps: 0,
    entryMarketImpactBps: 0,
    entryDelayRiskBps: null,
    entrySlippageCost: 0,
    exitSlippagePrice: 0,
    exitSlippageBps: 0,
    exitBaseSlippageBps: 0,
    exitSpreadBps: 0,
    exitSpreadSlippageBps: 0,
    exitMarketImpactBps: 0,
    exitDelayRiskBps: null,
    exitSlippageCost: 0,
    totalSlippageCost: 0,
  },
});

const writeJsonl = async (filePath: string, rows: AiDatasetRow[]) => {
  await fs.writeFile(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
};

describe('core research orchestrator', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-research-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('builds immutable ALL/LONG/SHORT, matching, regime, robustness, report, and ledger artifacts', async () => {
    const controlPath = path.join(tempRoot, 'control.jsonl');
    const candidatePath = path.join(tempRoot, 'candidate.jsonl');
    const tracePath = path.join(tempRoot, 'candidate-trace.jsonl');
    await writeJsonl(controlPath, [
      makeRow({
        signalId: 'control-a',
        setupIdentity: 'setup-a',
        symbol: 'AAAUSDT',
        direction: 'LONG',
        timestamp: START + DAY_MS,
        netProfit: -10,
        runId: 'control-run',
      }),
      makeRow({
        signalId: 'control-b',
        setupIdentity: 'setup-b',
        symbol: 'BBBUSDT',
        direction: 'SHORT',
        timestamp: START + 2 * DAY_MS,
        netProfit: 5,
        runId: 'control-run',
        trend: 'bear',
      }),
    ]);
    await writeJsonl(candidatePath, [
      makeRow({
        signalId: 'candidate-a',
        setupIdentity: 'setup-a',
        symbol: 'AAAUSDT',
        direction: 'LONG',
        timestamp: START + DAY_MS,
        netProfit: 10,
        runId: 'candidate-run',
      }),
      makeRow({
        signalId: 'candidate-b',
        setupIdentity: 'setup-b',
        symbol: 'BBBUSDT',
        direction: 'SHORT',
        timestamp: START + 2 * DAY_MS,
        netProfit: 5,
        runId: 'candidate-run',
        trend: 'bear',
      }),
      makeRow({
        signalId: 'candidate-c',
        setupIdentity: 'setup-c',
        symbol: 'CCCUSDT',
        direction: 'LONG',
        timestamp: START + 7 * DAY_MS,
        netProfit: 4,
        runId: 'candidate-run',
      }),
      makeRow({
        signalId: 'candidate-outside-window',
        setupIdentity: 'setup-outside-window',
        symbol: 'AAAUSDT',
        direction: 'LONG',
        timestamp: END + DAY_MS,
        netProfit: 1_000,
        runId: 'candidate-run',
      }),
    ]);
    await fs.writeFile(
      tracePath,
      `${JSON.stringify({
        schema: 'tradejs-core-research-trace/v1',
        event: 'skip_summary',
        timestamp: END,
        strategy: 'FixtureStrategy',
        symbol: 'AAAUSDT',
        skipCounts: { NO_PATTERN: 7 },
      })}\n`,
      'utf8',
    );
    const symbols = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'];
    const spec: CoreResearchSpec = {
      schema: 'tradejs-core-research/v1',
      researchId: 'fixture-research',
      stage: 'screen',
      strategy: 'FixtureStrategy',
      createdAt: '2026-01-01T00:00:00.000Z',
      hypothesis: {
        family: 'fixture-family',
        claim: 'Improve LONG economics.',
        mechanism: 'Replace one losing LONG outcome and add one causal setup.',
        target: 'LONG',
      },
      universe: { symbols, sha256: sha256Json(symbols) },
      window: { start: START, end: END, terminalDays: [5], folds: 2 },
      execution: {
        connector: 'Test',
        interval: '15m',
        maxLossValue: 10,
      },
      variants: [
        {
          id: 'control',
          label: 'Control',
          role: 'control',
          configName: 'FixtureStrategy:control',
          resolvedConfig: { MODE: 'control', MAX_LOSS_VALUE: 10 },
          configSha256: sha256Json({ MODE: 'control', MAX_LOSS_VALUE: 10 }),
          files: [controlPath],
        },
        {
          id: 'candidate',
          label: 'Candidate',
          role: 'candidate',
          configName: 'FixtureStrategy:candidate',
          resolvedConfig: { MODE: 'candidate', MAX_LOSS_VALUE: 10 },
          configSha256: sha256Json({ MODE: 'candidate', MAX_LOSS_VALUE: 10 }),
          files: [candidatePath],
          traceFiles: [tracePath],
        },
      ],
      selection: {
        minimumTrades: 1,
        minimumCadencePerDay: 0.05,
        targetRules: [
          { metric: 'pnl', comparison: 'gt', relativeToControl: true },
          {
            metric: 'pnlPerTrade',
            comparison: 'gt',
            relativeToControl: true,
          },
        ],
        aggregateRules: [
          { metric: 'pnl', comparison: 'gt', relativeToControl: true },
          {
            metric: 'realizedMaxDrawdown',
            comparison: 'lte',
            relativeToControl: true,
          },
        ],
        nonTargetRules: [
          { metric: 'pnl', comparison: 'gte', relativeToControl: true },
        ],
        costStressRules: [
          { metric: 'pnl', comparison: 'gt', relativeToControl: true },
        ],
      },
      robustness: {
        bootstrapIterations: 200,
        confidenceLevel: 0.9,
        clusterDays: 1,
        minimumFoldTrades: 1,
        costStressBps: [10],
      },
      artifacts: {
        rootDir: path.join(tempRoot, 'artifacts'),
        ledgerPath: path.join(tempRoot, 'artifacts', 'trials.jsonl'),
      },
      lineage: { gitSha: 'fixture-git-sha' },
    };

    const analyzed = await analyzeCoreResearch(spec);
    const comparison = analyzed.result.comparisons[0];
    const candidate = analyzed.result.variants.find(
      (variant) => variant.variant.id === 'candidate',
    );
    expect(comparison.matched).toBe(2);
    expect(comparison.controlOnly).toBe(0);
    expect(comparison.candidateOnly).toBe(1);
    expect(comparison.cohorts.ALL.candidate.pnlPerTrade).toBeCloseTo(19 / 3);
    expect(comparison.cohorts.LONG.candidate.pnlPerTrade).toBe(7);
    expect(comparison.cohorts.SHORT.candidate.pnlPerTrade).toBe(5);
    expect(comparison.cohorts.LONG.candidate).toMatchObject({
      averageWin: 7,
      averageLoss: null,
      medianPnl: 7,
      maximumConsecutiveLosses: 0,
    });
    expect(comparison.selection).toMatchObject({
      passed: true,
      targetPassed: true,
      aggregatePassed: true,
      nonTargetPassed: true,
    });
    expect(candidate?.regimes['bull|normal|risk_on|neutral'].ALL.pnl).toBe(14);
    expect(candidate?.full.cohorts.ALL.trades).toBe(3);
    expect(analyzed.result.evidence).toMatchObject({
      screen: 'present',
      isolatedLong: 'missing',
    });
    expect(analyzed.result.lineage).toEqual({ gitSha: 'fixture-git-sha' });
    expect(candidate?.traceFunnel.skipCounts).toEqual({ NO_PATTERN: 7 });
    expect(candidate?.costStress).toHaveLength(1);
    await expect(
      fs.readFile(analyzed.paths.reportPath, 'utf8'),
    ).resolves.toContain('Avg PnL/trade');
    await expect(
      fs.readFile(analyzed.paths.matchesPath, 'utf8'),
    ).resolves.toContain('setup-a#1');
    await expect(verifyCoreResearchArtifacts(spec)).resolves.toMatchObject({
      researchId: 'fixture-research',
      artifacts: 6,
    });
    const [releaseEvidence] = await collectReleaseEvidenceReferences([
      {
        kind: 'core_research',
        artifactId: 'fixture-research-result',
        path: analyzed.paths.resultPath,
        sha256: analyzed.artifactHashes['result.json'],
        verified: false,
      },
    ]);
    expect(releaseEvidence).toMatchObject({
      verified: true,
      lineage: {
        strategy: 'FixtureStrategy',
        gitSha: 'fixture-git-sha',
        gitDirty: false,
        coreConfigSha256: spec.variants[1].configSha256,
        maxLossValue: 10,
      },
      releaseAssertions: {
        coreEdgeVerified: false,
        currentMarketSuitable: false,
      },
    });
    expect(releaseEvidence.lineage?.sourceSha256s).toEqual([
      candidate?.files[0].sha256,
    ]);
    await expect(
      fs.readFile(analyzed.paths.tradesPath, 'utf8'),
    ).resolves.not.toContain('candidate-outside-window');
    const ledger = await readCoreResearchLedger(spec.artifacts.ledgerPath);
    expect(verifyCoreResearchLedger(ledger)).toMatchObject({ records: 3 });
    await expect(
      writeCoreResearchStageIndex(spec.artifacts.rootDir),
    ).resolves.toMatchObject({
      families: [
        {
          family: 'fixture-family',
          experiments: [
            expect.objectContaining({
              researchId: 'fixture-research',
              stage: 'screen',
              passedCandidates: ['candidate'],
            }),
          ],
        },
      ],
    });
    await expect(analyzeCoreResearch(spec)).rejects.toThrow(
      'already completed and immutable',
    );
  });

  it('detects tampering in the append-only hash-chain ledger', async () => {
    const ledgerPath = path.join(tempRoot, 'ledger.jsonl');
    await fs.writeFile(
      ledgerPath,
      `${JSON.stringify({
        schema: 'tradejs-core-research-ledger/v1',
        sequence: 1,
        recordedAt: '2026-01-01T00:00:00.000Z',
        researchId: 'tampered',
        event: 'prepared',
        specSha256: 'bad',
        artifactHashes: {},
        previousHash: null,
        recordHash: 'forged',
      })}\n`,
      'utf8',
    );
    const records = await readCoreResearchLedger(ledgerPath);
    expect(() => verifyCoreResearchLedger(records)).toThrow(
      'invalid record hash',
    );
  });

  it('rejects non-causal or drifted run commands before a backtest starts', () => {
    const symbols = ['AAAUSDT', 'BBBUSDT'];
    const base = {
      schema: 'tradejs-core-research/v1',
      researchId: 'command-preflight',
      stage: 'screen',
      strategy: 'FixtureStrategy',
      createdAt: '2026-01-01T00:00:00.000Z',
      hypothesis: {
        family: 'fixture-family',
        claim: 'Test command preflight.',
        mechanism: 'Exact immutable command.',
        target: 'ALL',
      },
      universe: { symbols, sha256: sha256Json(symbols) },
      window: { start: START, end: END, terminalDays: [5], folds: 2 },
      execution: { connector: 'Test', interval: '15', maxLossValue: 10 },
      selection: {
        minimumTrades: 1,
        minimumCadencePerDay: 0,
        targetRules: [],
        aggregateRules: [],
        nonTargetRules: [],
      },
      robustness: {
        bootstrapIterations: 100,
        confidenceLevel: 0.9,
        clusterDays: 1,
        minimumFoldTrades: 1,
        costStressBps: [],
      },
      artifacts: { rootDir: tempRoot, ledgerPath: path.join(tempRoot, 'l') },
    } satisfies Omit<CoreResearchSpec, 'variants'>;
    const variant: CoreResearchSpec['variants'][number] = {
      id: 'control',
      label: 'Control',
      role: 'control',
      configName: 'FixtureStrategy:control',
      resolvedConfig: { MODE: 'control' },
      configSha256: sha256Json({ MODE: 'control' }),
      files: [],
      command: [
        'yarn',
        'backtest',
        '-c',
        'FixtureStrategy:control',
        '--ai',
        '--fast',
        '--cacheOnly',
        '--startTime',
        String(START),
        '--endTime',
        String(END),
        '-t',
        symbols.join(','),
      ],
    };
    expect(() =>
      validateCoreResearchRunCommand({
        spec: {
          ...base,
          variants: [
            variant,
            { ...variant, id: 'candidate', role: 'candidate' },
          ],
        },
        variant,
      }),
    ).not.toThrow();
    expect(() =>
      validateCoreResearchRunCommand({
        spec: {
          ...base,
          variants: [
            variant,
            { ...variant, id: 'candidate', role: 'candidate' },
          ],
        },
        variant: {
          ...variant,
          command: variant.command?.filter((token) => token !== '--cacheOnly'),
        },
      }),
    ).toThrow('--cacheOnly');
  });
});
