import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendCoreResearchTraceEvent,
  getCoreResearchTraceFilePath,
  listCoreResearchTraceFiles,
} from '../coreResearchTraceFile';

describe('core research trace file', () => {
  it('serializes concurrent first events without losing a row', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-trace-'));
    try {
      const common = {
        strategyName: 'Fixture',
        chunkId: 'run-worker',
        outDir,
      };
      await Promise.all(
        ['a', 'b'].map((signalId, index) =>
          appendCoreResearchTraceEvent({
            ...common,
            event: {
              schema: 'tradejs-core-research-trace/v1',
              event: 'signal_emitted',
              timestamp: index + 1,
              strategy: 'Fixture',
              symbol: 'ETHUSDT',
              direction: 'LONG',
              signalId,
              setupIdentity: `setup-${signalId}`,
              setupIdentitySource: 'strategy-context',
            },
          }),
        ),
      );
      const filePath = getCoreResearchTraceFilePath(common);
      const rows = (await fs.readFile(filePath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(rows.map((row) => row.signalId).sort()).toEqual(['a', 'b']);
      await expect(
        listCoreResearchTraceFiles({
          strategyName: 'Fixture',
          runId: 'run',
          outDir,
        }),
      ).resolves.toEqual([filePath]);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });
});
