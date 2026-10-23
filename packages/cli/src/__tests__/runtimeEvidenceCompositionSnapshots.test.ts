import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createRuntimeEvidenceCompositionSnapshotRecorder,
  discoverRuntimeEvidenceCompositionSnapshots,
  publishRuntimeEvidenceCompositionSnapshot,
} from '../lib/runtimeEvidenceCompositionSnapshots';
import {
  loadRuntimeEvidenceCompositionSnapshots,
  splitRuntimeEvidenceByComposition,
} from '../lib/runtimeEvidenceCompositions';
import { publishRuntimeEvidenceBundle } from '../lib/runtimeEvidenceArtifacts';
import type { RuntimeDebugEvidence } from '../lib/runtimeDebugEvidence';
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

  it('accepts a changed entry pause for the same composition but rejects changed config', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-evidence-composition-pause-'),
    );

    try {
      await publishRuntimeEvidenceCompositionSnapshot({
        evidenceRoot: rootDir,
        userName: 'root',
        deployment,
        producer,
      });

      const pausedDeployment = {
        ...deployment,
        strategies: [
          {
            ...deployment.strategies[0]!,
            controlState: 'entries_paused' as const,
          },
        ],
      };
      const snapshots = await loadRuntimeEvidenceCompositionSnapshots({
        publishRoot: rootDir,
        currentDeployment: pausedDeployment,
        currentProducer: producer,
      });
      expect(
        snapshots.get(deployment.deploymentCompositionId)?.deployment,
      ).toEqual(pausedDeployment);

      await expect(
        loadRuntimeEvidenceCompositionSnapshots({
          publishRoot: rootDir,
          currentDeployment: {
            ...pausedDeployment,
            strategies: [
              {
                ...pausedDeployment.strategies[0]!,
                strategyConfig: { INTERVAL: '60', UNIVERSE: 'crypto' },
              },
            ],
          },
          currentProducer: producer,
        }),
      ).rejects.toThrow('Current runtime deployment conflicts');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('historical producer changes', () => {
  it.each([false, true])(
    'isolates historical producer ambiguity regardless of discovery order (reverse=%s)',
    async (reverse) => {
      const rootDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'runtime-evidence-producers-'),
      );
      const otherProducer = {
        ...producer,
        projectSha: '4'.repeat(40),
        imageDigest: `sha256:${'5'.repeat(64)}`,
      };
      const currentDeployment = {
        ...deployment,
        deploymentCompositionId: 'dc1:2222222222222222',
      };
      const evidence: RuntimeDebugEvidence = {
        dayKeys: [],
        trades: [],
        signals: [],
        evaluations: [],
        evaluationStatsBuckets: [],
        lineageScopes: [],
      };
      try {
        const sources = reverse
          ? [otherProducer, producer, producer]
          : [producer, producer, otherProducer];
        for (const [index, source] of sources.entries()) {
          await publishRuntimeEvidenceBundle({
            publishRoot: rootDir,
            deploymentId: deployment.id,
            userName: 'root',
            startTime: index * 1000,
            endTime: (index + 1) * 1000,
            artifact: {
              reportType: 'runtime-evidence',
              userName: 'root',
              generatedAt: 3000,
              deployment: { ...deployment, tickers: ['BTCUSDT'] },
              producer: source,
              window: { startTime: index * 1000, endTime: (index + 1) * 1000 },
              runtime: {
                counts: {},
                trades: [],
                signals: [],
                evaluations: [],
                lineageScopes: [],
              },
            },
            counts: {},
            lineageKeys: [],
          });
        }
        const snapshots = await loadRuntimeEvidenceCompositionSnapshots({
          publishRoot: rootDir,
          currentDeployment,
          currentProducer: producer,
        });
        expect(
          snapshots.get(deployment.deploymentCompositionId)?.producer,
        ).toBeNull();
        expect(
          snapshots.get(deployment.deploymentCompositionId)?.producerVariants,
        ).toHaveLength(2);
        const strategy = deployment.strategies[0]!;
        const scope = (compositionId: string) => ({
          strategy: strategy.strategyName,
          symbol: 'BTCUSDT',
          deploymentId: deployment.id,
          accountId: deployment.accountId,
          firstTimestamp: 4000,
          lastTimestamp: 5000,
          lineage: {
            schemaVersion: 3 as const,
            strategyRevision: strategy.strategyRevision,
            deploymentCompositionId: compositionId,
            strategyPackageVersion: strategy.strategyPackageVersion,
            strategyDependencyVersions: strategy.strategyDependencyVersions,
            runtimePackageVersion: strategy.runtimePackageVersion,
          },
        });
        const freshEvidence = {
          ...evidence,
          lineageScopes: [scope(currentDeployment.deploymentCompositionId)],
        };
        const fresh = splitRuntimeEvidenceByComposition({
          evidence: freshEvidence,
          snapshots,
        });
        expect(fresh).toHaveLength(1);
        expect(fresh[0]?.producer).toEqual(producer);
        expect(fresh[0]?.lineageScopes).toEqual(freshEvidence.lineageScopes);
        expect(() =>
          splitRuntimeEvidenceByComposition({
            evidence: {
              ...freshEvidence,
              lineageScopes: [
                ...freshEvidence.lineageScopes,
                scope(deployment.deploymentCompositionId),
              ],
            },
            snapshots,
          }),
        ).toThrow('Ambiguous runtime evidence producer');
        const sameComposition = await loadRuntimeEvidenceCompositionSnapshots({
          publishRoot: rootDir,
          currentDeployment: deployment,
          currentProducer: producer,
        });
        expect(() =>
          splitRuntimeEvidenceByComposition({
            evidence,
            snapshots: sameComposition,
            includeEmptyCompositionIds: [deployment.deploymentCompositionId],
          }),
        ).toThrow('Ambiguous runtime evidence producer');
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    },
  );
  it('does not overwrite an old standalone snapshot with the current image for the same composition', async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-evidence-current-image-'),
    );
    try {
      await publishRuntimeEvidenceCompositionSnapshot({
        evidenceRoot: rootDir,
        userName: 'root',
        deployment,
        producer,
      });
      const currentProducer = {
        ...producer,
        imageDigest: `sha256:${'9'.repeat(64)}`,
      };
      const snapshots = await loadRuntimeEvidenceCompositionSnapshots({
        publishRoot: rootDir,
        currentDeployment: deployment,
        currentProducer,
      });
      expect(
        snapshots.get(deployment.deploymentCompositionId)?.producerVariants,
      ).toEqual([producer, currentProducer]);
      expect(
        (await discoverRuntimeEvidenceCompositionSnapshots(rootDir))[0]
          ?.producer,
      ).toEqual(producer);
      expect(() =>
        splitRuntimeEvidenceByComposition({
          evidence: {
            dayKeys: [],
            trades: [],
            signals: [],
            evaluations: [],
            evaluationStatsBuckets: [],
            lineageScopes: [],
          },
          snapshots,
          includeEmptyCompositionIds: [deployment.deploymentCompositionId],
        }),
      ).toThrow('Ambiguous runtime evidence producer');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
