describe('signals', () => {
  const originalEnv = process.env;
  const getUserSettingsMock = jest.fn(async (userName = 'root') => ({
    userName,
    BYBIT_API_KEY: '',
    BYBIT_API_SECRET: '',
    COINALYZE_API_KEY: '',
    AI_API_KEY: 'openai-key',
    AI_API_ENDPOINT: 'https://api.openai.com/v1',
    AI_RESPONSE_LANGUAGE: 'en',
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

  it('uploads json document to Telegram', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    (global as any).fetch = fetchMock;

    jest.doMock('@tradejs/infra/logger', () => ({
      logger: {
        error: jest.fn(),
        info: jest.fn(),
      },
    }));

    const { sendDocumentToTG } = require('../signals');

    await sendDocumentToTG(
      {
        filename: 'runtime-parity.json',
        content: '{"hello":"world"}',
        caption: 'Parity artifact',
      },
      { userName: 'root' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/sendDocument');

    const payload = fetchMock.mock.calls[0][1].body;
    expect(payload).toBeInstanceOf(FormData);
    expect(payload.get('chat_id')).toBe('tg-chat-id');
    expect(payload.get('caption')).toBe('Parity artifact');
    expect(payload.get('parse_mode')).toBe('HTML');

    const document = payload.get('document') as File;
    expect(document).toBeTruthy();
    expect(document.name).toBe('runtime-parity.json');
    expect(document.type).toBe('application/json');
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

  it('includes detailed network cause in Telegram photo fallback message', async () => {
    const networkError = Object.assign(new Error('fetch failed'), {
      cause: {
        code: 'ECONNRESET',
        address: 'api.telegram.org',
        port: 443,
      },
    });
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

    (global as any).fetch = fetchMock;

    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => Buffer.from('png-bytes')),
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain('/sendPhoto');
    expect(fetchMock.mock.calls[1][0]).toContain('/sendPhoto');
    expect(fetchMock.mock.calls[2][0]).toContain('/sendPhoto');
    expect(fetchMock.mock.calls[3][0]).toContain('/sendMessage');

    const payload = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(payload.text).toContain('Photo delivery failed');
    expect(payload.text).toContain('code=ECONNRESET');
    expect(payload.text).toContain('address=api.telegram.org');
    expect(payload.text).toContain('port=443');

    expect(loggerError).toHaveBeenCalledWith(
      'tg sendPhoto request failed: %s',
      expect.stringContaining('code=ECONNRESET'),
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

  it('formats shared market stats from additionalIndicators.baseContext', () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
    }));

    const { formatMessage } = require('../signals');

    const message = formatMessage(
      {
        signalId: 'sig-1',
        symbol: 'BTCUSDT',
        strategy: 'TrendLine',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        indicators: {},
        additionalIndicators: {
          baseContext: {
            raw: {
              volatility: {
                atrPct: 1.23,
              },
              crossAsset: {
                btcCorrelation: 0.42,
              },
            },
            relative: {
              execution: {
                venueSpread: 0.0012,
              },
            },
          },
        },
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
      },
      null,
    );

    expect(message).toContain('BTC correlation: 0.42');
    expect(message).toContain('Volatility: 1.230000%');
    expect(message).toContain('Spread: 0.120000%');
  });

  it('formats separate gate and llm quality lines in Telegram signal card', () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'TLMUSDT_sig-1_15.png'),
    }));

    const { formatMessage } = require('../signals');

    const message = formatMessage(
      {
        signalId: 'sig-1',
        symbol: 'TLMUSDT',
        strategy: 'AdaptiveMomentumRibbon',
        interval: '15',
        direction: 'LONG',
        orderStatus: 'completed',
        timestamp: 1_700_000_000_000,
        indicators: {},
        additionalIndicators: {},
        prices: {
          currentPrice: 0.001792,
          takeProfitPrice: 0.00187,
          stopLossPrice: 0.001773,
          riskRatio: 3.5,
        },
      },
      {
        direction: null,
        quality: 3,
        comment: 'llm rejected',
        gateAnalysis: {
          direction: 'LONG',
          quality: 4,
          comment: 'gate approved',
        },
        gateDecision: 'approved',
        llmDecision: 'rejected',
        gateContradictsLlm: true,
      },
    );

    expect(message).toContain('🟢 Gate Quality: 4/5');
    expect(message).toContain('🔴 LLM Quality: 3/5');
    expect(message).not.toContain('AI Quality: 3/5');
  });

  it('formats approved AI analysis as a short human-readable explanation', () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
    }));

    const { formatAnalysisMessage } = require('../signals');

    const message = formatAnalysisMessage(
      {
        signalId: 'sig-1',
        symbol: 'BTCUSDT',
        strategy: 'AdaptiveMomentumRibbon',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        indicators: {},
        additionalIndicators: {},
        prices: {
          currentPrice: 100,
          takeProfitPrice: 105,
          stopLossPrice: 99,
          riskRatio: 2.5,
        },
      },
      {
        direction: 'LONG',
        quality: 4,
        needRetest: false,
        takeProfitPrice: 105,
        stopLossPrice: 99,
        setup: 'Price holds above kcUpper after the breakout.',
        qualityReason:
          'Momentum is aligned, invalidation has not triggered, and reward-to-risk is still acceptable.',
        triggerInvalidation:
          'If price closes back below 99.2, the setup fails.',
        btcContext: 'BTC is neutral, so there is no extra headwind.',
        comment: 'approved',
      },
    );

    expect(message).toContain('<b>AI analysis BTCUSDT</b>');
    expect(message).toContain('Verdict: <b>Approved LONG</b>');
    expect(message).toContain('AI approves this LONG setup right now.');
    expect(message).toContain(
      "What's happening: Price holds above kcUpper after the breakout.",
    );
    expect(message).toContain(
      'Why approved: Momentum is aligned, invalidation has not triggered, and reward-to-risk is still acceptable.',
    );
    expect(message).toContain(
      'Next: If price closes back below 99.2, the setup fails.',
    );
    expect(message).toContain(
      'BTC context: BTC is neutral, so there is no extra headwind.',
    );
    expect(message).not.toContain('Signal direction:');
    expect(message).not.toContain('Levels:');
    expect(message).not.toContain('Why Quality');
  });

  it('formats gate and LLM comparison in AI analysis', () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'BTCUSDT_sig-1_15.png'),
    }));

    const { formatAnalysisMessage } = require('../signals');

    const message = formatAnalysisMessage(
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
          takeProfitPrice: 105,
          stopLossPrice: 99,
          riskRatio: 2.5,
        },
      },
      {
        direction: null,
        quality: 2,
        needRetest: true,
        retestPrice: null,
        takeProfitPrice: null,
        stopLossPrice: null,
        setup: 'LLM wants more confirmation.',
        comment: 'llm rejected',
        gateAnalysis: {
          direction: 'LONG',
          quality: 4,
          comment: 'gate approved',
        },
        gateDecision: 'approved',
        llmDecision: 'rejected',
        gateContradictsLlm: true,
      },
    );

    expect(message).toContain(
      'Gate vs LLM: <b>conflict</b> (gate approved, LLM pending)',
    );
  });

  it('formats pending AI analysis as not approved yet with next step', () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'HMSTRUSDT_sig-1_15.png'),
    }));

    const { formatAnalysisMessage } = require('../signals');

    const message = formatAnalysisMessage(
      {
        signalId: 'sig-1',
        symbol: 'HMSTRUSDT',
        strategy: 'AdaptiveMomentumRibbon',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        indicators: {},
        additionalIndicators: {},
        prices: {
          currentPrice: 0.00016,
          takeProfitPrice: 0.000165,
          stopLossPrice: 0.000157,
          riskRatio: 2.9,
        },
      },
      {
        direction: null,
        quality: 4,
        needRetest: true,
        retestPrice: 0.00015823,
        setup:
          'Price is above kcUpper, but the breakout still needs a confirming candle close.',
        qualityReason:
          'Momentum is strong, but the next bar still needs to confirm the move.',
        retestPlan: 'Wait for the next candle to close above 0.00015823.',
        comment: 'ok',
      },
    );

    expect(message).toContain('Verdict: <b>Not approved yet</b>');
    expect(message).toContain(
      'The LONG setup is visible, but confirmation is still missing before entry.',
    );
    expect(message).toContain(
      'Why not approved: Momentum is strong, but the next bar still needs to confirm the move.',
    );
    expect(message).toContain(
      'Next: Wait for the next candle to close above 0.00015823.',
    );
    expect(message).not.toContain('Levels:');
  });

  it('formats gate and LLM approvals with retest as pending alignment', () => {
    jest.doMock('../screenshot', () => ({
      getScreenshotBuffer: jest.fn(async () => {
        throw new Error('no screenshot');
      }),
      getScreenshotFilename: jest.fn(() => 'LRCUSDT_sig-1_15.png'),
    }));

    const { formatAnalysisMessage } = require('../signals');

    const message = formatAnalysisMessage(
      {
        signalId: 'sig-1',
        symbol: 'LRCUSDT',
        strategy: 'TrendShift',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        indicators: {},
        additionalIndicators: {},
        prices: {
          currentPrice: 0.0169,
          takeProfitPrice: 0.0174,
          stopLossPrice: 0.0167,
          riskRatio: 2.1,
        },
      },
      {
        direction: 'LONG',
        quality: 5,
        needRetest: true,
        retestPrice: 0.01673172,
        setup: 'TrendShift bull flip is visible, but the retest still matters.',
        qualityReason:
          'Quality stays high, but confirmation still depends on the retest holding.',
        gateAnalysis: {
          direction: 'LONG',
          quality: 5,
          needRetest: true,
          comment: 'gate approved',
        },
        gateDecision: 'approved',
        llmDecision: 'approved',
        gateContradictsLlm: false,
        comment: 'llm approved',
      },
    );

    expect(message).toContain('Verdict: <b>Not approved yet</b>');
    expect(message).toContain(
      'Gate vs LLM: <b>aligned</b> (gate pending, LLM pending)',
    );
  });
});
