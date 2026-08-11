import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  publishRuntimeEvidenceBundle,
  RUNTIME_EVIDENCE_PAYLOAD_FILE,
  verifyRuntimeEvidenceBundle,
} from '../lib/runtimeEvidenceArtifacts';
import {
  listPendingRuntimeEvidenceBundles,
  markRuntimeEvidenceBundleProcessed,
  syncRuntimeEvidenceBundles,
} from '../lib/runtimeEvidenceSync';

const createArtifact = (startTime: number, endTime: number) => ({
  reportType: 'runtime-evidence',
  generatedAt: endTime,
  userName: 'root',
  window: { startTime, endTime },
  runtime: {
    counts: { trades: 1, signals: 1, evaluations: 1 },
  },
});

describe('runtime evidence artifacts', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-evidence-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('publishes a complete immutable bundle and verifies its checksum', async () => {
    const startTime = Date.UTC(2026, 7, 6, 18);
    const endTime = Date.UTC(2026, 7, 7, 18);
    const bundle = await publishRuntimeEvidenceBundle({
      publishRoot: rootDir,
      deploymentId: 'production',
      userName: 'root',
      startTime,
      endTime,
      artifact: createArtifact(startTime, endTime),
      counts: { trades: 1, signals: 1, evaluations: 1 },
      lineageKeys: ['lineage-b', 'lineage-a', 'lineage-a'],
    });

    expect(bundle.manifest.deploymentId).toBe('production');
    expect(bundle.manifest.lineageKeys).toEqual(['lineage-a', 'lineage-b']);
    expect(bundle.artifact.reportType).toBe('runtime-evidence');

    await fs.appendFile(
      path.join(bundle.bundleDir, RUNTIME_EVIDENCE_PAYLOAD_FILE),
      'tampered',
    );
    await expect(verifyRuntimeEvidenceBundle(bundle.bundleDir)).rejects.toThrow(
      /size mismatch|checksum mismatch/,
    );
  });

  it('deduplicates repeated publication of the same completed window', async () => {
    const startTime = Date.UTC(2026, 7, 6, 18);
    const endTime = Date.UTC(2026, 7, 7, 18);
    const firstArtifact = createArtifact(startTime, endTime);
    const secondArtifact = {
      ...createArtifact(startTime, endTime),
      generatedAt: endTime + 1_000,
    };

    const first = await publishRuntimeEvidenceBundle({
      publishRoot: rootDir,
      deploymentId: 'production',
      userName: 'root',
      startTime,
      endTime,
      artifact: firstArtifact,
      counts: { trades: 1 },
      lineageKeys: [],
    });
    const second = await publishRuntimeEvidenceBundle({
      publishRoot: rootDir,
      deploymentId: 'production',
      userName: 'root',
      startTime,
      endTime,
      artifact: secondArtifact,
      counts: { trades: 1 },
      lineageKeys: [],
    });

    expect(second.bundleDir).toBe(first.bundleDir);
    expect(second.manifest.payload.sha256).toBe(first.manifest.payload.sha256);
    expect(second.artifact.generatedAt).toBe(firstArtifact.generatedAt);
  });

  it('syncs ready bundles, keeps them pending, and writes a receipt', async () => {
    const publishRoot = path.join(rootDir, 'server');
    const evidenceRoot = path.join(rootDir, 'local');
    const startTime = Date.UTC(2026, 7, 6, 18);
    const endTime = Date.UTC(2026, 7, 7, 18);
    const published = await publishRuntimeEvidenceBundle({
      publishRoot,
      deploymentId: 'production',
      userName: 'root',
      startTime,
      endTime,
      artifact: createArtifact(startTime, endTime),
      counts: { trades: 1 },
      lineageKeys: [],
    });

    const result = await syncRuntimeEvidenceBundles({
      source: path.join(publishRoot, 'ready', 'production'),
      evidenceRoot,
      deploymentId: 'production',
      runRsync: async (rsyncArgs) => {
        const destination = rsyncArgs.at(-1)!.replace(/\/$/, '');
        await fs.cp(
          published.bundleDir,
          path.join(destination, published.manifest.artifactId),
          { recursive: true },
        );
        return {};
      },
    });

    expect(result.received).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    await markRuntimeEvidenceBundleProcessed({
      evidenceRoot,
      deploymentId: 'production',
      bundleDir: result.pending[0].bundleDir,
      scorecardPath: '/tmp/scorecard.json',
    });
    await expect(
      listPendingRuntimeEvidenceBundles({
        evidenceRoot,
        deploymentId: 'production',
      }),
    ).resolves.toHaveLength(0);
  });
});
