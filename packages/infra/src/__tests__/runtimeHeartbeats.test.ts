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
      heartbeat,
      { expire: 0 },
    );
  });
});
