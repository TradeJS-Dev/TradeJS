const mockGetCurrentUserName = jest.fn();
const mockGetRuntimeDeploymentHeartbeat = jest.fn();
const mockGetRuntimeStrategyRelease = jest.fn();
const mockGetTradingAccount = jest.fn();
const mockListRuntimeDeployments = jest.fn();
const mockSaveRuntimeDeployment = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  getTradingAccount: (...args: unknown[]) => mockGetTradingAccount(...args),
}));

jest.mock('@tradejs/infra/runtimeDeployments', () => ({
  getRuntimeDeploymentHeartbeat: (...args: unknown[]) =>
    mockGetRuntimeDeploymentHeartbeat(...args),
  listRuntimeDeployments: (...args: unknown[]) =>
    mockListRuntimeDeployments(...args),
  saveRuntimeDeployment: (...args: unknown[]) =>
    mockSaveRuntimeDeployment(...args),
}));

jest.mock('@tradejs/infra/runtimeStrategyReleases', () => ({
  getRuntimeStrategyRelease: (...args: unknown[]) =>
    mockGetRuntimeStrategyRelease(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { GET, POST } from '../route';

const request = (body: Record<string, unknown>) =>
  ({ json: async () => body }) as any;
const deployment = (overrides: Record<string, unknown> = {}) => ({
  id: 'tradfi-live',
  label: 'TradFi Live',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'tradfi-main',
  enabled: true,
  strategies: [
    {
      strategyName: 'TrendLine',
      releaseVersion: 2,
      controlState: 'active',
    },
  ],
  ...overrides,
});

describe('runtime deployments route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetTradingAccount.mockResolvedValue({
      id: 'tradfi-main',
      provider: 'bybit',
      enabled: true,
      universes: ['tradfi'],
    });
    mockGetRuntimeStrategyRelease.mockResolvedValue({
      strategyName: 'TrendLine',
      releaseVersion: 2,
      config: { INTERVAL: '15', UNIVERSE: 'tradfi' },
    });
  });

  it('returns deployments with their heartbeats', async () => {
    mockListRuntimeDeployments.mockResolvedValue([deployment()]);
    mockGetRuntimeDeploymentHeartbeat.mockResolvedValue({
      deploymentId: 'tradfi-live',
      status: 'running',
      lastCycleAt: 123,
    });

    const response = await GET();

    expect(response.body.deployments).toEqual([
      expect.objectContaining({
        id: 'tradfi-live',
        heartbeat: expect.objectContaining({ status: 'running' }),
      }),
    ]);
  });

  it('rejects malformed deployments and disabled accounts', async () => {
    const malformed = await POST(request(deployment({ strategies: [] })));
    expect(malformed).toEqual({
      status: 400,
      body: { error: 'Invalid runtime strategy reference' },
    });

    mockGetTradingAccount.mockResolvedValue({
      id: 'tradfi-main',
      provider: 'bybit',
      enabled: false,
      universes: ['tradfi'],
    });
    const disabled = await POST(request(deployment()));
    expect(disabled).toEqual({
      status: 400,
      body: { error: 'Deployment trading account is unavailable' },
    });
    expect(mockSaveRuntimeDeployment).not.toHaveBeenCalled();
  });

  it('rejects a universe unsupported by the selected account', async () => {
    mockGetTradingAccount.mockResolvedValue({
      id: 'tradfi-main',
      provider: 'bybit',
      enabled: true,
      universes: ['crypto'],
    });

    const response = await POST(request(deployment()));

    expect(response).toEqual({
      status: 400,
      body: { error: 'Account tradfi-main does not support tradfi' },
    });
  });

  it('persists a valid deployment', async () => {
    mockSaveRuntimeDeployment.mockImplementation(
      async (_userName: string, value: unknown) => value,
    );

    const response = await POST(
      request(
        deployment({
          assetClasses: ['equity'],
          tickers: ['AAPLUSDT'],
        }),
      ),
    );

    expect(mockSaveRuntimeDeployment).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        id: 'tradfi-live',
        accountId: 'tradfi-main',
        assetClasses: ['equity'],
        tickers: ['AAPLUSDT'],
      }),
    );
    expect(response.status).toBe(200);
  });

  it('persists only an immutable release reference for a versioned deployment', async () => {
    mockGetTradingAccount.mockResolvedValue({
      id: 'crypto-main',
      provider: 'bybit',
      enabled: true,
      universes: ['crypto'],
    });
    mockGetRuntimeStrategyRelease.mockResolvedValue({
      strategyName: 'DoubleTap',
      releaseVersion: 4,
      config: {
        INTERVAL: '60',
        UNIVERSE: 'crypto',
        POLICY_PROFILE_ID: 'crypto',
      },
    });
    mockSaveRuntimeDeployment.mockImplementation(
      async (_userName: string, value: unknown) => value,
    );

    const response = await POST(
      request({
        id: 'doubletap-forward',
        label: 'DoubleTap forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        universe: 'tradfi',
        interval: '5',
        enabled: true,
        strategies: [
          {
            strategyName: 'DoubleTap',
            releaseVersion: 4,
            controlState: 'entries_paused',
          },
        ],
      }),
    );

    expect(mockSaveRuntimeDeployment).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        strategies: [
          {
            strategyName: 'DoubleTap',
            releaseVersion: 4,
            controlState: 'entries_paused',
          },
        ],
      }),
    );
    expect(mockSaveRuntimeDeployment.mock.calls[0]?.[1]).not.toHaveProperty(
      'interval',
    );
    expect(mockSaveRuntimeDeployment.mock.calls[0]?.[1]).not.toHaveProperty(
      'universe',
    );
    expect(response.status).toBe(200);
  });

  it('rejects release references without an explicit control state', async () => {
    mockGetTradingAccount.mockResolvedValue({
      id: 'crypto-main',
      provider: 'bybit',
      enabled: true,
      universes: ['crypto'],
    });

    const response = await POST(
      request({
        id: 'doubletap-forward',
        label: 'DoubleTap forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        universe: 'crypto',
        interval: '15',
        enabled: true,
        strategies: [{ strategyName: 'DoubleTap', releaseVersion: 4 }],
      }),
    );

    expect(response).toEqual({
      status: 400,
      body: { error: 'Invalid runtime strategy reference' },
    });
    expect(mockSaveRuntimeDeployment).not.toHaveBeenCalled();
  });
});
