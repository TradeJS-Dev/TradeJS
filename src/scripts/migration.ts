import ProgressBar from 'progress';
import chalk from 'chalk';
import { toRows, upsertCandles } from '@utils/timescale';
import { getFile, getFiles } from '@utils/files';
import { KlineChartData } from '@types';
import { logger } from '@utils/logger';

const DIR = 'data/history';
const re = /^(.+?)_(\d+)\.json$/; // SYMBOL_INTERVAL.json
const BATCH = 2000;

const migrateFile = async (file: string) => {
  const m = re.exec(file);
  if (!m) return;
  const symbol = m[1];
  const interval = Number(m[2]);

  const data = (await getFile(DIR, `${symbol}_${interval}`)) as KlineChartData;

  const rows = toRows(symbol, interval, data);

  for (let i = 0; i < rows.length; i += BATCH) {
    await upsertCandles(rows.slice(i, i + BATCH));
  }
};

const migration = async () => {
  const files = await getFiles(DIR);

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :file',
    {
      total: files.length,
      width: 30,
    },
  );

  for await (const file of files) {
    try {
      await migrateFile(file);
    } catch (e) {
      logger.error('Failed: %s %s', file, e);
    } finally {
      bar.tick(1, {
        file: chalk.gray(file),
      });
    }
  }

  process.exit();
};

migration();
