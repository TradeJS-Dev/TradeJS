import { selectStrategy } from './selectStrategy';
import { spawnSiblingScript } from './spawnSiblingScript';

const run = async () => {
  const selected = await selectStrategy('Select AI export strategy');
  const status = spawnSiblingScript(__dirname, 'aiExport', [
    '--strategy',
    selected,
  ]);
  process.exit(status);
};

run().catch((err) => {
  console.error('Failed to select AI export strategy:', err);
  process.exit(1);
});
