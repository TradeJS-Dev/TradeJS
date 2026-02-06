import path from 'path';
import fs from 'fs/promises';
import { spawnSync } from 'child_process';
import { selectStrategy } from './selectStrategy';

const listLatestTrain = async (dir: string): Promise<string | null> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) => name.startsWith('ml-dataset-') && name.endsWith('.train.csv'),
    );

  if (!candidates.length) return null;

  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      const stat = await fs.stat(path.join(dir, name));
      return { name, mtime: stat.mtimeMs };
    }),
  );

  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0].name;
};

const run = async () => {
  const selected = await selectStrategy();
  const dataDir = path.join(process.cwd(), 'data', 'ml');
  const trainFile = await listLatestTrain(dataDir);

  if (!trainFile) {
    console.error('No train dataset found in data/ml');
    process.exit(1);
  }

  const testFile = trainFile.replace('.train.csv', '.test.csv');
  const testPath = path.join(dataDir, testFile);
  try {
    await fs.access(testPath);
  } catch {
    console.error('No test dataset found in data/ml');
    process.exit(1);
  }

  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.ml.yml',
      'run',
      '--rm',
      'ml',
      'python',
      '/app/ml/train.py',
      '--input',
      `/app/data/ml/${trainFile}`,
      '--test-input',
      `/app/data/ml/${testFile}`,
      '--strategy',
      selected,
      '--ensemble',
    ],
    { stdio: 'inherit' },
  );

  process.exit(result.status ?? 1);
};

run().catch((err) => {
  console.error('Failed to train:', err);
  process.exit(1);
});
