/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildJevInput, evaluateJevInput, assessSignalWithJev } from '../jev';
import { questionsForJevInput } from '../jevInput';
import { buildAiPayloadByStrategy } from '../strategyAdapters/ai';
import { trainJevGate, compareJevGate } from '../jevTraining';
import { jevHash, jevFileHash } from '@tradejs/infra/jev';
import { JEV_DIMENSIONS, decideJev, parseJevConfig } from '@tradejs/core/jev';
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
    questions.map((key) => [
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
      'swing',
      'participation',
      'extension',
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
    expect(extended.questions).toContain('confirmation');
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
    expect(input.questions).toEqual([]);
    expect(input.missing['market.trendBias']).toBe('missing_timestamp');
    expect(input.features['market.trendBias']).toBeUndefined();
    expect(input.missing['signal.stopDistanceAtr']).toBe('missing_timestamp');
  });

  it('asks eight distinct questions when all strategy-neutral evidence groups exist', () => {
    const signal = makeSignal();
    signal.jevEvidence = {
      version: 'setup-v1',
      knownAt: signal.timestamp,
      facts: {
        setupVolumeRatio: 0.6,
        entryStage: 'confirmed',
        breakoutDistanceAtr: 0.2,
        impulseStrengthAtr: 3.4,
      },
      geometry: { channelWidthAtr: 1.2 },
    };
    const input = buildJevInput(signal);
    expect(input.questions).toEqual(JEV_DIMENSIONS);
    expect(Object.keys(questionsForJevInput(input))).toHaveLength(8);
    expect(input.features['setup.setupVolumeRatio']).toBe(0.6);
    expect(input.features['geometry.channelWidthAtr']).toBe(1.2);
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
    expect(signal.additionalIndicators?.jev).toEqual({
      schema: 'tradejs-jev-features/v2',
      status: 'unavailable',
      scores: assessment.scores,
      confidence: assessment.confidence,
    });
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
});
