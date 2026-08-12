import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { summarizeCoreResearchTrace } from '../trace';

describe('core research trace summary', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-trace-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('aggregates event and skip counts across shards with stable ordering', async () => {
    const first = path.join(tempRoot, 'first.jsonl');
    const second = path.join(tempRoot, 'second.jsonl');
    await fs.writeFile(
      first,
      [
        { schema: 'tradejs-core-research-trace/v1', event: 'setup_detected' },
        {
          schema: 'tradejs-core-research-trace/v1',
          event: 'skip_summary',
          skipCounts: { NO_PATTERN: 4, COOLDOWN: 2 },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
      'utf8',
    );
    await fs.writeFile(
      second,
      `${JSON.stringify({
        schema: 'tradejs-core-research-trace/v1',
        event: 'skip_summary',
        skipCounts: { COOLDOWN: 3, BAD_RISK: 5 },
      })}\n`,
      'utf8',
    );

    expect(await summarizeCoreResearchTrace([first, second])).toEqual({
      events: { setup_detected: 1, skip_summary: 2 },
      skipCounts: { BAD_RISK: 5, COOLDOWN: 5, NO_PATTERN: 4 },
    });
  });

  it('returns an empty funnel without requiring trace capture', async () => {
    await expect(summarizeCoreResearchTrace()).resolves.toEqual({
      events: {},
      skipCounts: {},
    });
  });

  it('attributes malformed trace JSON to the exact shard and line', async () => {
    const filePath = path.join(tempRoot, 'bad.jsonl');
    await fs.writeFile(filePath, '{}\n{bad}\n', 'utf8');
    await expect(summarizeCoreResearchTrace([filePath])).rejects.toThrow(
      `${filePath}:2 contains invalid trace JSON`,
    );
  });
});
