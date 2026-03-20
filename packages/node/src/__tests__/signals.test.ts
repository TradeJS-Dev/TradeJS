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

  it('uploads local screenshot to Telegram with dashboard button', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => Buffer.from('png-bytes')),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
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

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const payload = fetchMock.mock.calls[0][1].body;

    expect(payload).toBeInstanceOf(FormData);
    expect(payload.get('chat_id')).toBe('tg-chat-id');
    expect(payload.get('caption')).toContain('BTCUSDT');
    expect(payload.get('parse_mode')).toBe('HTML');
    expect(payload.get('reply_markup')).toContain('Dashboard');
    expect(payload.get('reply_markup')).not.toContain('Screenshot');

    const photo = payload.get('photo') as File;

    expect(photo).toBeTruthy();
    expect(photo.name).toBe('BTCUSDT_sig-1_15.png');
    expect(photo.type).toBe('image/png');
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
      .mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => Buffer.from('png-bytes')),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
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

    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(payload.text).toContain('BTCUSDT');
    expect(payload.text).toContain('Photo delivery failed');
    expect(payload.text).toContain(
      '400: Bad Request: wrong file identifier/http url specified',
    );
  });

  it('uploads screenshot without dashboard button when APP_URL is not https', async () => {
    process.env.APP_URL = 'http://app.example.com';

    const fetchMock = jest.fn().mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => Buffer.from('png-bytes')),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
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

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const payload = fetchMock.mock.calls[0][1].body;

    expect(payload).toBeInstanceOf(FormData);
    expect(payload.get('caption')).toContain('BTCUSDT');
    expect(payload.get('reply_markup')).toBeNull();

    const photo = payload.get('photo') as File;

    expect(photo).toBeTruthy();
    expect(photo.name).toBe('BTCUSDT_sig-1_15.png');
  });
});
