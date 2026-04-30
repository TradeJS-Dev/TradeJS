describe('user settings utils', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('resolves user settings only from the redis user record', async () => {
    const getData = jest.fn().mockResolvedValue({
      userName: 'alice',
      BYBIT_API_KEY: 'bybit-key',
      BYBIT_API_SECRET: 'bybit-secret',
      COINALYZE_API_KEY: 'coinalyze-key',
      AI_API_KEY: 'user-openai',
      AI_API_ENDPOINT: 'https://openrouter.ai/api/v1',
      AI_MODEL: 'openai/gpt-5',
      AI_RESPONSE_LANGUAGE: 'es',
      TG_BOT_TOKEN: 'tg-token',
      TG_CHAT_ID: '777777',
    });

    jest.doMock('../redis', () => ({
      __esModule: true,
      getData,
      setData: jest.fn(),
      redisKeys: {
        user: (userName: string) => `users:index:${userName}`,
      },
    }));

    const { getUserSettings } = await import('@tradejs/infra/userSettings');

    await expect(getUserSettings('alice')).resolves.toEqual({
      userName: 'alice',
      BYBIT_API_KEY: 'bybit-key',
      BYBIT_API_SECRET: 'bybit-secret',
      COINALYZE_API_KEY: 'coinalyze-key',
      AI_API_KEY: 'user-openai',
      AI_API_ENDPOINT: 'https://openrouter.ai/api/v1',
      AI_MODEL: 'openai/gpt-5',
      AI_RESPONSE_LANGUAGE: 'es',
      TG_BOT_TOKEN: 'tg-token',
      TG_CHAT_ID: '777777',
    });
    expect(getData).toHaveBeenCalledWith('users:index:alice', null);
  });

  it('merges and persists user record updates without expiring the key', async () => {
    const getData = jest.fn().mockResolvedValue({
      userName: 'root',
      passwordHash: 'hash-1',
    });
    const setData = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../redis', () => ({
      __esModule: true,
      getData,
      setData,
      redisKeys: {
        user: (userName: string) => `users:index:${userName}`,
      },
    }));

    const { updateUserRecord } = await import('@tradejs/infra/userSettings');

    const next = await updateUserRecord('root', {
      TG_CHAT_ID: '12345',
    });

    expect(next).toEqual(
      expect.objectContaining({
        userName: 'root',
        passwordHash: 'hash-1',
        TG_CHAT_ID: '12345',
        updatedAt: expect.any(String),
      }),
    );
    expect(setData).toHaveBeenCalledWith(
      'users:index:root',
      expect.objectContaining({
        userName: 'root',
        passwordHash: 'hash-1',
        TG_CHAT_ID: '12345',
      }),
      { expire: 0 },
    );
  });

  it('drops invalid AI endpoints from resolved settings', async () => {
    const getData = jest.fn().mockResolvedValue({
      userName: 'alice',
      AI_API_ENDPOINT: 'not-a-url',
    });

    jest.doMock('../redis', () => ({
      __esModule: true,
      getData,
      setData: jest.fn(),
      redisKeys: {
        user: (userName: string) => `users:index:${userName}`,
      },
    }));

    const { getUserSettings } = await import('@tradejs/infra/userSettings');

    await expect(getUserSettings('alice')).resolves.toEqual(
      expect.objectContaining({
        AI_API_ENDPOINT: '',
        AI_MODEL: '',
        AI_RESPONSE_LANGUAGE: 'en',
      }),
    );
  });

  it('keeps custom valid AI endpoints in resolved settings', async () => {
    const getData = jest.fn().mockResolvedValue({
      userName: 'alice',
      AI_API_ENDPOINT: 'https://api.continue.example/v1',
    });

    jest.doMock('../redis', () => ({
      __esModule: true,
      getData,
      setData: jest.fn(),
      redisKeys: {
        user: (userName: string) => `users:index:${userName}`,
      },
    }));

    const { getUserSettings } = await import('@tradejs/infra/userSettings');

    await expect(getUserSettings('alice')).resolves.toEqual(
      expect.objectContaining({
        AI_API_ENDPOINT: 'https://api.continue.example/v1',
        AI_MODEL: '',
      }),
    );
  });

  it('drops localhost and private-network AI endpoints from resolved settings', async () => {
    const getData = jest
      .fn()
      .mockResolvedValueOnce({
        userName: 'alice',
        AI_API_ENDPOINT: 'https://localhost:11434/v1',
      })
      .mockResolvedValueOnce({
        userName: 'alice',
        AI_API_ENDPOINT: 'https://192.168.1.10/v1',
      });

    jest.doMock('../redis', () => ({
      __esModule: true,
      getData,
      setData: jest.fn(),
      redisKeys: {
        user: (userName: string) => `users:index:${userName}`,
      },
    }));

    const { getUserSettings } = await import('@tradejs/infra/userSettings');

    await expect(getUserSettings('alice')).resolves.toEqual(
      expect.objectContaining({
        AI_API_ENDPOINT: '',
      }),
    );
    await expect(getUserSettings('alice')).resolves.toEqual(
      expect.objectContaining({
        AI_API_ENDPOINT: '',
      }),
    );
  });
});
