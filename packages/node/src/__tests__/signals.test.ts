describe('signals', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      APP_URL: 'https://app.example.com',
      TG_BOT_TOKEN: 'tg-token',
      TG_CHAT_ID: 'tg-chat-id',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('adds sendPhoto failure reason to fallback Telegram message', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: wrong file identifier/http url specified',
        }),
      })
      .mockResolvedValueOnce({ ok: true });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getImageUrl: jest.fn(() => 'https://app.example.com/image.png'),
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger: {
        error: jest.fn(),
        info: jest.fn(),
      },
    }));

    const { sendSignal } = require('../signals');

    await sendSignal(
      {
        signalId: 'sig-1',
        symbol: 'BTCUSDT',
        strategy: 'TrendLine',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        indicators: {},
        additionalIndicators: {},
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
      },
      '15',
      null,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const fallbackPayload = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(fallbackPayload.text).toContain('Photo delivery failed');
    expect(fallbackPayload.text).toContain(
      '400: Bad Request: wrong file identifier/http url specified',
    );
  });
});
