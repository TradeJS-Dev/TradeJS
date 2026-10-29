/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeReplayJsonFile } from '../jsonFile';
import { createReplayMemoryProfile } from '../memoryProfile';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-json-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('streams complete JSON evidence with native primitive and omission semantics', async () => {
  const record = {
    unicode: 'тест 😀\n"',
    nested: { nil: null, missing: undefined },
    values: [1, NaN, Infinity, undefined, -0],
    rows: Array.from({ length: 3000 }, (_, id) => ({
      id,
      context: 'x'.repeat(100),
    })),
  };
  const file = path.join(root, 'report.json');
  await writeReplayJsonFile(file, record);
  expect(await fs.readFile(file, 'utf8')).toBe(JSON.stringify(record) + '\n');
  expect(await fs.readdir(root)).toEqual(['report.json']);
});

test('does not replace existing evidence when serialization fails and removes partial output', async () => {
  const file = path.join(root, 'report.json');
  await fs.writeFile(file, 'original');
  const cyclic: { value: string; child?: unknown } = {
    value: 'x'.repeat(100000),
  };
  cyclic.child = cyclic;
  await expect(writeReplayJsonFile(file, cyclic)).rejects.toThrow('Circular');
  expect(await fs.readFile(file, 'utf8')).toBe('original');
  expect(await fs.readdir(root)).toEqual(['report.json']);
});

test('rejects unsupported custom JSON hooks instead of silently changing evidence', async () => {
  await expect(
    writeReplayJsonFile(path.join(root, 'bad.json'), {
      toJSON: () => 'changed',
    }),
  ).rejects.toThrow('toJSON');
  expect(await fs.readdir(root)).toEqual([]);
});

test('memory profile records phase counters only and is opt-in', async () => {
  const file = path.join(root, 'memory.jsonl');
  const sample = createReplayMemoryProfile(file);
  sample?.('strategies:prepared', { symbols: 2 });
  const row = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(row).toMatchObject({
    schemaVersion: 1,
    pid: process.pid,
    phase: 'strategies:prepared',
    counts: { symbols: 2 },
  });
  expect(row.heapUsed).toBeGreaterThan(0);
  expect(row.maxRssKiB).toBeGreaterThan(0);
  expect(createReplayMemoryProfile('')).toBeUndefined();
});
