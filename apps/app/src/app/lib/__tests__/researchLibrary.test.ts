/** @jest-environment node */
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeResearchMetricSnapshot } from '@tradejs/infra/researchMetricSnapshot';
import {
  getResearchArtifact,
  getResearchStudy,
  listResearchStudies,
} from '../researchLibrary';

const studyId = '2026-11-12-control';
const note = (body: string) =>
  [
    '---',
    'schema: tradejs-research/v2',
    "strategy: 'DoubleTap'",
    'date: 2026-11-12',
    'kind: backtest',
    'status: research-only',
    '---',
    '# Control research',
    '',
    '## Decision',
    'The control is retained.',
    '',
    '## Reported metrics',
    '| Direction | PnL |',
    '| --- | --- |',
    '| ALL | 12 |',
    '',
    body,
  ].join('\n');

let root: string;
let originalProject: string | undefined;
const writeNote = (body: string) =>
  writeFile(path.join(root, 'notes/DoubleTap', `${studyId}.md`), note(body));

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tradejs-research-library-'));
  originalProject = process.env.PROJECT_CWD;
  process.env.PROJECT_CWD = root;
  await mkdir(path.join(root, 'notes/DoubleTap'), { recursive: true });
  await mkdir(path.join(root, 'data/research/control'), { recursive: true });
});

afterEach(async () => {
  if (originalProject === undefined) delete process.env.PROJECT_CWD;
  else process.env.PROJECT_CWD = originalProject;
  await rm(root, { recursive: true, force: true });
});

it('lists dated strategy research and serves only the files linked by that study', async () => {
  await writeFile(path.join(root, 'private.html'), 'Private content');
  await writeFile(
    path.join(root, 'data/research/control/chart.png'),
    'Chart data',
  );
  await writeFile(
    path.join(root, 'data/research/control/unlinked.html'),
    'Unlinked',
  );
  await writeFile(
    path.join(root, 'data/research/control/report.html'),
    '<h1>Study report</h1>',
  );
  await symlink(
    path.join(root, 'private.html'),
    path.join(root, 'data/research/control/escape.html'),
  );
  await writeNote(
    [
      '## Artifact inventory',
      '- [Chart](../../data/research/control/chart.png)',
      '- [Outside the library](../../private.html)',
      '- [Symlink](../../data/research/control/escape.html)',
      '- [Remote](https://example.test/chart.png)',
      '{"path":"data/research/control/report.html"}',
    ].join('\n'),
  );

  await expect(listResearchStudies()).resolves.toEqual([
    expect.objectContaining({
      strategy: 'DoubleTap',
      id: studyId,
      title: 'Control research',
      date: '2026-11-12',
    }),
  ]);
  const detail = await getResearchStudy('DoubleTap', studyId);
  expect(detail?.sections).toContainEqual({
    title: 'Reported metrics',
    text: '| Direction | PnL |\n| --- | --- |\n| ALL | 12 |',
  });
  expect(detail?.artifacts).toEqual([
    { id: expect.any(String), label: 'Chart', kind: 'chart' },
    { id: expect.any(String), label: 'report.html', kind: 'report' },
  ]);
  const artifact = detail?.artifacts[0];
  if (!artifact) throw new Error('Expected a chart');
  await expect(
    getResearchArtifact('DoubleTap', studyId, artifact.id),
  ).resolves.toMatchObject({
    file: path.join(await realpath(root), 'data/research/control/chart.png'),
    contentType: 'image/png',
  });
  await expect(getResearchStudy('../DoubleTap', studyId)).resolves.toBeNull();
  await expect(
    getResearchArtifact('DoubleTap', studyId, '0'.repeat(24)),
  ).resolves.toBeNull();
});

it('builds a cumulative chart from a verified snapshot when the image is absent', async () => {
  const snapshot = encodeResearchMetricSnapshot({
    chart: {
      schema: 'tradejs-research-comparison-chart/v1',
      title: 'Control and candidate',
      pnlUnit: 'USDT',
      window: { start: 100, end: 200 },
      series: [
        {
          label: 'Control',
          trades: [
            [120, 12],
            [150, -2],
          ],
        },
      ],
    },
  });
  await writeNote(
    [
      '## Metrics snapshot (machine-readable)',
      '```json',
      JSON.stringify(snapshot),
      '```',
    ].join('\n'),
  );
  const result = await getResearchStudy('DoubleTap', studyId);
  expect(result?.chart?.series).toEqual([
    {
      label: 'Control',
      points: [
        [100, 0],
        [120, 12],
        [150, 10],
        [200, 10],
      ],
    },
  ]);
  expect(result?.sections.map(({ title }) => title)).toEqual([
    'Decision',
    'Reported metrics',
  ]);
});

it('reads reported sections after a large machine block in a legacy note', async () => {
  const body = [
    '## Reproduction manifest',
    '```json',
    'x'.repeat(9 * 1024 * 1024),
    '```',
    '## Reported metrics',
    '## Archived results',
    '| Direction | PnL |',
    '| --- | --- |',
    '| LONG | 8 |',
    '## Findings',
    'Only the original variant was retained.',
  ].join('\n');
  await writeFile(
    path.join(root, 'notes/DoubleTap', `${studyId}.md`),
    note(body).replace('tradejs-research/v2', 'tradejs-research/v1'),
  );
  await expect(listResearchStudies()).resolves.toHaveLength(1);
  const detail = await getResearchStudy('DoubleTap', studyId);
  expect(detail?.sections).toContainEqual({
    title: 'Reported metrics',
    text: '## Archived results\n| Direction | PnL |\n| --- | --- |\n| LONG | 8 |',
  });
  expect(detail?.sections).toContainEqual({
    title: 'Findings',
    text: 'Only the original variant was retained.',
  });
});
