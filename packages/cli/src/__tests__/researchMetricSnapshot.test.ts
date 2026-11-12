import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  encodeResearchMetricSnapshot,
  decodeResearchMetricSnapshot,
} from '@tradejs/infra/researchMetricSnapshot';

describe('portable permanent metric snapshots', () => {
  it('round trips the native report through the installed-skill decoder without losing fields', () => {
    const metrics = {
      candidates: [
        {
          id: 'rejected',
          ALL: { pnl: 0, pf: null },
          LONG: { pnl: -1 },
          SHORT: { pnl: 1 },
          config: { enabled: false },
          chart: [
            [0, 0],
            [1, -1],
          ],
        },
      ],
    };
    const encoded = encodeResearchMetricSnapshot(metrics);
    expect(decodeResearchMetricSnapshot(encoded)).toEqual(metrics);
    const moduleUrl = pathToFileURL(
      path.resolve(
        '.codex/skills/strategy-backtest-research/scripts/metric-snapshot.mjs',
      ),
    ).href;
    const decoded = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {decodeMetricSnapshot} from ${JSON.stringify(moduleUrl)}; let input='';for await(const c of process.stdin)input+=c;process.stdout.write(JSON.stringify(decodeMetricSnapshot(JSON.parse(input))));`,
      ],
      { input: JSON.stringify(encoded), encoding: 'utf8' },
    );
    expect(JSON.parse(decoded)).toEqual(metrics);
    expect(() =>
      decodeResearchMetricSnapshot({ ...encoded, sha256: '0'.repeat(64) }),
    ).toThrow('checksum');
    expect(() =>
      decodeResearchMetricSnapshot({ ...encoded, decodedBytes: 1024 ** 3 }),
    ).toThrow('Invalid');
    expect(() => decodeResearchMetricSnapshot(null)).toThrow('Invalid');
    expect(() => encodeResearchMetricSnapshot({ matchedPairs: [{}] })).toThrow(
      'Temporary',
    );
    expect(() =>
      encodeResearchMetricSnapshot({ trades: [{ signalId: 's' }] }),
    ).toThrow('Temporary');
  });
});
