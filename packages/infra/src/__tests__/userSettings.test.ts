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
      token: 'user-token',
      OPENAI_API_KEY: 'user-openai',
      OPENAI_API_ENDPOINT: 'https://openrouter.example/v1',
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
      token: 'user-token',
      OPENAI_API_KEY: 'user-openai',
      OPENAI_API_ENDPOINT: 'https://openrouter.example/v1',
      TG_BOT_TOKEN: 'tg-token',
      TG_CHAT_ID: '777777',
    });
    expect(getData).toHaveBeenCalledWith('users:index:alice', null);
  });

  it('merges and persists user record updates without expiring the key', async () => {
    const getData = jest.fn().mockResolvedValue({
      userName: 'root',
      passwordHash: 'hash-1',
      token: 'old-token',
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
      token: 'new-token',
      TG_CHAT_ID: '12345',
    });

    expect(next).toEqual(
      expect.objectContaining({
        userName: 'root',
        passwordHash: 'hash-1',
        token: 'new-token',
        TG_CHAT_ID: '12345',
        updatedAt: expect.any(String),
      }),
    );
    expect(setData).toHaveBeenCalledWith(
      'users:index:root',
      expect.objectContaining({
        userName: 'root',
        passwordHash: 'hash-1',
        token: 'new-token',
        TG_CHAT_ID: '12345',
      }),
      { expire: 0 },
    );
  });
});
