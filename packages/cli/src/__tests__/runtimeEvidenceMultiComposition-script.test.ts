import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const currentLineage = {
  schemaVersion: 3 as const,
  strategyRevision: 'sr1:2222222222222222',
  deploymentCompositionId: 'dc1:2222222222222222',
  strategyPackageVersion: '3.0.2',
  strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.2' },
  runtimePackageVersion: '3.2.0',
  maxLossValue: 1,
};

const previousLineage = {
  schemaVersion: 3 as const,
  strategyRevision: 'sr1:1111111111111111',
  deploymentCompositionId: 'dc1:1111111111111111',
  strategyPackageVersion: '3.0.1',
  strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.1' },
  runtimePackageVersion: '3.1.0',
  maxLossValue: 1,
};

const deployment = ({
  composition,
  revision,
  strategyVersion,
  runtimeVersion,
}: {
  composition: string;
  revision: string;
  strategyVersion: string;
  runtimeVersion: string;
}) => ({
  schemaVersion: 2 as const,
  id: 'production',
  deploymentCompositionId: composition,
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      strategyRevision: revision,
      enabled: true,
      controlState: 'active' as const,
      interval: '15' as const,
      universe: 'crypto' as const,
      strategyPackage: '@tradejs/strategy-double-tap',
      strategyPackageVersion: strategyVersion,
      strategyDependencyVersions: {
        '@tradejs/strategy-kit': strategyVersion,
      },
      runtimePackageVersion: runtimeVersion,
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
  ],
});

describe('runtime evidence with production composition changes', () => {
  it('publishes one exact-lineage artifact for every observed composition', async () => {
    jest.resetModules();
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-evidence-multi-composition-'),
    );
    const publishRoot = path.join(projectRoot, 'published');
    const outPath = path.join(projectRoot, 'runtime-evidence.json');
    const currentDeployment = deployment({
      composition: currentLineage.deploymentCompositionId,
      revision: currentLineage.strategyRevision,
      strategyVersion: currentLineage.strategyPackageVersion,
      runtimeVersion: currentLineage.runtimePackageVersion,
    });
    const previousDeployment = deployment({
      composition: previousLineage.deploymentCompositionId,
      revision: previousLineage.strategyRevision,
      strategyVersion: previousLineage.strategyPackageVersion,
      runtimeVersion: previousLineage.runtimePackageVersion,
    });
    const currentProducer = {
      schemaVersion: 1,
      projectSha: '2'.repeat(40),
      imageDigest: `sha256:${'2'.repeat(64)}`,
      runtimePackageManifest: {
        file: 'runtime-package-manifest.json',
        sha256: '2'.repeat(64),
      },
    };
    const previousProducer = {
      schemaVersion: 1,
      projectSha: '1'.repeat(40),
      imageDigest: `sha256:${'1'.repeat(64)}`,
      runtimePackageManifest: {
        file: 'runtime-package-manifest.json',
        sha256: '1'.repeat(64),
      },
    };
    const publishRuntimeEvidenceBundle = jest.fn(async ({ artifact }) => ({
      bundleDir: path.join(
        publishRoot,
        String(artifact.deployment.deploymentCompositionId),
      ),
    }));

    jest.doMock('args', () => ({
      __esModule: true,
      default: {
        option: jest.fn(),
        parse: jest.fn(() => ({
          user: 'root',
          startTime: 100,
          endTime: 400,
          deployment: 'production',
          publishDir: publishRoot,
          out: outPath,
        })),
      },
    }));
    jest.doMock('../lib/runtimeEvidenceProducer', () => ({
      ...jest.requireActual('../lib/runtimeEvidenceProducer'),
      resolveRuntimeEvidenceProducer: jest.fn(async () => currentProducer),
    }));
    jest.doMock('../lib/runtimeEvidenceDeployment', () => {
      const actual = jest.requireActual('../lib/runtimeEvidenceDeployment');
      return {
        ...actual,
        resolveRuntimeEvidenceDeploymentSnapshot: jest.fn(
          async () => currentDeployment,
        ),
      };
    });
    jest.doMock('../lib/runtimeDebugEvidence', () => {
      const actual = jest.requireActual('../lib/runtimeDebugEvidence');
      return {
        ...actual,
        collectRuntimeDebugEvidence: jest.fn(async () => ({
          dayKeys: ['1970-01-01'],
          evaluationStatsBuckets: [],
          trades: [
            {
              orderId: 'previous-order',
              strategy: 'DoubleTap',
              symbol: 'BTCUSDT',
              direction: 'LONG',
              qty: 1,
              entryPrice: 100,
              entryTimestamp: 150,
              deploymentId: 'production',
              accountId: 'bybit-default',
              runtimeLineage: previousLineage,
            },
          ],
          signals: [],
          evaluations: [
            {
              evaluationId: 'current-evaluation',
              userName: 'root',
              strategy: 'DoubleTap',
              symbol: 'ETHUSDT',
              interval: '15',
              timestamp: 300,
              evaluatedAt: 300,
              status: 'skip',
              deploymentId: 'production',
              accountId: 'bybit-default',
              runtimeLineage: currentLineage,
            },
          ],
          lineageScopes: [
            {
              strategy: 'DoubleTap',
              symbol: 'BTCUSDT',
              deploymentId: 'production',
              accountId: 'bybit-default',
              runtimeConfigId: previousLineage.strategyRevision,
              strategyRevision: previousLineage.strategyRevision,
              lineage: previousLineage,
              firstTimestamp: 100,
              lastTimestamp: 200,
            },
            {
              strategy: 'DoubleTap',
              symbol: 'ETHUSDT',
              deploymentId: 'production',
              accountId: 'bybit-default',
              runtimeConfigId: currentLineage.strategyRevision,
              strategyRevision: currentLineage.strategyRevision,
              lineage: currentLineage,
              firstTimestamp: 250,
              lastTimestamp: 400,
            },
          ],
        })),
      };
    });
    jest.doMock('../lib/runtimeEvidenceArtifacts', () => ({
      publishRuntimeEvidenceBundle,
      discoverRuntimeEvidenceBundles: jest.fn(async () => [
        '/verified/legacy',
        '/verified/previous',
      ]),
      verifyRuntimeEvidenceBundle: jest.fn(async (bundleDir: string) => ({
        artifact: {
          reportType: 'runtime-evidence',
          ...(bundleDir.endsWith('/legacy')
            ? {}
            : { producer: previousProducer }),
          deployment: previousDeployment,
          runtime: {
            trades: [],
            signals: [],
            evaluations: [],
            lineageScopes: [],
          },
        },
      })),
    }));

    try {
      const { runtimeEvidence } = await import('../scripts/runtimeEvidence');
      await runtimeEvidence();

      expect(publishRuntimeEvidenceBundle).toHaveBeenCalledTimes(2);
      expect(
        publishRuntimeEvidenceBundle.mock.calls.map(
          ([call]) => call.artifact.deployment.deploymentCompositionId,
        ),
      ).toEqual([
        previousLineage.deploymentCompositionId,
        currentLineage.deploymentCompositionId,
      ]);
      expect(
        publishRuntimeEvidenceBundle.mock.calls.map(
          ([call]) => call.artifact.runtime.counts,
        ),
      ).toEqual([
        { trades: 1, signals: 0, evaluations: 0, lineageScopes: 1 },
        { trades: 0, signals: 0, evaluations: 1, lineageScopes: 1 },
      ]);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);
});
