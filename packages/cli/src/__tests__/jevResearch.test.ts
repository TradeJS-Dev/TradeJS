/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jevHash, writeJevArtifact } from '@tradejs/infra/jev';
import { JEV_QUESTIONS } from '@tradejs/node/jev';
import type {
  AiDatasetRow,
  JevInput,
  JevRecord,
  JevResponse,
} from '@tradejs/types';
import { runJevResearch } from '../lib/jevResearch';

const provider = {
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-1.13.0',
};
const input: JevInput = {
  schema: 'tradejs-jev-input/v4',
  strategy: 'TestPattern',
  symbol: 'TESTUSDT',
  interval: '15',
  timestamp: 1000,
  direction: 'LONG',
  features: { 'signal.direction': 'LONG', 'signal.validLevels': true },
  provenance: {},
  missing: { 'geometry.figures': 'no_geometry' },
  questions: ['structure', 'participation', 'timing', 'geometry'],
  geometryStatus: 'absent',
};
const response: JevResponse = {
  model: provider.model,
  answers: Object.fromEntries(
    input.questions.map((key) => [
      key,
      {
        type: 'score',
        score: 3,
        confidence: 1,
        probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 },
      },
    ]),
  ) as JevResponse['answers'],
};
const inputHash = jevHash(input);
const questionsHash = jevHash(JEV_QUESTIONS);
const id = jevHash({ inputHash, questionsHash, provider });
const record: JevRecord = {
  schema: 'tradejs-jev-record/v4',
  id,
  inputHash,
  questionsHash,
  provider,
  input,
  response,
  scores: {
    structure: 0.75,
    participation: 0.75,
    timing: 0.75,
    geometry: 0.75,
  },
  createdAt: '2026-10-01T00:00:00.000Z',
  elapsedMs: 1,
};
const row = (recordId?: string): AiDatasetRow =>
  ({
    signalId: 'signal-1',
    strategyName: 'TestPattern',
    symbol: 'TESTUSDT',
    direction: 'LONG',
    timestamp: input.timestamp,
    profit: 1,
    payload: {
      signal: {},
      figures: {},
      indicators: {},
      additionalIndicators: {},
    },
    ...(recordId ? { assessment: { recordId, inputHash, questionsHash } } : {}),
  }) as unknown as AiDatasetRow;

describe('Jev research evaluate', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-research-'));
  });
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const evaluate = async (projectRoot: string, datasetRow: AiDatasetRow) => {
    await fs.writeFile(
      path.join(projectRoot, 'input.jsonl'),
      `${JSON.stringify(datasetRow)}\n`,
    );
    return runJevResearch({
      action: 'evaluate',
      projectRoot,
      userName: 'root',
      input: 'input.jsonl',
      out: 'study.jsonl',
      recordsDir: 'jev',
    });
  };

  it('rejects an AI-only row before creating an output file', async () => {
    await expect(evaluate(projectRoot, row())).rejects.toThrow(
      'Run the backtest with --ai --jev',
    );
    await expect(
      fs.access(path.join(projectRoot, 'study.jsonl')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires the original recording directory', async () => {
    await expect(evaluate(projectRoot, row(id))).rejects.toThrow(
      'is missing from --jevRecordsDir',
    );
    await expect(
      fs.access(path.join(projectRoot, 'study.jsonl')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replays a matching record without asking the provider', async () => {
    await writeJevArtifact(
      path.join(projectRoot, 'jev', 'records', `${id}.json`),
      record,
    );
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('provider must not be called'));
    await expect(evaluate(projectRoot, row(id))).resolves.toMatchObject({
      rows: 1,
    });
    const study = JSON.parse(
      (await fs.readFile(path.join(projectRoot, 'study.jsonl'), 'utf8')).trim(),
    );
    expect(study.record.id).toBe(id);
    expect(study.profit).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
});
