const mockGetCurrentUserName = jest.fn();
const mockGetRuntimeDeploymentHeartbeat = jest.fn();
const mockListRuntimeDeployments = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/infra/runtimeHeartbeats', () => ({
  getRuntimeDeploymentHeartbeat: (...args: unknown[]) =>
    mockGetRuntimeDeploymentHeartbeat(...args),
}));

jest.mock('@tradejs/node/runtimeStrategies', () => ({
  listRuntimeDeployments: (...args: unknown[]) =>
    mockListRuntimeDeployments(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import * as route from '../route';

describe('read-only runtime deployments route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
  });

  it('returns Git-owned deployments with Redis heartbeats', async () => {
    mockListRuntimeDeployments.mockResolvedValue([
      {
        id: 'production',
        deploymentCompositionId: 'dc1:4444444444444444',
        label: 'Production',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'bybit-main',
        enabled: true,
        strategies: [
          {
            strategyName: 'DoubleTap',
            strategyRevision: 'sr1:4444444444444444',
            enabled: true,
            controlState: 'active',
          },
        ],
      },
    ]);
    mockGetRuntimeDeploymentHeartbeat.mockResolvedValue({
      deploymentId: 'production',
      status: 'running',
      lastCycleAt: 123,
    });

    const response = await route.GET();

    expect(mockListRuntimeDeployments).toHaveBeenCalledWith(
      expect.objectContaining({ userName: 'root' }),
    );
    expect(response.body.deployments).toEqual([
      expect.objectContaining({
        id: 'production',
        heartbeat: expect.objectContaining({ status: 'running' }),
      }),
    ]);
  });

  it('does not expose a deployment write endpoint', () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });
});
