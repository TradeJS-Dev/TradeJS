const mockGetData = jest.fn();
const mockSetData = jest.fn();

jest.mock('../redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  setData: (...args: unknown[]) => mockSetData(...args),
  redisKeys: {
    runtimeDeploymentHeartbeat: (userName: string, deploymentId: string) =>
      `users:${userName}:runtime:deployments:${deploymentId}:heartbeat`,
  },
}));

import {
  getRuntimeDeploymentHeartbeat,
  saveRuntimeDeploymentHeartbeat,
} from '../runtimeHeartbeats';

describe('runtime deployment heartbeats', () => {
  it('normalizes the Git-owned deployment id without storing a deployment', async () => {
    const heartbeat = {
      deploymentId: 'production',
      status: 'running' as const,
      pid: 42,
      startedAt: 100,
      lastCycleAt: 200,
    };
    mockGetData.mockResolvedValue(heartbeat);

    await saveRuntimeDeploymentHeartbeat('root', heartbeat);
    await expect(
      getRuntimeDeploymentHeartbeat('root', ' Production '),
    ).resolves.toEqual(heartbeat);

    expect(mockSetData).toHaveBeenCalledWith(
      'users:root:runtime:deployments:production:heartbeat',
      expect.objectContaining({ ...heartbeat, observedAt: expect.any(Number) }),
      { expire: 0 },
    );
  });
});

test('cycle observations preserve success/failure only within the same process and composition', async () => {
  const previous = {
    deploymentId: 'production',
    status: 'running' as const,
    pid: 42,
    startedAt: 100,
    lastCycleAt: 200,
    deploymentCompositionId: 'dc1:1111111111111111',
    lastSuccessfulCycleAt: 200,
  };
  mockGetData.mockResolvedValue(previous);
  const failed = await saveRuntimeDeploymentHeartbeat('root', {
    ...previous,
    cycleStatus: 'failed',
    lastCycleAt: 300,
    telemetryPersistence: 'failed',
  });
  expect(failed).toMatchObject({
    lastSuccessfulCycleAt: 200,
    lastFailedCycleAt: 300,
    telemetryPersistence: 'failed',
  });
  mockGetData.mockResolvedValue(failed);
  expect(
    await saveRuntimeDeploymentHeartbeat('root', {
      ...previous,
      cycleStatus: 'completed',
      lastCycleAt: 400,
    }),
  ).toMatchObject({ lastSuccessfulCycleAt: 400, lastFailedCycleAt: 300 });
  const restarted = await saveRuntimeDeploymentHeartbeat('root', {
    ...previous,
    pid: 43,
    startedAt: 400,
    lastSuccessfulCycleAt: undefined,
    lastCycleAt: 500,
    cycleStatus: 'failed',
  });
  expect(restarted.lastSuccessfulCycleAt).toBeUndefined();
});
