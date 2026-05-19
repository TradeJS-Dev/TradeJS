import { selectStrategy } from './selectStrategy';
import { spawnSiblingScript } from './spawnSiblingScript';

export const main = async () => {
  const selected = await selectStrategy('Select AI export strategy');
  const status = spawnSiblingScript(__dirname, 'aiExport', [
    '--strategy',
    selected,
  ]);
  process.exit(status);
};
