var mockLoggerLog = jest.fn();
var mockRestClientV5Calls = jest.fn();
var mockResolveTradingAccount = jest.fn();

jest.mock('bybit-api', () => ({
  RestClientV5: function (this: any, options: any) {
    mockRestClientV5Calls(options);
    this.options = options;
  },
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  resolveTradingAccount: (...args: unknown[]) =>
    mockResolveTradingAccount(...args),
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

    expect(mockResolveTradingAccount).not.toHaveBeenCalled();
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

  it('creates private client with bybit credentials and recv window', async () => {
    mockResolveTradingAccount.mockResolvedValue({
      id: 'bybit-default',
      apiKey: 'key',
      apiSecret: 'secret',
      environment: 'mainnet',
    });

    const client = await getClient({ userName: 'root' }, 'private');

    expect(mockResolveTradingAccount).toHaveBeenCalledWith({
      userName: 'root',
      accountId: undefined,
      provider: 'bybit',
      universe: undefined,
    });
    expect(mockRestClientV5Calls).toHaveBeenCalledWith({
      key: 'key',
      secret: 'secret',
      parseAPIRateLimits: true,
      recv_window: 10000,
      syncTimeBeforePrivateRequests: false,
      testnet: false,
    });
    expect(client).toEqual(
      expect.objectContaining({
        options: {
          key: 'key',
          secret: 'secret',
          parseAPIRateLimits: true,
          recv_window: 10000,
          syncTimeBeforePrivateRequests: false,
          testnet: false,
        },
      }),
    );
  });

  it('returns null and logs when user config is missing', async () => {
    mockResolveTradingAccount.mockResolvedValue(null);

    await expect(
      getClient({ userName: 'root' }, 'private'),
    ).resolves.toBeNull();
    expect(mockLoggerLog).toHaveBeenCalledWith(
      'error',
      'connection config not found: %s',
      'root',
    );
  });

  it('uses an explicitly selected TradFi testnet account for public and private clients', async () => {
    mockResolveTradingAccount.mockResolvedValue({
      id: 'tradfi-main',
      apiKey: 'tradfi-key',
      apiSecret: 'tradfi-secret',
      environment: 'testnet',
    });
    const config = {
      userName: 'root',
      accountId: 'tradfi-main',
      universe: 'tradfi' as const,
    };

    await getClient(config, 'public');
    await getClient(config, 'private');

    expect(mockResolveTradingAccount).toHaveBeenNthCalledWith(1, {
      userName: 'root',
      accountId: 'tradfi-main',
      provider: 'bybit',
      universe: 'tradfi',
    });
    expect(mockRestClientV5Calls).toHaveBeenNthCalledWith(1, {
      parseAPIRateLimits: true,
      testnet: true,
    });
    expect(mockRestClientV5Calls).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: 'tradfi-key',
        secret: 'tradfi-secret',
        testnet: true,
      }),
    );
  });

  it('logs the explicit account id when credentials are unavailable', async () => {
    mockResolveTradingAccount.mockResolvedValue(null);

    await expect(
      getClient(
        { userName: 'root', accountId: 'missing', universe: 'tradfi' },
        'private',
      ),
    ).resolves.toBeNull();
    expect(mockLoggerLog).toHaveBeenCalledWith(
      'error',
      'Bybit trading account config not found: user=%s account=%s',
      'root',
      'missing',
    );
  });
});
