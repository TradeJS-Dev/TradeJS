import fs from 'node:fs/promises';
import path from 'node:path';
import { JEV_PROVIDERS, parseJevConfig } from '@tradejs/core/jev';
import { jevFileHash } from '@tradejs/infra/jev';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { resolveJevProvider, validateJevGateModel } from '@tradejs/node/jev';
import type { JevConfig } from '@tradejs/types';

/** Jev evaluation and AI dataset export are separate backtest opt-ins. */
export const resolveBacktestAiExportEnabled = (
  flags: Record<string, unknown>,
) => Boolean(flags.ai);

export const resolveBacktestJev = async (
  flags: Record<string, unknown>,
  userName: string,
  projectRoot: string,
): Promise<JevConfig | undefined> => {
  if (!flags.jev) {
    if (flags.jevRecorded || flags.jevModelFile)
      throw new Error('Jev options require --jev');
    return undefined;
  }
  if (flags.jevRecorded && flags.jevModelFile)
    throw new Error('Choose --jevRecorded or --jevModelFile');
  const common = {
    mode: 'observe' as const,
    recordsDir: String(flags.jevRecordsDir || 'data/ai/jev'),
  };
  if (flags.jevModelFile) {
    const modelFile = String(flags.jevModelFile);
    const contents = await fs.readFile(
      path.resolve(projectRoot, modelFile),
      'utf8',
    );
    validateJevGateModel(JSON.parse(contents));
    return parseJevConfig({
      ...common,
      source: 'local',
      modelFile,
      modelSha256: jevFileHash(contents),
    });
  }
  const settings = flags.jevRecorded ? await getUserSettings(userName) : null;
  const provider = settings
    ? {
        endpoint: settings.JEV_API_ENDPOINT || JEV_PROVIDERS[0].endpoint,
        model: settings.JEV_MODEL || JEV_PROVIDERS[0].model,
      }
    : await resolveJevProvider(userName);
  return parseJevConfig({
    ...common,
    source: flags.jevRecorded ? 'recorded' : 'provider',
    provider,
  });
};
