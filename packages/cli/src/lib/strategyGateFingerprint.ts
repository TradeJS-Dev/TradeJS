import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const gateFingerprintRelativePaths = (strategyName: string) => [
  `packages/strategies/src/${strategyName}/adapters/ai.ts`,
  `packages/strategies/src/${strategyName}/guardrails.ts`,
  `packages/strategies/src/${strategyName}/pockets.ts`,
  `packages/strategies/src/${strategyName}/config.ts`,
  'packages/strategy-kit/src/ai-gate.ts',
  'packages/node/src/ai.ts',
  'packages/core/src/utils/strategyHelpers/signalBuilders.ts',
];

export const resolveStrategyGateFingerprint = async ({
  projectRoot,
  strategyName,
  gitSha,
}: {
  projectRoot: string;
  strategyName: string;
  gitSha: string | null;
}) => {
  const candidates = await Promise.all(
    gateFingerprintRelativePaths(strategyName).map(async (relativePath) => {
      const content = await fs
        .readFile(path.join(projectRoot, relativePath))
        .catch(() => null);
      return content == null ? null : { relativePath, content };
    }),
  );
  const sourceEntries = candidates.filter(
    (entry): entry is NonNullable<(typeof candidates)[number]> => entry != null,
  );
  const hash = createHash('sha256');
  hash.update(strategyName);
  if (sourceEntries.length) {
    for (const entry of sourceEntries) {
      hash.update(entry.relativePath);
      hash.update(entry.content);
    }
  } else {
    hash.update(gitSha ?? 'unknown-git-sha');
  }
  return {
    gateFingerprint: hash.digest('hex').slice(0, 16),
    gateFingerprintFiles: sourceEntries.map((entry) => entry.relativePath),
  };
};
