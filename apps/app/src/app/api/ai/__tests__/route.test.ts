const mockGetCurrentUserName = jest.fn();
const mockGetData = jest.fn();
const mockSetData = jest.fn();
const mockGetUserSettings = jest.fn();
const mockGetConnectorCreatorByProvider = jest.fn();
const mockModelInvoke = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: (...args: unknown[]) => mockModelInvoke(...args),
  })),
}));

jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  setData: (...args: unknown[]) => mockSetData(...args),
  redisKeys: {
    aiChatHistory: (userName: string, symbolKey: string) =>
      `users:${userName}:ai:chats:${symbolKey}`,
  },
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('@app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { GET, POST } from '../route';

describe('ai route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('alice');
    mockGetUserSettings.mockResolvedValue({
      userName: 'alice',
      AI_API_KEY: 'openai-key',
      AI_API_ENDPOINT: 'https://api.openai.com/v1',
      AI_MODEL: 'gpt-5-mini',
      AI_RESPONSE_LANGUAGE: 'en',
    });
  });

  it('reads history from a user-scoped normalized redis key', async () => {
    mockGetData.mockResolvedValue([{ from: 'human', text: 'hi' }]);

    const response = await GET({
      nextUrl: new URL('https://tradejs.dev/api/ai?symbol= btc/usdt '),
    } as any);

    expect(response.status).toBe(200);
    expect(mockGetData).toHaveBeenCalledWith(
      'users:alice:ai:chats:BTC_USDT',
      [],
    );
    expect(response.body).toEqual({
      history: [{ from: 'human', text: 'hi' }],
    });
  });

  it('stores both user and ai messages in the same normalized user-scoped history', async () => {
    const historyByKey = new Map<string, unknown>();
    mockGetData.mockImplementation(async (key: string, fallback: unknown) =>
      historyByKey.has(key) ? historyByKey.get(key) : fallback,
    );
    mockSetData.mockImplementation(
      async (key: string, value: unknown, _options?: unknown) => {
        historyByKey.set(key, value);
      },
    );
    mockGetConnectorCreatorByProvider.mockResolvedValue(() =>
      Promise.resolve({
        kline: async () => [{ close: 100 }, { close: 101 }],
      }),
    );
    mockModelInvoke.mockResolvedValue({ content: 'AI response' });

    const response = await POST({
      json: async () => ({
        message: {
          from: 'human',
          command: 'prompt',
          text: 'Что по тренду?',
        },
        filters: {
          symbol: 'btc/usdt',
        },
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockSetData).toHaveBeenNthCalledWith(
      1,
      'users:alice:ai:chats:BTC_USDT',
      [
        {
          from: 'human',
          command: 'prompt',
          text: 'Что по тренду?',
        },
      ],
      { expire: 0 },
    );
    expect(mockSetData).toHaveBeenNthCalledWith(
      2,
      'users:alice:ai:chats:BTC_USDT',
      [
        {
          from: 'human',
          command: 'prompt',
          text: 'Что по тренду?',
        },
        {
          from: 'ai',
          text: 'AI response',
        },
      ],
      { expire: 0 },
    );
    expect(response.body).toEqual({
      message: {
        from: 'ai',
        text: 'AI response',
      },
    });
  });

  it('uses the user-selected ai model for chat replies', async () => {
    const { ChatOpenAI } = jest.requireMock('@langchain/openai') as {
      ChatOpenAI: jest.Mock;
    };
    mockGetData.mockResolvedValue([]);
    mockSetData.mockResolvedValue(undefined);
    mockGetConnectorCreatorByProvider.mockResolvedValue(() =>
      Promise.resolve({
        kline: async () => [{ close: 100 }],
      }),
    );
    mockModelInvoke.mockResolvedValue({ content: 'AI response' });

    await POST({
      json: async () => ({
        message: {
          from: 'human',
          command: 'prompt',
          text: 'Trend?',
        },
        filters: {
          symbol: 'ethusdt',
        },
      }),
    } as any);

    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'gpt-5-mini',
      }),
    );
  });
});
