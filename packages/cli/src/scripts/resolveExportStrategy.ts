import { selectStrategy } from './selectStrategy';

type ResolveExportStrategyParams = {
  explicitStrategy?: string;
  outDir: string;
  datasetLabel: string;
  promptLabel: string;
  listStrategies: (params: { outDir: string }) => Promise<string[]>;
  includeAllOption?: boolean;
};

export const ALL_EXPORT_STRATEGIES = 'all';

export const resolveExportStrategy = async ({
  explicitStrategy,
  outDir,
  datasetLabel,
  promptLabel,
  listStrategies,
  includeAllOption = false,
}: ResolveExportStrategyParams): Promise<string | null> => {
  const raw = String(explicitStrategy || '').trim();
  if (raw) {
    return raw;
  }

  const availableStrategies = await listStrategies({ outDir });
  if (!availableStrategies.length) {
    return null;
  }

  if (availableStrategies.length === 1) {
    return availableStrategies[0];
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `Multiple ${datasetLabel} chunk strategies found in ${outDir}: ${availableStrategies.join(', ')}. Pass --strategy.`,
    );
  }

  const promptStrategies = includeAllOption
    ? [...availableStrategies, ALL_EXPORT_STRATEGIES]
    : availableStrategies;

  return selectStrategy(promptLabel, {
    strategies: promptStrategies,
    defaultStrategy: availableStrategies[0],
  });
};
