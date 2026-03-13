import 'dotenv/config';
import { runBot } from '../lib/runBot';

const run = async () => {
  await runBot();

  process.exit();
};

run();
