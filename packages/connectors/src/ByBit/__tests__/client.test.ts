var mockGetData = jest.fn();
var mockLoggerLog = jest.fn();
var mockRestClientV5Calls = jest.fn();

jest.mock('bybit-api', () => ({
  RestClientV5: function (this: any, options: any) {
    mockRestClientV5Calls(options);
    this.options = options;
  },
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  redisKeys: {
    user: (userName: string) => `users:${userName}`,
  },
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: (...args: unknown[]) => mockLoggerLog(...args),
  },
}));

import { getClient } from '../client';

describe('ByBit getClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates public client without credentials', async () => {
    const client = await getClient({ userName: 'root' }, 'public');

    expect(mockGetData).not.toHaveBeenCalled();
    expect(mockRestClientV5Calls).toHaveBeenCalledWith({
      parseAPIRateLimits: true,
      testnet: false,
    });
    expect(client).toEqual(
      expect.objectContaining({
        options: {
          parseAPIRateLimits: true,
          testnet: false,
        },
      }),
    );
  });

  it('creates private client with bybit credentials, recv window and time sync', async () => {
    mockGetData.mockResolvedValue({
      BYBIT_API_KEY: 'key',
      BYBIT_API_SECRET: 'secret',
    });

    const client = await getClient({ userName: 'root' }, 'private');

    expect(mockGetData).toHaveBeenCalledWith('users:root');
    expect(mockRestClientV5Calls).toHaveBeenCalledWith({
      key: 'key',
      secret: 'secret',
      parseAPIRateLimits: true,
      recv_window: 10000,
      syncTimeBeforePrivateRequests: true,
      testnet: false,
    });
    expect(client).toEqual(
      expect.objectContaining({
        options: {
          key: 'key',
          secret: 'secret',
          parseAPIRateLimits: true,
          recv_window: 10000,
          syncTimeBeforePrivateRequests: true,
          testnet: false,
        },
      }),
    );
  });

  it('returns null and logs when user config is missing', async () => {
    mockGetData.mockResolvedValue(null);

    await expect(
      getClient({ userName: 'root' }, 'private'),
    ).resolves.toBeNull();
    expect(mockLoggerLog).toHaveBeenCalledWith(
      'error',
      'connection config not found: %s',
      'root',
    );
  });
});
