const mockGetCurrentUserName = jest.fn();
const mockGetAvailableStrategyNames = jest.fn();
const mockGetData = jest.fn();
const mockGetKeys = jest.fn();
const mockSetData = jest.fn();
const mockListTradingAccounts = jest.fn();
const mockResolveTradingAccount = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/node/strategies', () => ({
  getAvailableStrategyNames: (...args: unknown[]) =>
    mockGetAvailableStrategyNames(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  setData: (...args: unknown[]) => mockSetData(...args),
  redisKeys: {
    strategies: (userName: string) => `users:${userName}:strategies`,
    strategyConfig: (
      userName: string,
      strategyName: string,
      configId: string,
    ) => `users:${userName}:strategies:${strategyName}:${configId}`,
  },
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  listTradingAccounts: (...args: unknown[]) => mockListTradingAccounts(...args),
  resolveTradingAccount: (...args: unknown[]) =>
    mockResolveTradingAccount(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { POST } from '../route';

const request = (body: Record<string, unknown>) =>
  ({ json: async () => body }) as any;

describe('runtime strategy configs route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetAvailableStrategyNames.mockResolvedValue(['TrendLine']);
    mockListTradingAccounts.mockResolvedValue([]);
    mockResolveTradingAccount.mockResolvedValue({ id: 'bybit-main' });
  });

  it('rejects another enabled config on the same effective account', async () => {
    mockGetKeys.mockResolvedValue(['users:root:strategies:TrendLine:config']);
    mockGetData.mockResolvedValue({
      ENABLE: true,
      INTERVAL: '15',
      UNIVERSE: 'crypto',
    });

    const response = await POST(
      request({
        strategyName: 'TrendLine',
        configId: 'fast',
        interval: '5',
        universe: 'crypto',
        enabled: true,
        parameters: { LONG: true },
      }),
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error:
        'TrendLine config "config" already uses account "bybit-main". One strategy can run only once per account.',
    });
    expect(mockSetData).not.toHaveBeenCalled();
  });
});
