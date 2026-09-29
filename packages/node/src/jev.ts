import fs from 'node:fs/promises';
import path from 'node:path';
import {
  JEV_DIMENSIONS,
  JEV_PROVIDERS,
  decideJev,
  parseJevConfig,
  predictJevTree,
} from '@tradejs/core/jev';
import {
  jevHash,
  jevFileHash,
  readJevArtifact,
  writeJevArtifact,
  requestJev,
  validateJevResponse,
} from '@tradejs/infra/jev';
import { getUserSettings } from '@tradejs/infra/userSettings';
import type {
  JevConfig,
  JevGateModel,
  JevInput,
  JevRecord,
  JevScores,
  Signal,
  SignalAssessment,
} from '@tradejs/types';
import { buildJevInput, JEV_QUESTIONS } from './jevInput';

export { buildJevInput, JEV_QUESTIONS } from './jevInput';
export {
  trainJevGate,
  compareJevGate,
  validateJevGateModel,
} from './jevTraining';

export const resolveJevProvider = async (userName: string) => {
  const settings = await getUserSettings(userName);
  const provider = {
    endpoint: settings.JEV_API_ENDPOINT || JEV_PROVIDERS[0].endpoint,
    model: settings.JEV_MODEL || JEV_PROVIDERS[0].model,
  };
  parseJevConfig({ source: 'provider', mode: 'gate', provider });
  if (!settings.JEV_API_KEY)
    throw new Error('Configure the Jev API key in Account settings');
  return provider;
};

const emptyScores = (): JevScores => ({
  structure: null,
  participation: null,
  timing: null,
  geometry: null,
});
const pending = new Map<string, Promise<JevRecord>>();

export const evaluateJevInput = async ({
  input,
  config,
  userName,
  projectRoot,
}: {
  input: JevInput;
  config: JevConfig;
  userName: string;
  projectRoot: string;
}): Promise<{ assessment: SignalAssessment; record?: JevRecord }> => {
  config = parseJevConfig(config)!;
  const inputHash = jevHash(input);
  const questionsHash = jevHash(JEV_QUESTIONS);
  const base = {
    schema: 'tradejs-signal-assessment/v1' as const,
    source: config.source,
    mode: config.mode,
    inputHash,
  };
  if (config.source === 'local') {
    const contents = await fs.readFile(
      path.resolve(projectRoot, config.modelFile!),
      'utf8',
    );
    if (jevFileHash(contents) !== config.modelSha256)
      throw new Error('Local Jev gate checksum mismatch');
    const { validateJevGateModel } = await import('./jevTraining');
    const model: JevGateModel = validateJevGateModel(JSON.parse(contents));
    if (
      model.strategy !== input.strategy ||
      model.questionsHash !== questionsHash
    )
      throw new Error('Local Jev gate strategy or question version mismatch');
    const scores = Object.fromEntries(
      JEV_DIMENSIONS.map((key) => [
        key,
        model.trees[key]
          ? predictJevTree(model.trees[key]!, input.features)
          : null,
      ]),
    ) as JevScores;
    if (input.geometryStatus !== 'available') scores.geometry = null;
    return {
      assessment: {
        ...base,
        status: 'available',
        model: config.modelSha256!,
        scores,
        ...decideJev(scores, config, input.geometryStatus, input.features),
      },
    };
  }
  const provider = config.provider ?? (await resolveJevProvider(userName));
  const id = jevHash({ inputHash, questionsHash, provider });
  const dir = path.resolve(projectRoot, config.recordsDir ?? 'data/ai/jev');
  const file = path.join(dir, 'records', `${id}.json`);
  const getRecord = async () => {
    const existing = await readJevArtifact<JevRecord>(file);
    if (existing) {
      if (
        existing.schema !== 'tradejs-jev-record/v1' ||
        existing.id !== id ||
        existing.inputHash !== inputHash ||
        existing.questionsHash !== questionsHash ||
        jevHash(existing.input) !== inputHash ||
        jevHash(existing.provider) !== jevHash(provider)
      )
        throw new Error('Jev recording identity mismatch');
      validateJevResponse(existing.response);
      for (const key of JEV_DIMENSIONS) {
        const expected =
          key === 'geometry' && input.geometryStatus !== 'available'
            ? null
            : existing.response.answers[key].score / 4;
        if (existing.scores[key] !== expected)
          throw new Error('Jev recording scores do not match the response');
      }
      return existing;
    }
    if (config.source === 'recorded')
      throw new Error(`Missing Jev recording ${id}`);
    const settings = await getUserSettings(userName);
    if (!settings.JEV_API_KEY)
      throw new Error('Configure the Jev API key in Account settings');
    const configuredProvider = await resolveJevProvider(userName);
    if (configuredProvider.endpoint !== provider.endpoint)
      throw new Error(
        'Jev account endpoint changed; update the frozen provider configuration',
      );
    const started = Date.now();
    const response = await requestJev(
      provider,
      settings.JEV_API_KEY,
      input,
      JEV_QUESTIONS,
    );
    const scores = Object.fromEntries(
      JEV_DIMENSIONS.map((key) => [
        key,
        key === 'geometry' && input.geometryStatus !== 'available'
          ? null
          : response.answers[key].score / 4,
      ]),
    ) as JevScores;
    const value: JevRecord = {
      schema: 'tradejs-jev-record/v1',
      id,
      inputHash,
      questionsHash,
      provider,
      input,
      response,
      scores,
      createdAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
    };
    await writeJevArtifact(file, value);
    return (await readJevArtifact<JevRecord>(file))!;
  };
  const pendingKey = `${file}:${jevHash(userName)}`;
  let promise = pending.get(pendingKey);
  if (!promise) {
    promise = getRecord();
    pending.set(pendingKey, promise);
  }
  let record: JevRecord;
  try {
    record = await promise;
  } finally {
    pending.delete(pendingKey);
  }
  return {
    record,
    assessment: {
      ...base,
      status: 'available',
      recordId: id,
      model: record.response.model,
      scores: record.scores,
      ...decideJev(record.scores, config, input.geometryStatus, input.features),
    },
  };
};

export const assessSignalWithJev = async ({
  signal,
  config,
  userName,
  projectRoot,
  strict,
  scope = 'runtime',
}: {
  signal: Signal;
  config: JevConfig;
  userName: string;
  projectRoot: string;
  strict: boolean;
  scope?: string;
}) => {
  let assessment: SignalAssessment;
  try {
    const input = buildJevInput(signal);
    ({ assessment } = await evaluateJevInput({
      input,
      config,
      userName,
      projectRoot,
    }));
  } catch (error) {
    if (strict) throw error;
    assessment = {
      schema: 'tradejs-signal-assessment/v1',
      source: config.source,
      mode: config.mode,
      status: 'unavailable',
      inputHash: '',
      model: config.provider?.model ?? config.modelSha256 ?? '',
      scores: emptyScores(),
      allowed: false,
      reasons: ['JEV_UNAVAILABLE'],
    };
  }
  signal.assessment = assessment;
  const identity = {
    signalId: signal.signalId,
    strategy: signal.strategy,
    symbol: signal.symbol,
    timestamp: signal.timestamp,
    scope,
    user: jevHash(userName),
    config,
    assessment,
  };
  await writeJevArtifact(
    path.resolve(
      projectRoot,
      config.recordsDir ?? 'data/ai/jev',
      'decisions',
      `${jevHash(identity)}.json`,
    ),
    identity,
  );
  return assessment;
};
