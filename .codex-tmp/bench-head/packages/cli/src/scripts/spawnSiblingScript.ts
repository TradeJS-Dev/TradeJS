import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export const spawnSiblingScript = (
  currentDir: string,
  scriptBaseName: string,
  extraArgs: string[],
): number => {
  const searchDirs = [currentDir, path.resolve(currentDir, 'scripts')];
  const candidates = searchDirs.flatMap((dir) => [
    path.resolve(dir, `${scriptBaseName}.js`),
    path.resolve(dir, `${scriptBaseName}.ts`),
  ]);
  const scriptPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!scriptPath) {
    throw new Error(
      `Script "${scriptBaseName}" not found. Checked: ${candidates.join(', ')}`,
    );
  }

  const commandArgs = scriptPath.endsWith('.ts')
    ? [
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        scriptPath,
        ...extraArgs,
      ]
    : [scriptPath, ...extraArgs];

  const result = spawnSync(process.execPath, commandArgs, {
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
};
