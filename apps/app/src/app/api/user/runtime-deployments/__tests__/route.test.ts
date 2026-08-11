const mockGetCurrentUserName = jest.fn();
const mockGetRuntimeDeploymentHeartbeat = jest.fn();
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
  universe: 'tradfi',
  interval: '15',
  enabled: true,
  strategies: [
    {
      strategyName: 'TrendLine',
      policyProfileId: 'tradfi',
      enabled: true,
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
      body: { error: 'Invalid runtime deployment' },
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
        universe: 'tradfi',
        assetClasses: ['equity'],
        tickers: ['AAPLUSDT'],
      }),
    );
    expect(response.status).toBe(200);
  });
});
