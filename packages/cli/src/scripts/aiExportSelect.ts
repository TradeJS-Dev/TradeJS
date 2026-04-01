import { spawnSync } from 'child_process';
import { selectStrategy } from './selectStrategy';

const run = async () => {
  const selected = await selectStrategy('Select AI export strategy');
  const args = ['ts-node', './src/scripts/aiExport', '--strategy', selected];
  const result = spawnSync('yarn', args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
};

run().catch((err) => {
  console.error('Failed to select AI export strategy:', err);
  process.exit(1);
});
