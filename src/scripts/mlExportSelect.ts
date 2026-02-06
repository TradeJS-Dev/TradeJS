import { spawnSync } from 'child_process';
import { selectStrategy } from './selectStrategy';

const run = async () => {
  const selected = await selectStrategy();
  const result = spawnSync(
    'yarn',
    ['ts-node', './src/scripts/mlExport', '--strategy', selected],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
};

run().catch((err) => {
  console.error('Failed to select strategy:', err);
  process.exit(1);
});
