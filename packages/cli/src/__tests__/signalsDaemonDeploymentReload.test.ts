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
import { createSignalsRunner } from '../lib/signals/runner';
import { loadRuntimeStrategies } from '../lib/signals/runtimeStrategies';

const deployment = (version: number): RuntimeDeployment => ({
  id: 'doubletap-forward',
  label: 'DoubleTap forward',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      version,
      enabled: true,
      controlState: 'entries_paused',
    },
  ],
});

describe('signals daemon deployment reload', () => {
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
});
