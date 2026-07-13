const mockGetCurrentUserName = jest.fn();
const mockGetTradingAccount = jest.fn();
const mockListTradingAccounts = jest.fn();
const mockSaveTradingAccount = jest.fn();
const mockGetUserSettings = jest.fn();

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
  listTradingAccounts: (...args: unknown[]) => mockListTradingAccounts(...args),
  saveTradingAccount: (...args: unknown[]) => mockSaveTradingAccount(...args),
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { GET, POST } from '../route';

const request = (body: Record<string, unknown>) =>
  ({ json: async () => body }) as any;

describe('trading accounts route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetTradingAccount.mockResolvedValue(null);
    mockGetUserSettings.mockResolvedValue({
      BYBIT_API_KEY: '',
      BYBIT_API_SECRET: '',
    });
  });

  it('requires an authenticated user', async () => {
    mockGetCurrentUserName.mockResolvedValue(null);

    await expect(GET()).resolves.toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    await expect(POST(request({}))).resolves.toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
  });

  it('lists accounts without exposing credentials', async () => {
    mockListTradingAccounts.mockResolvedValue([
      {
        id: 'tradfi-main',
        label: 'TradFi',
        provider: 'bybit',
        enabled: true,
        universes: ['tradfi'],
        environment: 'mainnet',
        apiKey: 'key-value',
        apiSecret: 'secret-value',
      },
    ]);

    const response = await GET();

    expect(response).toEqual({
      status: 200,
      body: {
        accounts: [
          expect.objectContaining({
            id: 'tradfi-main',
            hasApiKey: true,
            hasApiSecret: true,
            maskedApiKey: '************alue',
            maskedApiSecret: '************alue',
          }),
        ],
      },
    });
    expect(response.body.accounts[0]).not.toHaveProperty('apiKey');
    expect(response.body.accounts[0]).not.toHaveProperty('apiSecret');
  });

  it('migrates legacy Bybit credentials into a trading account', async () => {
    mockListTradingAccounts.mockResolvedValue([]);
    mockGetUserSettings.mockResolvedValue({
      BYBIT_API_KEY: 'legacy-key-1234',
      BYBIT_API_SECRET: 'legacy-secret-5678',
    });
    mockSaveTradingAccount.mockImplementation(
      async (_userName: string, account: Record<string, unknown>) => account,
    );

    const response = await GET();

    expect(mockSaveTradingAccount).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        id: 'bybit-default',
        provider: 'bybit',
        apiKey: 'legacy-key-1234',
        apiSecret: 'legacy-secret-5678',
      }),
    );
    expect(response.body.accounts).toEqual([
      expect.objectContaining({
        id: 'bybit-default',
        maskedApiKey: '************1234',
        maskedApiSecret: '************5678',
      }),
    ]);
    expect(response.body.accounts[0]).not.toHaveProperty('apiKey');
    expect(response.body.accounts[0]).not.toHaveProperty('apiSecret');
  });

  it('validates required fields and credentials for new accounts', async () => {
    const missingFields = await POST(request({ id: 'account' }));
    expect(missingFields.status).toBe(400);
    expect(missingFields.body).toEqual({
      error: 'id, label, provider and universes are required',
    });

    const missingCredentials = await POST(
      request({
        id: 'account',
        label: 'Account',
        provider: 'bybit',
        universes: ['tradfi', 'invalid'],
      }),
    );
    expect(missingCredentials.status).toBe(400);
    expect(missingCredentials.body).toEqual({
      error: 'apiKey and apiSecret are required for a new account',
    });
    expect(mockSaveTradingAccount).not.toHaveBeenCalled();
  });

  it('rotates an account while retaining omitted secrets', async () => {
    mockGetTradingAccount.mockResolvedValue({
      id: 'tradfi-main',
      label: 'Old label',
      provider: 'bybit',
      enabled: true,
      universes: ['tradfi'],
      environment: 'mainnet',
      apiKey: 'stored-key',
      apiSecret: 'stored-secret',
    });
    mockSaveTradingAccount.mockImplementation(
      async (_userName: string, account: Record<string, unknown>) => account,
    );

    const response = await POST(
      request({
        id: 'tradfi-main',
        label: 'New label',
        provider: 'BYBIT',
        universes: ['tradfi'],
        environment: 'testnet',
        apiKey: 'new-key',
        apiSecret: '   ',
      }),
    );

    expect(mockSaveTradingAccount).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        id: 'tradfi-main',
        label: 'New label',
        provider: 'bybit',
        environment: 'testnet',
        apiKey: 'new-key',
        apiSecret: 'stored-secret',
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.account).toEqual(
      expect.objectContaining({ hasApiKey: true, hasApiSecret: true }),
    );
    expect(response.body.account).not.toHaveProperty('apiKey');
    expect(response.body.account).not.toHaveProperty('apiSecret');
  });
});
