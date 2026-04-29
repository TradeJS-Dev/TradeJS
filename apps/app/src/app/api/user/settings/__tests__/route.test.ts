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

jest.mock('@app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { GET, PATCH } from '../route';

describe('user settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('alice');
    mockGetUserSettings.mockResolvedValue({
      userName: 'alice',
      BYBIT_API_KEY: 'bybit-key-1234',
      BYBIT_API_SECRET: '',
      COINALYZE_API_KEY: '',
      OPENAI_API_KEY: 'openai-key-9876',
      OPENAI_API_ENDPOINT: 'https://openrouter.ai/api/v1',
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
        bybit: {
          apiKey: '************1234',
          apiSecret: '',
        },
        coinalyze: {
          apiKey: '',
        },
        openai: {
          apiKey: '************9876',
          apiEndpoint: 'https://openrouter.ai/api/v1',
        },
        telegram: {
          botToken: '',
          chatId: '12345',
        },
      },
    });
  });

  it('rejects unsupported openai endpoints and keeps route protected', async () => {
    mockGetUserRecord.mockResolvedValue(null);

    const response = await PATCH({
      json: async () => ({
        section: 'openai',
        data: {
          apiEndpoint: 'https://internal.example.local/v1',
        },
      }),
    } as Request);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Unsupported OpenAI API endpoint',
    });
    expect(mockUpdateUserRecord).not.toHaveBeenCalled();
  });
});
