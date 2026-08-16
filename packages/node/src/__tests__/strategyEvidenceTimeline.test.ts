import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  StrategyEvidenceMarker,
  StrategyEvidenceMarkerEnvelope,
} from '@tradejs/types';
import {
  canonicalStrategyEvidenceJson,
  loadStrategyEvidenceTimelines,
  strategyEvidenceTimelineSelectorKey,
  verifyStrategyEvidenceMarkerEnvelope,
} from '../strategyEvidenceTimeline';

const SHA_A = 'a'.repeat(64);

const marker = (
  id: string,
  type: StrategyEvidenceMarker['type'],
  timestamp: number,
): StrategyEvidenceMarker => ({
  id,
  type,
  timestamp,
  label: `${type} event`,
  summary: `${type} evidence summary`,
  artifactId: `source-${type}`,
  artifactSha256: SHA_A,
});

const envelope = ({
  strategy = 'TrendLine',
  createdAt = Date.UTC(2026, 7, 12, 12),
  markers = [],
}: {
  strategy?: string;
  createdAt?: number;
  markers?: StrategyEvidenceMarker[];
} = {}): StrategyEvidenceMarkerEnvelope => {
  const payload = {
    strategy,
    createdAt,
    markers,
    sourceArtifacts: [
      { artifactId: 'source', sha256: SHA_A, path: '/private/source.json' },
    ],
  };
  const payloadSha256 = createHash('sha256')
    .update(canonicalStrategyEvidenceJson(payload))
    .digest('hex');
  const timestamp = new Date(createdAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('.000Z', 'Z');

  return {
    schema: 'tradejs-strategy-evidence-markers/v1',
    artifactId: `${strategy}_${timestamp}_${payloadSha256.slice(0, 16)}`,
    payloadSha256,
    payload,
  };
};

describe('strategy evidence timeline', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  const createRoot = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-evidence-'));
    roots.push(root);
    return root;
  };

  it('verifies canonical payload identity and returns only in-window markers', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine', 'nested');
    await fs.mkdir(markerDir, { recursive: true });
    const evidence = envelope({
      markers: [
        {
          ...marker('gate', 'G', 100),
          coverage: { startTime: 50, endTime: 120 },
        },
        marker('loss', 'L', 200),
        marker('boundary', 'E', 300),
        marker('deploy', 'D', 400),
        marker('parity', 'P', 500),
        marker('recommendation', 'R', 600),
      ],
    });
    await fs.writeFile(
      path.join(markerDir, `${evidence.artifactId}.json`),
      JSON.stringify(evidence),
    );

    expect(verifyStrategyEvidenceMarkerEnvelope(evidence)).toEqual(evidence);
    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: 'markers',
      selectors: [{ strategy: 'TrendLine' }],
      startTime: 150,
      endTime: 550,
    });

    expect(
      timelines.get(
        strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }),
      ),
    ).toEqual({
      status: 'verified',
      observedFrom: 200,
      markers: expect.arrayContaining([
        expect.objectContaining({ id: 'loss', type: 'L' }),
        expect.objectContaining({ id: 'boundary', type: 'E' }),
        expect.objectContaining({ id: 'deploy', type: 'D' }),
        expect.objectContaining({ id: 'parity', type: 'P' }),
      ]),
    });
    expect(
      timelines
        .get(strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }))
        ?.markers.map(({ id }) => id),
    ).toEqual(['loss', 'boundary', 'deploy', 'parity']);
  });

  it('marks a strategy invalid after any matching checksum failure', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    const valid = envelope({ markers: [marker('gate', 'G', 200)] });
    const tampered = {
      ...valid,
      payload: {
        ...valid.payload,
        markers: [{ ...valid.payload.markers[0], summary: 'tampered' }],
      },
    };
    await Promise.all([
      fs.writeFile(path.join(markerDir, 'valid.json'), JSON.stringify(valid)),
      fs.writeFile(
        path.join(markerDir, `${valid.artifactId}-tampered.json`),
        JSON.stringify(tampered),
      ),
    ]);

    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors: [{ strategy: 'TrendLine' }],
      startTime: 0,
      endTime: 1_000,
    });

    expect(
      timelines.get(
        strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }),
      ),
    ).toEqual({
      status: 'invalid',
      observedFrom: null,
      markers: [],
    });
  });

  it('marks malformed JSON in the strategy marker directory invalid', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    await fs.writeFile(path.join(markerDir, 'broken.json'), '{broken');

    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors: [{ strategy: 'TrendLine' }],
      startTime: 0,
      endTime: 1_000,
    });

    const timeline = timelines.get(
      strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }),
    );
    expect(timeline?.status).toBe('invalid');
    expect(timeline?.markers).toEqual([]);
  });

  it('invalidates a strategy directory containing another strategy envelope', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    const misplaced = envelope({
      strategy: 'Grid',
      markers: [marker('gate', 'G', 200)],
    });
    await fs.writeFile(
      path.join(markerDir, `${misplaced.artifactId}.json`),
      JSON.stringify(misplaced),
    );

    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors: [{ strategy: 'Grid' }, { strategy: 'TrendLine' }],
      startTime: 0,
      endTime: 1_000,
    });

    expect(
      timelines.get(
        strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }),
      )?.status,
    ).toBe('invalid');
    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey({ strategy: 'Grid' }))
        ?.status,
    ).toBe('verified');
  });

  it('rejects conflicting immutable marker ids across verified envelopes', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    const first = envelope({ markers: [marker('same-id', 'G', 200)] });
    const second = envelope({
      createdAt: Date.UTC(2026, 7, 13, 12),
      markers: [marker('same-id', 'L', 300)],
    });
    await Promise.all(
      [first, second].map((value) =>
        fs.writeFile(
          path.join(markerDir, `${value.artifactId}.json`),
          JSON.stringify(value),
        ),
      ),
    );

    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors: [{ strategy: 'TrendLine' }],
      startTime: 0,
      endTime: 1_000,
    });

    const timeline = timelines.get(
      strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }),
    );
    expect(timeline?.status).toBe('invalid');
    expect(timeline?.markers).toEqual([]);
  });

  it('reports missing explicitly without reading mutable state', async () => {
    const root = await createRoot();
    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      selectors: [{ strategy: 'TrendLine' }],
      startTime: 0,
      endTime: 1_000,
    });

    expect(
      timelines.get(
        strategyEvidenceTimelineSelectorKey({ strategy: 'TrendLine' }),
      ),
    ).toEqual({
      status: 'missing',
      observedFrom: null,
      markers: [],
    });
  });

  it('does not attach evidence from another frozen composition', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    const configA = 'b'.repeat(16);
    const configB = 'c'.repeat(16);
    const value = envelope({
      markers: [
        {
          ...marker('gate', 'G', 200),
          compositionId: 'composition-a',
          gateFingerprint: 'd'.repeat(16),
          configFingerprint: configA,
        },
      ],
    });
    await fs.writeFile(
      path.join(markerDir, `${value.artifactId}.json`),
      JSON.stringify(value),
    );

    const selectors = [
      { strategy: 'TrendLine', configFingerprint: configA },
      { strategy: 'TrendLine', configFingerprint: configB },
    ];
    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors,
      startTime: 0,
      endTime: 1_000,
    });

    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(selectors[0]))?.status,
    ).toBe('verified');
    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(selectors[1]))?.status,
    ).toBe('missing');
  });

  it('requires complete runtime lineage before attaching release markers', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    const exact = {
      strategy: 'TrendLine',
      compositionId: 'TrendLine_release_1',
      gitSha: 'deadbeef',
      gateFingerprint: 'b'.repeat(16),
      configFingerprint: 'c'.repeat(16),
      contextFingerprint: 'd'.repeat(16),
      maxLossValue: 10,
      requireCompleteLineage: true,
    };
    const value = envelope({
      markers: [
        {
          ...marker('gate', 'G', 200),
          compositionId: exact.compositionId,
          gitSha: exact.gitSha,
          gateFingerprint: exact.gateFingerprint,
          configFingerprint: exact.configFingerprint,
          contextFingerprint: exact.contextFingerprint,
          maxLossValue: exact.maxLossValue,
        },
      ],
    });
    await fs.writeFile(
      path.join(markerDir, `${value.artifactId}.json`),
      JSON.stringify(value),
    );

    const selectors = [
      exact,
      { ...exact, contextFingerprint: null },
      { ...exact, compositionId: null },
      { ...exact, compositionId: 'another-release' },
    ];
    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors,
      startTime: 0,
      endTime: 1_000,
    });

    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(selectors[0]))?.status,
    ).toBe('verified');
    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(selectors[1]))?.status,
    ).toBe('missing');
    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(selectors[2]))?.status,
    ).toBe('missing');
    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(selectors[3]))?.status,
    ).toBe('missing');
  });

  it('keeps logic evidence and loss-scale markers across MAX_LOSS_VALUE changes', async () => {
    const root = await createRoot();
    const markerDir = path.join(root, 'markers', 'TrendLine');
    await fs.mkdir(markerDir, { recursive: true });
    const logic = {
      strategy: 'TrendLine',
      compositionId: 'TrendLine_release_1',
      gitSha: 'deadbeef',
      gateFingerprint: 'b'.repeat(16),
      configFingerprint: 'c'.repeat(16),
      contextFingerprint: 'd'.repeat(16),
      maxLossValue: 1,
      requireCompleteLineage: true,
    };
    const value = envelope({
      markers: [
        {
          ...marker('gate', 'G', 200),
          ...logic,
          maxLossValue: 10,
        },
        {
          ...marker('loss-10', 'L', 210),
          ...logic,
          maxLossValue: 10,
        },
      ],
    });
    await fs.writeFile(
      path.join(markerDir, `${value.artifactId}.json`),
      JSON.stringify(value),
    );

    const timelines = await loadStrategyEvidenceTimelines({
      projectRoot: root,
      markerDir: path.join(root, 'markers'),
      selectors: [logic],
      startTime: 0,
      endTime: 1_000,
    });

    expect(
      timelines.get(strategyEvidenceTimelineSelectorKey(logic)),
    ).toMatchObject({
      status: 'verified',
      markers: [
        expect.objectContaining({ id: 'gate', type: 'G' }),
        expect.objectContaining({
          id: 'loss-10',
          type: 'L',
          maxLossValue: 10,
        }),
      ],
    });
  });
});
