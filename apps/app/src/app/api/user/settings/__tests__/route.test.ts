const mockGetCurrentUserName = jest.fn();
const mockGetUserRecord = jest.fn();
const mockGetUserSettings = jest.fn();
const mockUpdateUserRecord = jest.fn();
const mockHash = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('bcryptjs', () => ({
  hash: (...args: unknown[]) => mockHash(...args),
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserRecord: (...args: unknown[]) => mockGetUserRecord(...args),
  getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
  updateUserRecord: (...args: unknown[]) => mockUpdateUserRecord(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { GET, PATCH } from '../route';

describe('user settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('alice');
    mockGetUserSettings.mockResolvedValue({
      userName: 'alice',
      COINALYZE_API_KEY: '',
      COINMARKETCAP_API_KEY: '',
      AI_API_KEY: 'openai-key-9876',
      AI_API_ENDPOINT: 'https://openrouter.ai/api/v1',
      AI_MODEL: 'openai/gpt-5-mini',
      AI_RESPONSE_LANGUAGE: 'en',
      TG_BOT_TOKEN: '',
      TG_CHAT_ID: '12345',
    });
  });

  it('removes legacy passwordless token on GET before returning masked settings', async () => {
    mockGetUserRecord.mockResolvedValue({
      userName: 'alice',
      token: 'legacy-token',
    });

    const response = await GET();

    expect(mockUpdateUserRecord).toHaveBeenCalledWith('alice', {
      token: undefined,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userName: 'alice',
      settings: {
        coinalyze: {
          apiKey: '',
        },
        coinmarketcap: {
          apiKey: '',
        },
        ai: {
          apiKey: '************9876',
          apiEndpoint: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-5-mini',
          responseLanguage: 'en',
        },
        telegram: {
          botToken: '',
          chatId: '12345',
        },
      },
    });
  });

  it('rejects invalid ai endpoints and keeps route protected', async () => {
    mockGetUserRecord.mockResolvedValue(null);

    const response = await PATCH({
      json: async () => ({
        section: 'ai',
        data: {
          apiEndpoint: 'not-a-url',
        },
      }),
    } as Request);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid AI API endpoint URL',
    });
    expect(mockUpdateUserRecord).not.toHaveBeenCalled();
  });

  it('stores an endpoint-specific default model when the ai endpoint changes', async () => {
    mockGetUserRecord.mockResolvedValue(null);
    mockGetUserSettings.mockResolvedValueOnce({
      userName: 'alice',
      COINALYZE_API_KEY: '',
      COINMARKETCAP_API_KEY: '',
      AI_API_KEY: 'openai-key-9876',
      AI_API_ENDPOINT: 'https://api.openai.com/v1',
      AI_MODEL: 'gpt-5-mini',
      AI_RESPONSE_LANGUAGE: 'en',
      TG_BOT_TOKEN: '',
      TG_CHAT_ID: '12345',
    });

    await PATCH({
      json: async () => ({
        section: 'ai',
        data: {
          apiEndpoint: 'https://api.anthropic.com/v1',
        },
      }),
    } as Request);

    expect(mockUpdateUserRecord).toHaveBeenCalledWith('alice', {
      AI_API_ENDPOINT: 'https://api.anthropic.com/v1',
      AI_MODEL: 'claude-sonnet-4-20250514',
    });
  });

  it('stores CoinMarketCap API key updates', async () => {
    mockGetUserRecord.mockResolvedValue(null);

    await PATCH({
      json: async () => ({
        section: 'coinmarketcap',
        data: {
          apiKey: 'cmc-key',
        },
      }),
    } as Request);

    expect(mockUpdateUserRecord).toHaveBeenCalledWith('alice', {
      COINMARKETCAP_API_KEY: 'cmc-key',
    });
  });

  it('rejects legacy Bybit credentials in user settings', async () => {
    const response = await PATCH({
      json: async () => ({
        section: 'bybit',
        data: { apiKey: 'legacy-key', apiSecret: 'legacy-secret' },
      }),
    } as Request);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid payload' });
    expect(mockUpdateUserRecord).not.toHaveBeenCalled();
  });

  it('rejects localhost and private-network ai endpoints', async () => {
    mockGetUserRecord.mockResolvedValue(null);

    const localhostResponse = await PATCH({
      json: async () => ({
        section: 'ai',
        data: {
          apiEndpoint: 'https://localhost:11434/v1',
        },
      }),
    } as Request);

    expect(localhostResponse.status).toBe(400);
    expect(localhostResponse.body).toEqual({
      error: 'Invalid AI API endpoint URL',
    });

    const privateNetworkResponse = await PATCH({
      json: async () => ({
        section: 'ai',
        data: {
          apiEndpoint: 'https://192.168.1.10/v1',
        },
      }),
    } as Request);

    expect(privateNetworkResponse.status).toBe(400);
    expect(privateNetworkResponse.body).toEqual({
      error: 'Invalid AI API endpoint URL',
    });
    expect(mockUpdateUserRecord).not.toHaveBeenCalled();
  });
});
