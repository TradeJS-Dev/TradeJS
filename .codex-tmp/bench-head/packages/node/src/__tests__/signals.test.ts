describe('signals', () => {
  const originalEnv = process.env;
  const getUserSettingsMock = jest.fn(async (userName = 'root') => ({
    userName,
    BYBIT_API_KEY: '',
    BYBIT_API_SECRET: '',
    token: '',
    COINALYZE_API_KEY: '',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_API_ENDPOINT: 'https://api.openai.com/v1',
    TG_BOT_TOKEN: 'tg-token',
    TG_CHAT_ID: 'tg-chat-id',
  }));

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('@tradejs/core/async', () => ({
      delay: jest.fn(async () => undefined),
    }));
    process.env = {
      ...originalEnv,
      APP_URL: 'https://app.example.com',
    };
    jest.doMock('@tradejs/infra/userSettings', () => ({
      getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
    }));
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

  it('falls back to a text message when screenshot file is missing', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error(
          "ENOENT: no such file or directory, open '/app/data/screenshots/BTCUSDT_sig-1_15.png'",
        );
      }),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
    }));

    const loggerError = jest.fn();
    jest.doMock('@tradejs/infra/logger', () => ({
      logger: {
        error: loggerError,
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

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(payload.text).toContain('BTCUSDT');
    expect(JSON.stringify(payload.reply_markup)).toContain('Dashboard');
    expect(loggerError).toHaveBeenCalledWith(
      'tg screenshot unavailable: %s (%s)',
      'BTCUSDT',
      expect.stringContaining('ENOENT'),
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

  it('retries Telegram sendMessage after a transient network failure', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('fetch failed'), {
          cause: new Error('ECONNRESET'),
        }),
      )
      .mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error(
          "ENOENT: no such file or directory, open '/app/data/screenshots/BTCUSDT_sig-1_15.png'",
        );
      }),
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
    expect(fetchMock.mock.calls[0][0]).toContain('/sendMessage');
    expect(fetchMock.mock.calls[1][0]).toContain('/sendMessage');
  });

  it('hides AI quality details inside Telegram skip reason', async () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'ZETAUSDT_sig-1_15.png'),
    }));

    const { formatMessage } = require('../signals');

    const message = formatMessage(
      {
        signalId: 'sig-1',
        symbol: 'ZETAUSDT',
        strategy: 'TrendLine',
        interval: '15',
        direction: 'LONG',
        orderStatus: 'skipped',
        orderSkipReason: 'AI_QUALITY_BELOW_MIN (0 < 4)',
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
      {
        quality: 3,
        direction: 'SHORT',
      },
    );

    expect(message).toContain('Skip reason: <b>AI_QUALITY_BELOW_MIN</b>');
    expect(message).not.toContain('0 &lt; 4');
  });
});
