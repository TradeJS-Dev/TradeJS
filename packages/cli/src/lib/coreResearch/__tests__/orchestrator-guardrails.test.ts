import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeCoreResearch } from '../orchestrator';
import {
  makeDatasetRow,
  makeSpec,
  makeVariant,
  DAY_MS,
  END,
  START,
} from '../__fixtures__/fixtures';

const writeRows = async (filePath: string, rows: unknown[]) => {
  await fs.writeFile(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
};

describe('core research executable robustness guardrails', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-guards-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const analyze = async (params: {
    controlTimestamp: number;
    candidateTimestamp: number;
    terminalRules?: ReturnType<typeof makeSpec>['selection']['terminalRules'];
  }) => {
    const controlPath = path.join(tempRoot, 'control.jsonl');
    const candidatePath = path.join(tempRoot, 'candidate.jsonl');
    await writeRows(controlPath, [
      makeDatasetRow({
        setupIdentity: 'same',
        signalId: 'control',
        timestamp: params.controlTimestamp,
        netProfit: 5,
      }),
    ]);
    await writeRows(candidatePath, [
      makeDatasetRow({
        setupIdentity: 'same',
        signalId: 'candidate',
        timestamp: params.candidateTimestamp,
        netProfit: 6,
      }),
    ]);
    const spec = makeSpec({
      researchId: `guards-${path.basename(tempRoot).toLowerCase()}`,
      variants: [
        makeVariant({ id: 'control', role: 'control', files: [controlPath] }),
        makeVariant({
          id: 'candidate',
          role: 'candidate',
          files: [candidatePath],
        }),
      ],
      window: { start: START, end: END, terminalDays: [1], folds: 2 },
      selection: {
        minimumTrades: 1,
        minimumCadencePerDay: 0.1,
        targetRules: [{ metric: 'pnl', comparison: 'gt' }],
        aggregateRules: [{ metric: 'pnl', comparison: 'gt' }],
        nonTargetRules: [],
        terminalRules: params.terminalRules,
      },
      robustness: {
        bootstrapIterations: 100,
        confidenceLevel: 0.9,
        clusterDays: 1,
        minimumFoldTrades: 0,
        costStressBps: [],
      },
      artifacts: {
        rootDir: path.join(tempRoot, 'artifacts'),
        ledgerPath: path.join(tempRoot, 'artifacts', 'ledger.jsonl'),
      },
    });
    return analyzeCoreResearch(spec);
  };

  it('enforces the terminal cadence floor even when no terminal metric rule is listed', async () => {
    const analyzed = await analyze({
      controlTimestamp: START,
      candidateTimestamp: START,
      terminalRules: [],
    });
    expect(analyzed.result.comparisons[0].selection).toMatchObject({
      passed: false,
      targetPassed: false,
    });
    expect(analyzed.result.comparisons[0].selection.warnings).toContain(
      '1d ALL has fewer than 1 trades',
    );
  });

  it('uses the same infinite-profit-factor semantics in terminal rules as in full-window rules', async () => {
    const terminalSignalTime = END - DAY_MS;
    const analyzed = await analyze({
      controlTimestamp: terminalSignalTime,
      candidateTimestamp: terminalSignalTime,
      terminalRules: [
        {
          metric: 'profitFactor',
          comparison: 'gte',
          relativeToControl: true,
        },
      ],
    });
    expect(analyzed.result.comparisons[0].selection.warnings).not.toContain(
      '1d ALL.profitFactor failed',
    );
    expect(analyzed.result.comparisons[0].selection.passed).toBe(true);
  });
});
