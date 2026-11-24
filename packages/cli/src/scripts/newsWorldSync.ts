import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { importWorldNews } from '@tradejs/infra/timescale/client';
import {
  buildWorldNewsArchive,
  type GdeltWorldBatch,
  type OfficialWorldNotice,
} from '../lib/news/world';

export async function main() {
  const { values } = parseArgs({
    options: {
      gdelt: { type: 'string' },
      official: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (!values.gdelt && !values.official) {
    throw new Error(
      'Usage: tradejs news:world:sync [--gdelt batches.jsonl] [--official notices.json] [--output archive.json]',
    );
  }
  const batches: GdeltWorldBatch[] = values.gdelt
    ? (await readFile(values.gdelt, 'utf8'))
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    : [];
  const notices: OfficialWorldNotice[] = values.official
    ? JSON.parse(await readFile(values.official, 'utf8'))
    : [];
  const archive = buildWorldNewsArchive(batches, notices);
  if (values.output) {
    await writeFile(values.output, JSON.stringify(archive, null, 2) + '\n', {
      flag: 'wx',
    });
  } else {
    await importWorldNews(archive);
  }
  console.log(
    JSON.stringify({
      events: archive.events.length,
      coverageWindows: archive.coverage.length,
    }),
  );
}
