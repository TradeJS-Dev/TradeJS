/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildJevInput, evaluateJevInput, assessSignalWithJev } from '../jev';
import {
  questionsForJevInput,
  JEV_QUESTIONS,
  stateForJevInput,
} from '../jevInput';
import { buildAiPayloadByStrategy } from '../strategyAdapters/ai';
import {
  trainJevGate,
  compareJevGate,
  validateJevGateModel,
} from '../jevTraining';
import {
  jevHash,
  jevFileHash,
  writeJevArtifact,
  jevScoreMaximum,
} from '@tradejs/infra/jev';
import {
  JEV_DIMENSIONS,
  JEV_QUESTION_SET,
  decideJev,
  parseJevConfig,
  jevAssessmentFeatures,
} from '@tradejs/core/jev';
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
        candle: { timestamp },
        raw: { volatility: { atr: 2 } },
        regime: { trend: { bias: 'bull', priceDistanceToMaFastAtr: 0.5 } },
        structure: { swing: { bias: 'bull' } },
        participation: { volume: { volumeRel20: 2 } },
        gateFeatures: { scores: { totalContext: 90 } },
      },
    },
  }) as unknown as Signal;
const makeResponse = (
  score = 3,
  questions = buildJevInput(makeSignal()).questions,
): JevResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    questions.map((key) => {
      const maximum = jevScoreMaximum(key);
      const raw = (score / 4) * maximum;
      const low = Math.floor(raw),
        high = Math.ceil(raw);
      return [
        key,
        {
          type: 'score',
          score: raw,
          confidence: 1,
          probabilities: Object.fromEntries(
            Array.from({ length: maximum + 1 }, (_, value) => [
              value,
              low === high
                ? Number(value === low)
                : value === low
                  ? high - raw
                  : value === high
                    ? raw - low
                    : 0,
            ]),
          ),
        },
      ];
    }),
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
      schema: 'tradejs-jev-record/v4',
      id: jevHash({ inputHash, questionsHash, provider }),
      inputHash,
      questionsHash,
      provider,
      input,
      response: makeResponse(score, input.questions),
      scores: Object.fromEntries(
        JEV_DIMENSIONS.map((key) => [
          key,
          input.questions.includes(key) ? score / 4 : null,
        ]),
      ) as JevScores,
      createdAt: '2026-09-29',
      elapsedMs: 1,
    };
    return {
      schema: 'tradejs-jev-study/v4',
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

  it('compacts paid state without losing values, units or missing reasons', () => {
    const signal = makeSignal();
    signal.jevEvidence = {
      version: 'setup-v1',
      knownAt: signal.timestamp,
      facts: { efficiencyRatio: 0.64999999999999, count: 0, confirmed: false },
      geometry: { upperR2: 0.85 },
      factDetails: {
        'setup.count': {
          knownAt: signal.timestamp,
          scope: 'strategy',
          unit: 'bars',
        },
      },
    };
    const input = buildJevInput(signal);
    const before = structuredClone(input);
    const state = stateForJevInput(input);
    const flatten = (fields: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(fields).flatMap(([namespace, value]) =>
          value !== null && typeof value === 'object'
            ? Object.entries(value).map(([key, detail]) => [
                `${namespace}.${key}`,
                detail,
              ])
            : [[namespace, value]],
        ),
      );
    expect(flatten(state.facts)).toEqual(input.features);
    expect(flatten(state.missing)).toEqual(input.missing);
    expect(flatten(state.units)).toEqual(
      Object.fromEntries(
        Object.entries(input.provenance)
          .filter(([, detail]) => detail.unit != null)
          .map(([key, detail]) => [key, detail.unit]),
      ),
    );
    expect(input).toEqual(before);
    expect(state).not.toHaveProperty('sources');
    expect(state).not.toHaveProperty('schema');
    expect(state).not.toHaveProperty('questionSet');
    expect(state).not.toHaveProperty('direction');
    const previous = {
      schema: input.schema,
      questionSet: input.questionSet,
      strategy: input.strategy,
      direction: input.direction,
      facts: input.features,
      missing: input.missing,
      geometryStatus: input.geometryStatus,
      units: flatten(state.units),
      sources: Object.fromEntries(
        Object.entries(input.provenance)
          .filter(([, detail]) => detail.source != null)
          .map(([key, detail]) => [key, detail.source]),
      ),
    };
    expect(JSON.stringify(state).length).toBeLessThan(
      JSON.stringify(previous).length * 0.65,
    );
  });

  it('replays current recordings without calling a provider', async () => {
    const record = makeRows()[0].record;
    await writeJevArtifact(
      path.join(dir, 'records', `${record.id}.json`),
      record,
    );
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('provider must not run'));
    const result = await evaluateJevInput({
      input: record.input,
      config: {
        source: 'recorded',
        mode: 'observe',
        provider,
        recordsDir: '.',
      },
      userName: 'root',
      projectRoot: dir,
    });
    expect(result.record).toEqual(record);
    expect(fetcher).not.toHaveBeenCalled();
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
    expect(input.questions).toEqual([
      'trend',
      'participation',
      'signalStrength',
    ]);
    expect(Object.keys(input.features).length).toBeLessThan(20);
    const baselinePayload = buildAiPayloadByStrategy(signal);
    signal.jevEvidence = {
      version: 'setup-v1',
      knownAt: signal.timestamp,
      facts: { confirmationCount: 2 },
      geometry: { normalizedWidthAtr: 1.5 },
    };
    const extended = buildJevInput(signal);
    expect(extended.features['setup.confirmationCount']).toBe(2);
    expect(extended.questions).toContain('geometry');
    expect(extended.questions).not.toContain('confirmation');
    const regularPayload = buildAiPayloadByStrategy(signal);
    expect(regularPayload).toEqual(baselinePayload);
    expect(JSON.stringify(regularPayload)).not.toContain('jevEvidence');
    expect(JSON.stringify(regularPayload)).not.toContain('confirmationCount');
    signal.additionalIndicators!.jevEvidence = signal.jevEvidence;
    expect(JSON.stringify(buildAiPayloadByStrategy(signal))).not.toContain(
      'confirmationCount',
    );
    delete signal.additionalIndicators!.jevEvidence;
    signal.figures.lines![0].points[0].timestamp = 1001;
    expect(buildJevInput(signal).geometryStatus).toBe('invalid');
  });

  it('marks unavailable market facts and does not request unsupported judgments', () => {
    const signal = makeSignal();
    delete signal.additionalIndicators!.baseContext.candle;
    const input = buildJevInput(signal);
    expect(input.questions).toEqual(['signalStrength']);
    expect(input.missing['market.trendBias']).toBe('missing_timestamp');
    expect(input.features['market.trendBias']).toBeUndefined();
    expect(input.missing['signal.stopDistanceAtr']).toBe('missing_timestamp');
  });

  it('always builds the latest nine questions and measures the entry candle', () => {
    const signal = makeSignal();
    Object.assign(signal.additionalIndicators!.baseContext.candle, {
      open: 99,
      close: 100,
      high: 100.2,
      low: 98.8,
    });
    signal.jevEvidence = {
      version: 'setup-v1',
      knownAt: signal.timestamp,
      facts: {
        retracementRatio: 0.3,
        breakoutDistanceAtr: 0.4,
        impulseEfficiencyRatio: 0.7,
        consolidationVolumeRatio: 0.5,
      },
      geometry: { upperR2: 0.9, lowerR2: 0.9, slopeDivergenceRatio: 0.1 },
    };
    const micro = buildJevInput(signal);
    expect(micro.questionSet).toBe(JEV_QUESTION_SET);
    expect(micro.features['entry.directionalBodyAtr']).toBe(0.5);
    expect(micro.features['entry.directionalCloseLocation']).toBeCloseTo(6 / 7);
    expect(micro.questions).toEqual(JEV_DIMENSIONS);
    expect(Object.keys(questionsForJevInput(micro))).toHaveLength(9);
    signal.direction = 'SHORT';
    const short = buildJevInput(signal);
    expect(short.features['entry.directionalBodyAtr']).toBe(-0.5);
    expect(short.features['entry.directionalCloseLocation']).toBeCloseTo(1 / 7);
    delete signal.additionalIndicators!.baseContext.candle.high;
    expect(buildJevInput(signal).questions).not.toContain('confirmation');
  });

  it('reuses one paid answer for equivalent states at different signal times', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeResponse(),
    } as Response);
    const config = {
      source: 'provider' as const,
      mode: 'observe' as const,
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
    const micro = jevAssessmentFeatures(first.assessment);
    expect(micro.scores).toHaveProperty(
      'directionalAgreement',
      first.assessment.scores.trend,
    );
    expect(micro.scores).not.toHaveProperty('trend');
    expect(micro.confidence).toHaveProperty(
      'entryConviction',
      first.assessment.confidence.confirmation,
    );
    expect(micro.questionSet).toBe(JEV_QUESTION_SET);
    expect(first.record?.id).not.toBe(second.record?.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state).not.toHaveProperty('timestamp');
    expect(body.state).not.toHaveProperty('symbol');
  });

  it('adds a holistic 1–10 feature in the same request, caches it, and leaves entry approval unchanged', async () => {
    const signal = makeSignal();
    Object.assign(signal.additionalIndicators!.baseContext.candle, {
      open: 99,
      close: 100,
      high: 100.2,
      low: 98.8,
    });
    signal.jevEvidence = {
      version: 'setup-v1',
      knownAt: signal.timestamp,
      facts: {
        retracementRatio: 0.3,
        breakoutDistanceAtr: 0.4,
        impulseEfficiencyRatio: 0.7,
        consolidationVolumeRatio: 0.5,
      },
      geometry: { upperR2: 0.9, lowerR2: 0.9, slopeDivergenceRatio: 0.1 },
    };
    const input = buildJevInput(signal);
    expect(input.questions).toEqual(JEV_DIMENSIONS);
    const definitions = questionsForJevInput(input);
    expect(definitions.signalStrength.criteria).toHaveLength(10);
    for (const key of JEV_DIMENSIONS) {
      expect(definitions[key].criteria).toHaveLength(
        key === 'signalStrength' ? 10 : 5,
      );
      expect(definitions[key].type).toBe('score');
    }
    const response = makeResponse(3, input.questions);
    response.answers.signalStrength = {
      type: 'score',
      score: 7.2,
      confidence: 0.8,
      probabilities: Object.fromEntries(
        Array.from({ length: 10 }, (_, level) => [
          level,
          level === 7 ? 0.8 : level === 8 ? 0.2 : 0,
        ]),
      ),
    };
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => response } as Response);
    const config = {
      source: 'provider' as const,
      mode: 'observe' as const,
      provider,
    };
    const assessment = await assessSignalWithJev({
      signal,
      config,
      userName: 'root',
      projectRoot: dir,
      strict: true,
    });
    expect(assessment.scores.signalStrength).toBeCloseTo(0.8);
    expect(signal.additionalIndicators!.jev.scores.signalStrength).toBe(8.2);
    expect(signal.additionalIndicators!.jev.confidence.signalStrength).toBe(
      0.8,
    );
    const replay = await evaluateJevInput({
      input,
      config: { ...config, source: 'recorded' },
      userName: 'root',
      projectRoot: dir,
    });
    expect(replay.assessment.scores).toEqual(assessment.scores);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(Object.keys(body.questions)).toHaveLength(9);
    expect(body.state).not.toHaveProperty('timestamp');
    expect(JSON.stringify(body.state)).not.toMatch(
      /profit|outcome|aiApproved|totalContext/,
    );
    signal.assessment!.scores.signalStrength = 0;
    expect(
      shouldExecuteEntryDecision({
        signal,
        env: 'PRODUCTION',
        makeOrdersEnabled: true,
        aiEnabled: true,
        minAiQuality: 4,
        quality: 4,
      }),
    ).toBe(true);
    expect(
      shouldExecuteEntryDecision({
        signal,
        env: 'PRODUCTION',
        makeOrdersEnabled: true,
        aiEnabled: true,
        minAiQuality: 4,
        quality: 3,
      }),
    ).toBe(false);
  });

  it('learns the ninth score with 60/40 and exports local predictions on the same scale', async () => {
    const rows = makeRows().map((row, index) => {
      const input = {
        ...row.record.input,
        questions: row.record.input.questions,
      };
      const response = {
        ...row.record.response,
        answers: {
          ...row.record.response.answers,
          signalStrength: {
            type: 'score' as const,
            score: index % 2 ? 9 : 0,
            confidence: 1,
            probabilities: Object.fromEntries(
              Array.from({ length: 10 }, (_, level) => [
                level,
                level === (index % 2 ? 9 : 0) ? 1 : 0,
              ]),
            ),
          },
        },
      };
      const inputHash = jevHash(input),
        questionsHash = jevHash(questionsForJevInput(input));
      return {
        ...row,
        record: {
          ...row.record,
          input,
          inputHash,
          questionsHash,
          response,
          id: jevHash({ inputHash, questionsHash, provider }),
          scores: { ...row.record.scores, signalStrength: index % 2 ? 1 : 0 },
        },
      };
    });
    const { model, report } = trainJevGate(rows, { minLeaf: 3 });
    expect(model.trees.signalStrength).not.toBeNull();
    expect(report.train.rows).toBe(60);
    expect(report.test.rows).toBe(40);
    expect(report.test.dimensionErrors.signalStrength.mae).toBe(0);
    const modelFile = path.join(dir, 'strength-gate.json');
    const contents = JSON.stringify(model);
    await fs.writeFile(modelFile, contents);
    for (const index of [98, 99]) {
      const { assessment } = await evaluateJevInput({
        input: rows[index].record.input,
        config: {
          source: 'local',
          mode: 'observe',
          modelFile,
          modelSha256: jevFileHash(contents),
        },
        userName: 'root',
        projectRoot: dir,
      });
      expect(jevAssessmentFeatures(assessment).scores.signalStrength).toBe(
        index % 2 ? 10 : 1,
      );
    }
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
      config: { source: 'provider', mode: 'observe', provider },
    });
    const replay = await evaluateJevInput({
      ...common,
      config: { source: 'recorded', mode: 'observe', provider },
    });
    expect(replay.record).toEqual(first.record);
    expect(replay.assessment.scores.trend).toBe(0.75);
    expect(replay.assessment.levelsValid).toBe(true);
    expect(replay.assessment.confidence.trend).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      evaluateJevInput({
        ...common,
        input: { ...input, timestamp: 2000 },
        config: { source: 'recorded', mode: 'observe', provider },
      }),
    ).rejects.toThrow('Missing Jev recording');
  });

  it('blocks failed runtime assessments and fails incomplete backtests', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('private-token'));
    const signal = makeSignal();
    const args = {
      signal,
      config: {
        source: 'provider' as const,
        mode: 'observe' as const,
        provider,
      },
      userName: 'root',
      projectRoot: dir,
    };
    const assessment = await assessSignalWithJev({ ...args, strict: false });
    expect(assessment.status).toBe('unavailable');
    expect(signal.additionalIndicators?.jev).toEqual(
      jevAssessmentFeatures(assessment),
    );
    expect(signal.additionalIndicators?.jev.questionSet).toBe(JEV_QUESTION_SET);
    expect(assessment.scores.signalStrength).toBeNull();
    expect(
      (buildAiPayloadByStrategy(signal).additionalIndicators as any).jev,
    ).toEqual(signal.additionalIndicators?.jev);
    await expect(
      assessSignalWithJev({ ...args, strict: true }),
    ).rejects.toThrow('connection failed');
  });

  it.each(['BACKTEST', 'PRODUCTION'])(
    'keeps Jev assessments out of entry decisions in %s',
    (env) => {
      const signal = makeSignal();
      signal.assessment = {
        questionSet: JEV_QUESTION_SET,
        schema: 'tradejs-signal-assessment/v5',
        source: 'recorded',
        mode: 'observe',
        status: 'available',
        inputHash: 'h',
        questionsHash: 'q',
        model: 'm',
        scores: Object.fromEntries(
          JEV_DIMENSIONS.map((key) => [key, key === 'trend' ? 0 : 1]),
        ) as JevScores,
        confidence: Object.fromEntries(
          JEV_DIMENSIONS.map((key) => [key, 1]),
        ) as JevScores,
        geometryStatus: 'available',
        levelsValid: true,
      };
      const args = {
        signal,
        env,
        makeOrdersEnabled: true,
        aiEnabled: false,
        minAiQuality: 4,
      };
      expect(shouldExecuteEntryDecision(args)).toBe(true);
      expect(getEntrySkipReason(args)).not.toContain('JEV_REJECTED');
      expect(
        shouldExecuteEntryDecision({ ...args, aiEnabled: true, quality: 3 }),
      ).toBe(env === 'BACKTEST');
      expect(
        shouldExecuteEntryDecision({ ...args, aiEnabled: true, quality: 4 }),
      ).toBe(true);
    },
  );

  it('requires geometry only when requested, and rejects invalid geometry', () => {
    const scores = Object.fromEntries(
      JEV_DIMENSIONS.map((key) => [key, key === 'geometry' ? null : 0.8]),
    ) as JevScores;
    const config = { source: 'provider' as const, mode: 'observe' as const };
    const questions = ['trend', 'participation', 'extension'] as const;
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
      parseJevConfig({ ...config, minScores: { extension: 2 } }),
    ).toThrow('Unknown JEV configuration field');
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
      expect(fold.trainThrough).toBe(fold.validationThrough);
      expect(fold.testThrough).toBeLessThanOrEqual(model.training.trainEnd);
      expect(fold.test.start).toBeGreaterThan(fold.validationThrough);
      expect(fold.test.agreement).toBe(1);
    }
    expect(model.training.trainEnd).toBe(model.training.validationEnd);
    expect(model.training.split).toBe('outer-60-40');
    expect(report.train.rows).toBe(60);
    expect(report.test.rows).toBe(40);
    const changedTail = rows.map((row, index) => {
      if (index < 60) return row;
      const score = index % 2 ? 0 : 4;
      return {
        ...row,
        record: {
          ...row.record,
          response: makeResponse(score, row.record.input.questions),
          scores: Object.fromEntries(
            JEV_DIMENSIONS.map((key) => [
              key,
              row.record.input.questions.includes(key) ? score / 4 : null,
            ]),
          ) as JevScores,
        },
      };
    });
    const tailStudy = trainJevGate(changedTail, { minLeaf: 3 });
    expect(tailStudy.model.trees).toEqual(model.trees);
    expect(tailStudy.report.walkForward).toEqual(report.walkForward);
    expect(tailStudy.report.test.agreement).toBe(0);
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
        mode: 'observe',
        modelFile,
        modelSha256: jevFileHash(contents),
      },
      userName: 'root',
      projectRoot: dir,
    });
    expect(result.assessment.scores.trend).toBe(1);
    await expect(
      evaluateJevInput({
        input: rows[99].record.input,
        config: {
          source: 'local',
          mode: 'observe',
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
    rows[0].record.scores.trend = 1;
    expect(() => trainJevGate(rows)).toThrow('teacher response');
    expect(() => trainJevGate([])).toThrow('Empty');
  });

  it.each(['alignment-v1', 'micro-v2', undefined])(
    'rejects removed or unversioned input %s before any provider call',
    async (version) => {
      const input = { ...makeRows()[0].record.input, questionSet: version };
      const fetcher = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('provider must not run'));
      await expect(
        evaluateJevInput({
          input: input as unknown as JevRecord['input'],
          config: { source: 'recorded', mode: 'observe', provider },
          userName: 'root',
          projectRoot: dir,
        }),
      ).rejects.toThrow('Unsupported Jev recording question set');
      const rows = makeRows();
      rows[0].record.input = input as unknown as JevRecord['input'];
      expect(() => trainJevGate(rows)).toThrow('provenance');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('rejects old models, incomplete nine-score models and question-set selection', () => {
    const { model } = trainJevGate(makeRows(), { minLeaf: 3 });
    for (const questionSet of ['alignment-v1', 'micro-v2', undefined])
      expect(() => validateJevGateModel({ ...model, questionSet })).toThrow(
        'Invalid local Jev gate',
      );
    const incomplete = structuredClone(model);
    delete (incomplete.trees as Partial<typeof incomplete.trees>)
      .signalStrength;
    expect(() => validateJevGateModel(incomplete)).toThrow(
      'Invalid local Jev gate',
    );
    expect(() =>
      parseJevConfig({
        source: 'provider',
        mode: 'observe',
        questionSet: 'micro-v3',
      }),
    ).toThrow('Unknown JEV configuration field');
    const oldAssessment = { questionSet: undefined } as unknown as Parameters<
      typeof jevAssessmentFeatures
    >[0];
    expect(() => jevAssessmentFeatures(oldAssessment)).toThrow(
      'Unsupported Jev assessment',
    );
  });
});
