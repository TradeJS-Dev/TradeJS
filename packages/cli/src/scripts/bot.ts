import 'dotenv/config';
import { runBot } from '@utils/bot';

const run = async () => {
  await runBot();

  process.exit();
};

run();
