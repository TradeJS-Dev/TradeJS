import type { RuntimeDeployment } from '@tradejs/types';

jest.mock('@tradejs/infra/runtimeHeartbeats', () => ({
  saveRuntimeDeploymentHeartbeat: jest.fn(),
}));
jest.mock('@tradejs/node/runtimeStrategies', () => ({
  getRuntimeDeployment: jest.fn(),
}));
jest.mock('@tradejs/node/connectors', () => ({
  DEFAULT_CONNECTOR_NAME: 'bybit',
  getConnectorCreatorByName: jest.fn(),
  resolveConnectorName: jest.fn(async (value: string) => value),
}));
jest.mock('../lib/signals/runtimeStrategies', () => ({
  loadRuntimeStrategies: jest.fn(async () => []),
}));
jest.mock('../lib/runtimeEvidenceCompositionSnapshots', () => {
  const actual = jest.requireActual(
    '../lib/runtimeEvidenceCompositionSnapshots',
  );
  return {
    ...actual,
    captureRuntimeEvidenceCompositionSnapshot: jest.fn(),
  };
});
jest.mock('../lib/signals/daemon', () => ({
  getSignalsHeartbeatStatus: jest.fn(),
  runSignalsDaemon: jest.fn(
    async ({ runCycle }: { runCycle: () => Promise<void> }) => {
      await runCycle();
      await runCycle();
    },
  ),
}));

import { getRuntimeDeployment } from '@tradejs/node/runtimeStrategies';
import { captureRuntimeEvidenceCompositionSnapshot } from '../lib/runtimeEvidenceCompositionSnapshots';
import { createSignalsRunner } from '../lib/signals/runner';
import { loadRuntimeStrategies } from '../lib/signals/runtimeStrategies';

const deployment = (revisionDigit: number): RuntimeDeployment => ({
  id: 'doubletap-forward',
  deploymentCompositionId: `dc1:${String(revisionDigit).repeat(16)}`,
  label: 'DoubleTap forward',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      strategyRevision: `sr1:${String(revisionDigit).repeat(16)}`,
      enabled: true,
      controlState: 'entries_paused',
    },
  ],
});

describe('signals daemon deployment reload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(captureRuntimeEvidenceCompositionSnapshot)
      .mockResolvedValue(undefined);
  });

  it('loads the current deployment again for every cycle', async () => {
    const first = deployment(2);
    const second = deployment(3);
    jest
      .mocked(getRuntimeDeployment)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await createSignalsRunner({
      userName: 'root',
      projectRoot: '/project',
      interval: '15',
      connectorName: 'bybit',
      deploymentId: 'doubletap-forward',
      makeOrders: false,
      notify: false,
      skipScreenshots: true,
      updateOnly: false,
      cacheOnly: true,
      showTickersList: false,
      showSkipStats: false,
    }).runDaemon();

    expect(getRuntimeDeployment).toHaveBeenCalledTimes(3);
    expect(
      jest.mocked(loadRuntimeStrategies).mock.calls[0]?.[0].deploymentId,
    ).toBe(first.id);
    expect(
      jest.mocked(loadRuntimeStrategies).mock.calls[1]?.[0].deploymentId,
    ).toBe(second.id);
  });

  it('keeps running and retries when a composition snapshot cannot be saved', async () => {
    const current = deployment(4);
    const snapshotError = new Error('snapshot storage unavailable');
    const previousProjectSha = process.env.TRADEJS_PROJECT_SHA;
    const previousImageDigest = process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
    process.env.TRADEJS_PROJECT_SHA = '1'.repeat(40);
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = `sha256:${'2'.repeat(64)}`;
    jest.mocked(getRuntimeDeployment).mockResolvedValue(current);
    jest
      .mocked(captureRuntimeEvidenceCompositionSnapshot)
      .mockRejectedValueOnce(snapshotError)
      .mockResolvedValueOnce(undefined);

    try {
      await createSignalsRunner({
        userName: 'root',
        projectRoot: '/project',
        interval: '15',
        connectorName: 'bybit',
        deploymentId: 'doubletap-forward',
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
      }).runDaemon();

      await new Promise((resolve) => setImmediate(resolve));
      expect(loadRuntimeStrategies).toHaveBeenCalledTimes(2);
      expect(captureRuntimeEvidenceCompositionSnapshot).toHaveBeenCalledTimes(
        2,
      );
    } finally {
      if (previousProjectSha == null) {
        delete process.env.TRADEJS_PROJECT_SHA;
      } else {
        process.env.TRADEJS_PROJECT_SHA = previousProjectSha;
      }
      if (previousImageDigest == null) {
        delete process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
      } else {
        process.env.TRADEJS_PROJECT_IMAGE_DIGEST = previousImageDigest;
      }
    }
  });
});
