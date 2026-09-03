import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createRuntimeEvidenceCompositionSnapshotRecorder,
  discoverRuntimeEvidenceCompositionSnapshots,
  publishRuntimeEvidenceCompositionSnapshot,
} from '../lib/runtimeEvidenceCompositionSnapshots';
import { loadRuntimeEvidenceCompositionSnapshots } from '../lib/runtimeEvidenceCompositions';
import type { RuntimeEvidenceDeploymentSnapshot } from '../lib/runtimeEvidenceDeployment';

const deployment: RuntimeEvidenceDeploymentSnapshot = {
  schemaVersion: 2,
  id: 'production',
  deploymentCompositionId: 'dc1:1111111111111111',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      strategyRevision: 'sr1:1111111111111111',
      enabled: true,
      controlState: 'active',
      interval: '15',
      universe: 'crypto',
      strategyPackage: '@tradejs/strategy-double-tap',
      strategyPackageVersion: '3.0.1',
      strategyDependencyVersions: {
        '@tradejs/core': '3.1.0',
      },
      runtimePackageVersion: '3.1.0',
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
  ],
};

const producer = {
  schemaVersion: 1 as const,
  projectSha: '1'.repeat(40),
  imageDigest: `sha256:${'2'.repeat(64)}`,
  runtimePackageManifest: {
    file: 'runtime-package-manifest.json' as const,
    sha256: '3'.repeat(64),
  },
};

describe('runtime evidence composition snapshots', () => {
  it('publishes and discovers one checksum-verified idempotent snapshot', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-evidence-composition-snapshot-'),
    );

    try {
      const first = await publishRuntimeEvidenceCompositionSnapshot({
        evidenceRoot: rootDir,
        userName: 'root',
        deployment,
        producer,
      });
      const second = await publishRuntimeEvidenceCompositionSnapshot({
        evidenceRoot: rootDir,
        userName: 'root',
        deployment,
        producer,
      });
      const discovered =
        await discoverRuntimeEvidenceCompositionSnapshots(rootDir);

      expect(second.bundleDir).toBe(first.bundleDir);
      expect(discovered).toHaveLength(1);
      expect(discovered[0]?.deployment).toEqual(deployment);
      expect(discovered[0]?.producer).toEqual(producer);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('reports a failed background write, then retries without blocking', async () => {
    const error = new Error('snapshot storage unavailable');
    const persist = jest
      .fn<Promise<void>, [string]>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce();
    const onError = jest.fn();
    const recorder = createRuntimeEvidenceCompositionSnapshotRecorder({
      persist,
      onError,
    });

    expect(
      recorder.observe(deployment.deploymentCompositionId),
    ).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(onError).toHaveBeenCalledWith(
      deployment.deploymentCompositionId,
      error,
    );
    recorder.observe(deployment.deploymentCompositionId);
    await new Promise((resolve) => setImmediate(resolve));
    recorder.observe(deployment.deploymentCompositionId);

    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('makes a verified standalone snapshot available to daily evidence', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-evidence-composition-loader-'),
    );
    const currentDeployment = {
      ...deployment,
      deploymentCompositionId: 'dc1:2222222222222222',
    };

    try {
      await publishRuntimeEvidenceCompositionSnapshot({
        evidenceRoot: rootDir,
        userName: 'root',
        deployment,
        producer,
      });

      const snapshots = await loadRuntimeEvidenceCompositionSnapshots({
        publishRoot: rootDir,
        currentDeployment,
        currentProducer: producer,
      });

      expect([...snapshots.keys()].sort()).toEqual([
        deployment.deploymentCompositionId,
        currentDeployment.deploymentCompositionId,
      ]);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
