import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const toPackageToken = (strategyName: string) =>
  strategyName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .toLowerCase();

export const getStrategyPackageName = (strategyName: string) =>
  strategyName === 'TrendLine' || strategyName === 'ReverseTrendLine'
    ? '@tradejs/strategy-trend-line'
    : `@tradejs/strategy-${toPackageToken(strategyName)}`;

const gateFingerprintSpecifiers = (strategyName: string) => [
  getStrategyPackageName(strategyName),
  '@tradejs/strategy-kit/ai-gate',
  '@tradejs/node/ai',
  '@tradejs/core/strategies',
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
  const projectManifestPath = path.join(projectRoot, 'package.json');
  const projectExists = await fs
    .access(projectManifestPath)
    .then(() => true)
    .catch(() => false);
  const requireFromProject = projectExists
    ? createRequire(projectManifestPath)
    : null;
  const candidates = requireFromProject
    ? await Promise.all(
        gateFingerprintSpecifiers(strategyName).map(async (specifier) => {
          let resolvedPath: string;
          try {
            resolvedPath = requireFromProject.resolve(specifier);
          } catch {
            return null;
          }
          const content = await fs.readFile(resolvedPath).catch(() => null);
          return content == null ? null : { specifier, content };
        }),
      )
    : [];
  const sourceEntries = candidates.filter(
    (entry): entry is NonNullable<(typeof candidates)[number]> => entry != null,
  );
  const hash = createHash('sha256');
  hash.update(strategyName);
  if (sourceEntries.length) {
    for (const entry of sourceEntries) {
      hash.update(entry.specifier);
      hash.update(entry.content);
    }
  } else {
    hash.update(gitSha ?? 'unknown-git-sha');
  }
  return {
    gateFingerprint: hash.digest('hex').slice(0, 16),
    gateFingerprintFiles: sourceEntries.map((entry) => entry.specifier),
  };
};
