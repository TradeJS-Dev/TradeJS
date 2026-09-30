/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildJevInput,
  evaluateJevInput,
  JEV_QUESTIONS,
  assessSignalWithJev,
} from '../jev';
import { questionsForJevInput } from '../jevInput';
import { trainJevGate, compareJevGate } from '../jevTraining';
import { jevHash, jevFileHash } from '@tradejs/infra/jev';
import { decideJev, parseJevConfig } from '@tradejs/core/jev';
import {
  shouldExecuteEntryDecision,
  getEntrySkipReason,
} from '../strategy/runtimeEntryPolicy';
import type {
  Signal,
  JevRecord,
  JevResponse,
  JevScores,
  JevStudyRow,
} from '@tradejs/types';

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: jest.fn(async () => ({
    JEV_API_KEY: 'test-key',
    JEV_API_ENDPOINT: 'https://api.typesafe.ai/v1/systemone',
    JEV_MODEL: 'jev-1.13.0',
  })),
}));

const provider = {
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-1.13.0',
};
const makeSignal = (timestamp = 1000): Signal =>
  ({
    strategy: 'TestPattern',
    symbol: 'TESTUSDT',
    interval: '15',
    direction: 'LONG',
    timestamp,
    signalId: `signal-${timestamp}`,
    prices: {
      currentPrice: 100,
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 2,
    },
    figures: {
      lines: [
        {
          kind: 'support',
          points: [
            { timestamp: timestamp - 2, value: 98 },
            { timestamp: timestamp - 1, value: 99 },
          ],
        },
      ],
    },
    indicators: {},
    additionalIndicators: {
      baseContext: {
        raw: { volatility: { atr: 2 } },
        regime: { trend: { bias: 'bull', priceDistanceToMaFastAtr: 0.5 } },
        structure: { swing: { bias: 'bull' } },
        participation: { volume: { volumeRel20: 2 } },
        gateFeatures: { scores: { totalContext: 90 } },
      },
    },
  }) as unknown as Signal;
const makeResponse = (score = 3): JevResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    ['structure', 'participation', 'timing'].map((key) => [
      key,
      {
        type: 'score',
        score,
        confidence: 1,
        probabilities: Object.fromEntries(
          [0, 1, 2, 3, 4].map((value) => [value, value === score ? 1 : 0]),
        ),
      },
    ]),
  ) as JevResponse['answers'],
});

const makeRows = () =>
  Array.from({ length: 100 }, (_, index): JevStudyRow => {
    const input = buildJevInput(makeSignal(1000 + index));
    input.features = { momentum: index % 2, missing: index % 3 ? null : 2 };
    const score = index % 2 ? 4 : 0;
    const inputHash = jevHash(input),
      questionsHash = jevHash(questionsForJevInput(input));
    const record: JevRecord = {
      schema: 'tradejs-jev-record/v2',
      id: jevHash({ inputHash, questionsHash, provider }),
      inputHash,
      questionsHash,
      provider,
      input,
      response: makeResponse(score),
      scores: {
        structure: score / 4,
        participation: score / 4,
        timing: score / 4,
        geometry: null,
      },
      createdAt: '2026-09-29',
      elapsedMs: 1,
    };
    return {
      schema: 'tradejs-jev-study/v2',
      signalId: `s${index}`,
      record,
      profit: score ? 1 : -1,
      baselineAllowed: true,
    };
  });

