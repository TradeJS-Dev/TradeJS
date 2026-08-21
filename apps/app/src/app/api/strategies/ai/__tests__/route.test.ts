const mockGetCurrentUserName = jest.fn();
const mockGetKeys = jest.fn();
const mockGetData = jest.fn();
const mockEnsureStrategyPluginsLoaded = jest.fn();
const mockGetAvailableStrategyNames = jest.fn();

type MockJsonResponse<T> = {
  status: number;
  body: T;
};

const asMockJsonResponse = <T>(response: unknown) =>
  response as MockJsonResponse<T>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/infra/redis', () => ({
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  getData: (...args: unknown[]) => mockGetData(...args),
  redisKeys: {
    strategyChartCards: (userName: string, mode: string) =>
      `users:${userName}:strategies:charts:${mode}:cards:*`,
  },
}));

jest.mock('@tradejs/node/registry', () => ({
  ensureStrategyPluginsLoaded: (...args: unknown[]) =>
    mockEnsureStrategyPluginsLoaded(...args),
  getAvailableStrategyNames: (...args: unknown[]) =>
    mockGetAvailableStrategyNames(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import * as route from '../route';

describe('AI strategy cards route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetKeys.mockResolvedValue(['legacy-card']);
    mockEnsureStrategyPluginsLoaded.mockResolvedValue(undefined);
    mockGetAvailableStrategyNames.mockResolvedValue([
      'AdaptiveMomentumRibbon',
      'DoubleTap',
    ]);
  });

  it('restores the registered casing for legacy cards', async () => {
    mockGetData.mockResolvedValue({
      cardId: 'adaptivemomentumribbon-adaptivemomentumribbon-q4-1780930702112',
      generatedAt: 1_780_930_702_112,
      strategyName: 'adaptivemomentumribbon',
      title: 'adaptivemomentumribbon',
      subtitle: 'q4+',
      datasetId: '1780906881438',
      symbols: [],
      orderLog: [],
      orders: [],
      metrics: [],
      tags: ['q4+'],
    });

    const response = asMockJsonResponse<{
      strategies: Array<{ strategyName: string; title: string }>;
    }>(await route.GET());

    expect(response.body.strategies[0]).toEqual(
      expect.objectContaining({
        strategyName: 'AdaptiveMomentumRibbon',
        title: 'AdaptiveMomentumRibbon',
      }),
    );
  });
});
