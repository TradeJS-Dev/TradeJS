import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeResearchReport } from './report-output.mjs';

test('file output preserves the full report and logs only a verifiable receipt', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-output-'));
  try {
    const report = {
      candidates: [
        {
          name: 'rejected',
          metrics: { ALL: 0, LONG: null, SHORT: -1 },
          equity: Array.from({ length: 1000 }, (_, i) => [i, i - 5]),
        },
      ],
    };
    for (const extension of ['json', 'md']) {
      const outputPath = path.join(dir, `report.${extension}`);
      let log = '';
      const receipt = await writeResearchReport({
        report,
        markdown: '# Report\n',
        json: true,
        outputPath,
        stdout: {
          write(text) {
            log += text;
          },
        },
      });
      const content = await fs.readFile(outputPath);
      assert.equal(
        receipt.sha256,
        createHash('sha256').update(content).digest('hex'),
      );
      assert.equal(receipt.bytes, content.length);
      assert.deepEqual(JSON.parse(log), receipt);
      assert.ok(log.length < 400);
      if (extension === 'json') assert.deepEqual(JSON.parse(content), report);
      else assert.equal(content.toString(), '# Report\n');
    }
    let log = '';
    await writeResearchReport({
      report,
      json: true,
      stdout: {
        write(text) {
          log += text;
        },
      },
    });
    assert.deepEqual(JSON.parse(log), report);
    await assert.rejects(
      writeResearchReport({ report, outputPath: path.join(dir, 'missing.md') }),
      /Missing report content/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