describe('Jev shared assessment and local training', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-jev-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('sends only selected facts and accepts bounded strategy evidence', () => {
    const signal = makeSignal();
    signal.additionalIndicators!.profit = 999;
    signal.additionalIndicators!.baseContext.structure.outcome = 999;
    signal.figures.lines![0].points = Array.from({ length: 8 }, (_, index) => ({
      timestamp: 900 + index,
      value: 98,
    }));
    const input = buildJevInput(signal);
    expect(JSON.stringify(input)).not.toMatch(
      /999|totalContext|gateFeatures|outcome/,
    );
    expect(input.features['geometry.pointCount']).toBeUndefined();
    expect(input.features['signal.stopDistanceAtr']).toBe(1);
    expect(input.questions).toEqual(['structure', 'participation', 'timing']);
    expect(Object.keys(input.features).length).toBeLessThan(20);
    signal.additionalIndicators!.jevEvidence = {
      version: 'setup-v1',
      knownAt: signal.timestamp,
      facts: { confirmationCount: 2 },
      geometry: { normalizedWidthAtr: 1.5 },
    };
    const extended = buildJevInput(signal);
    expect(extended.features['setup.confirmationCount']).toBe(2);
    expect(extended.questions).toContain('geometry');
    signal.figures.lines![0].points[0].timestamp = 1001;
    expect(buildJevInput(signal).geometryStatus).toBe('invalid');
  });

  it('reuses one paid answer for equivalent states at different signal times', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeResponse(),
    } as Response);
    const config = {
      source: 'provider' as const,
      mode: 'gate' as const,
      provider,
    };
    const first = await evaluateJevInput({
      input: buildJevInput(makeSignal(1000)),
      config,
      userName: 'root',
      projectRoot: dir,
    });
    const second = await evaluateJevInput({
      input: buildJevInput(makeSignal(2000)),
      config,
      userName: 'root',
      projectRoot: dir,
    });
    expect(first.record?.id).not.toBe(second.record?.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state).not.toHaveProperty('timestamp');
    expect(body.state).not.toHaveProperty('symbol');
  });

  it('records once, replays without a network call and invalidates changed inputs', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeResponse(),
    } as Response);
    const input = buildJevInput(makeSignal());
    const common = { input, userName: 'root', projectRoot: dir };
    const first = await evaluateJevInput({
      ...common,
      config: { source: 'provider', mode: 'gate', provider },
    });
    const replay = await evaluateJevInput({
      ...common,
      config: { source: 'recorded', mode: 'gate', provider },
    });
    expect(replay.record).toEqual(first.record);
    expect(replay.assessment.allowed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      evaluateJevInput({
        ...common,
        input: { ...input, timestamp: 2000 },
        config: { source: 'recorded', mode: 'gate', provider },
      }),
    ).rejects.toThrow('Missing Jev recording');
  });

  it('blocks failed runtime assessments and fails incomplete backtests', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('private-token'));
    const signal = makeSignal();
    const args = {
      signal,
      config: { source: 'provider' as const, mode: 'gate' as const, provider },
      userName: 'root',
      projectRoot: dir,
    };
    const assessment = await assessSignalWithJev({ ...args, strict: false });
    expect(assessment.status).toBe('unavailable');
    expect(assessment.allowed).toBe(false);
    await expect(
      assessSignalWithJev({ ...args, strict: true }),
    ).rejects.toThrow('connection failed');
  });

  it.each(['BACKTEST', 'PRODUCTION'])(
    'applies a rejecting assessment in %s, while observe preserves policy',
    (env) => {
      const signal = makeSignal();
      const args = {
        signal,
        env,
        makeOrdersEnabled: true,
        aiEnabled: false,
        minAiQuality: 4,
      };
      expect(shouldExecuteEntryDecision(args)).toBe(true);
      signal.assessment = {
        schema: 'tradejs-signal-assessment/v2',
        source: 'recorded',
        mode: 'gate',
        status: 'available',
        inputHash: 'h',
        model: 'm',
        scores: { structure: 0, participation: 1, timing: 1, geometry: 1 },
        allowed: false,
        reasons: ['STRUCTURE_BELOW_MIN'],
      };
      expect(shouldExecuteEntryDecision(args)).toBe(false);
      expect(getEntrySkipReason(args)).toContain('JEV_REJECTED');
      signal.assessment.mode = 'observe';
      expect(shouldExecuteEntryDecision(args)).toBe(true);
    },
  );

  it('requires geometry only when requested, and rejects invalid geometry', () => {
    const scores: JevScores = {
      structure: 0.8,
      participation: 0.8,
      timing: 0.8,
      geometry: null,
    };
    const config = { source: 'provider' as const, mode: 'gate' as const };
    const questions = ['structure', 'participation', 'timing'] as const;
    expect(
      decideJev(scores, config, 'absent', undefined, [...questions]).allowed,
    ).toBe(true);
    expect(
      decideJev(
        scores,
        { ...config, requireGeometry: true },
        'absent',
        undefined,
        [...questions],
      ).allowed,
    ).toBe(false);
    expect(
      decideJev(scores, config, 'invalid', undefined, [...questions]).allowed,
    ).toBe(false);
    expect(() =>
      parseJevConfig({ ...config, minScores: { timing: 2 } }),
    ).toThrow('thresholds');
    expect(() =>
      parseJevConfig({
        ...config,
        provider: { ...provider, model: 'jev-latest' },
      }),
    ).toThrow('Pin');
  });

  it('trains bounded local rules without outcomes or held-out rows affecting the model', async () => {
    const rows = makeRows();
    const { model, report } = trainJevGate(rows, { minLeaf: 3 });
    expect(report.test.agreement).toBe(1);
    expect(report.walkForward).toHaveLength(3);
    for (const fold of report.walkForward) {
      expect(fold.trainThrough).toBeLessThan(fold.validationThrough);
      expect(fold.test.start).toBeGreaterThan(fold.validationThrough);
      expect(fold.test.agreement).toBe(1);
    }
    expect(model.training.trainEnd).toBeLessThan(model.training.validationEnd);
    const modified = rows.map((row) => ({ ...row, profit: 10000 }));
    expect(trainJevGate(modified, { minLeaf: 3 }).model).toEqual(model);
    expect(compareJevGate(model, rows).cohorts.ALL.local.knownOutcomes).toBe(
      50,
    );
    const modelFile = path.join(dir, 'gate.json');
    const contents = JSON.stringify(model);
    await fs.writeFile(modelFile, contents);
    const result = await evaluateJevInput({
      input: rows[99].record.input,
      config: {
        source: 'local',
        mode: 'gate',
        modelFile,
        modelSha256: jevFileHash(contents),
      },
      userName: 'root',
      projectRoot: dir,
    });
    expect(result.assessment.allowed).toBe(true);
    await expect(
      evaluateJevInput({
        input: rows[99].record.input,
        config: {
          source: 'local',
          mode: 'gate',
          modelFile,
          modelSha256: '0'.repeat(64),
        },
        userName: 'root',
        projectRoot: dir,
      }),
    ).rejects.toThrow('checksum');
  });

  it('rejects mixed lineages and tampered teacher records', () => {
    const rows = makeRows();
    rows[0].record.scores.structure = 1;
    expect(() => trainJevGate(rows)).toThrow('teacher response');
    expect(() => trainJevGate([])).toThrow('Empty');
  });
});
