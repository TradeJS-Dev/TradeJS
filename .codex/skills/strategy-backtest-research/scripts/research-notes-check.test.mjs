import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeMetricSnapshot } from './metric-snapshot.mjs';

test('note validation accepts old records and verifies new standalone snapshots', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compact-note-'));
  const filename = path.join(dir, 'notes', 'Shared', '2026-11-06-storage.md');
  const sections = [
    'Research question',
    'Decision',
    'Reproduction manifest',
    'Resolved configuration',
    'Metrics snapshot (machine-readable)',
    'Reported metrics',
    'Findings',
    'Artifact inventory',
    'Limitations and next step',
  ];
  const note = (schema, snapshot) =>
    `---\nschema: ${schema}\nstrategy: 'Shared'\ndate: '2026-11-06'\nkind: architecture\nstatus: implemented\nreproduction: complete\n---\n` +
    sections
      .map(
        (s) =>
          `## ${s}\n\n${s === sections[4] ? '```json\n' + JSON.stringify(snapshot) + '\n```\n' : 'Recorded.\n'}`,
      )
      .join('\n');
  const check = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./research-notes-check.mjs', import.meta.url))],
      { env: { ...process.env, PROJECT_CWD: dir }, encoding: 'utf8' },
    );
  try {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(
      filename,
      note('tradejs-research/v1', { matchedPairs: [{}] }),
    );
    assert.equal(check().status, 0);
    await fs.writeFile(
      filename,
      '---\nschema: tradejs-research/v1\nstrategy: Shared\ndate: 2026-11-06\nkind: architecture\nstatus: historical\nreproduction: legacy-partial\n---\nOriginal historical body.\n',
    );
    assert.equal(check().status, 0);
    const snapshot = encodeMetricSnapshot({
      ALL: { trades: 0 },
      LONG: {},
      SHORT: {},
    });
    await fs.writeFile(filename, note('tradejs-research/v2', snapshot));
    assert.equal(check().status, 0);
    await fs.writeFile(
      filename,
      note('tradejs-research/v2', { ...snapshot, sha256: '0'.repeat(64) }),
    );
    assert.match(check().stderr, /checksum/);
    await fs.writeFile(
      filename,
      note('tradejs-research/v2', { matchedPairs: [{}] }),
    );
    assert.match(check().stderr, /Temporary payload/);
    assert.notEqual(check().status, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
