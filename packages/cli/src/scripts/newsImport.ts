import { readFile } from 'node:fs/promises';
import { importNewsArchive } from '@tradejs/infra/timescale/client';

export async function main() {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || rest.length)
    throw new Error('Usage: tradejs news:import <archive.json>');
  await importNewsArchive(JSON.parse(await readFile(file, 'utf8')));
  console.log('News archive imported');
}
