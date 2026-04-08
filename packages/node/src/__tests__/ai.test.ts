const invokeMock = jest.fn();
const chatOpenAICtorMock = jest.fn();
const setDataMock = jest.fn();
const getUserSettingsMock = jest.fn(async (userName = 'root') => ({
  userName,
  BYBIT_API_KEY: '',
  BYBIT_API_SECRET: '',
  token: '',
  COINALYZE_API_KEY: '',
  OPENAI_API_KEY: 'key_123',
  OPENAI_API_ENDPOINT: 'https://api.openai.com/v1',
  TG_BOT_TOKEN: 'tg-token',
  TG_CHAT_ID: 'tg-chat-id',
}));
const analysisKeyMock = jest.fn((symbol: string, signalId: string) => {
  return `analysis:${symbol}:${signalId}`;
});

class MockHumanMessage {
  content: any;
  constructor(content: any) {
    this.content = content;
  }
}

class MockSystemMessage {
  content: any;
  constructor(content: any) {
    this.content = content;
  }
}

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((config: unknown) => {
    chatOpenAICtorMock(config);
    return {
      invoke: invokeMock,
    };
  }),
}));

jest.mock('@langchain/core/messages', () => ({
  BaseMessage: class {},
  HumanMessage: MockHumanMessage,
  SystemMessage: MockSystemMessage,
}));

jest.mock('@tradejs/infra/redis', () => ({
  setData: (...args: unknown[]) => setDataMock(...args),
  redisKeys: {
    analysis: (...args: [string, string]) => analysisKeyMock(...args),
  },
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));

const {
  MAX_AI_SERIES_POINTS,
  askAI,
  buildAiPrompts,
  buildAiHumanPrompt,
  buildAiPayload,
  buildAiSystemPrompt,
  resetAiRuntimeCache,
  runAiPrompt,
  trimSeriesDeep,
} = require('../ai');
const {
  registerStrategyEntries,
  resetStrategyRegistryCache,
} = require('../strategy/manifests');
const { strategyEntries } = require('@tradejs/strategies');

const makeCandle = (timestamp: number) => ({
  timestamp,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  turnover: 15,
});

const makeSignal = () =>
  ({
    signalId: 'sig-1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {
      trendLine: {
        id: 'tl-1',
        mode: 'lows',
        distance: 1.23,
        touches: [
          { timestamp: 1, value: 100 },
          { timestamp: 2, value: 101 },
          { timestamp: 3, value: 102 },
          { timestamp: 4, value: 103 },
          { timestamp: 5, value: 104 },
          { timestamp: 6, value: 105 },
        ],
        points: [
          { timestamp: 1, value: 95 },
          { timestamp: 4, value: 99 },
        ],
        alpha: [1, 2, 3, 4, 5, 6],
      },
    },
    prices: {
      currentPrice: 100,
      takeProfitPrice: 103,
      stopLossPrice: 99,
      riskRatio: 3,
    },
    indicators: {
      maFast: [1, 2, 3, 4, 5, 6, 7],
      btcMaFast1h: [10, 11, 12, 13, 14, 15],
      nested: {
        atrPct: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      },
      candles15m: [1, 2, 3, 4, 5, 6].map((i) => makeCandle(i)),
      matrix: [
        [1, 11, 111],
        [2, 22, 222],
        [3, 33, 333],
        [4, 44, 444],
        [5, 55, 555],
        [6, 66, 666],
      ],
      correlation: 0.42,
    },
  }) as any;

const makeBlockedTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 100;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 102;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 99.5 },
      { timestamp: 2, value: 100.05 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [3, 4, 5],
    maSlow: [1, 2, 3],
    btcMaFast: [101, 102, 103],
    btcMaSlow: [100, 101, 102],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 12,
  };
  return signal;
};

const makeAggressivePreBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 100.111;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.3;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 98.9 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 98.9 },
      { timestamp: 1.2, value: 99.2 },
      { timestamp: 1.4, value: 99.4 },
      { timestamp: 1.6, value: 99.7 },
      { timestamp: 1.8, value: 99.9 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [101, 100, 98.5],
    maSlow: [101, 101, 100],
    btcMaFast: [101, 100.2, 99.5],
    btcMaSlow: [101, 100.5, 99.9],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 100,
  };
  return signal;
};

const makeStrongNearBreakPressureTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.7372;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.3;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 98.8 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 99.1 },
      { timestamp: 1.2, value: 99.35 },
      { timestamp: 1.4, value: 99.55 },
      { timestamp: 1.6, value: 99.8 },
      { timestamp: 1.8, value: 99.95 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.4, 99.1, 97.3],
    maSlow: [100.6, 100.3, 100],
    btcMaFast: [100.4, 99.7, 99.3],
    btcMaSlow: [100.5, 100.2, 100],
    atrPct: [0.918],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 748,
  };
  return signal;
};

const makeWeakBtcLedBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 100;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.2;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.2 },
      { timestamp: 2, value: 100.425 },
    ],
    touches: [
      { timestamp: 1, value: 100.1 },
      { timestamp: 1.2, value: 100.2 },
      { timestamp: 1.4, value: 100.25 },
      { timestamp: 1.6, value: 100.32 },
      { timestamp: 1.8, value: 100.38 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [101, 100, 99.58],
    maSlow: [101, 100, 100],
    btcMaFast: [101, 100, 99.34],
    btcMaSlow: [101, 100, 100],
    atrPct: [1.02],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 293,
  };
  return signal;
};

const makeWeakCleanBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.541;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.1;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.2 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.8 },
      { timestamp: 1.2, value: 100.6 },
      { timestamp: 1.4, value: 100.4 },
      { timestamp: 1.6, value: 100.2 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.5, 99.8, 99.1],
    maSlow: [100.7, 100.2, 100],
    btcMaFast: [100.4, 100.1, 99.9],
    btcMaSlow: [100.5, 100.2, 100],
    atrPct: [1.133],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 132,
  };
  return signal;
};

const makeCompressedCleanBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.49;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.15;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.15 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.55 },
      { timestamp: 1.2, value: 100.4 },
      { timestamp: 1.4, value: 100.28 },
      { timestamp: 1.6, value: 100.16 },
      { timestamp: 1.8, value: 100.08 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.3, 99.95, 99.8],
    maSlow: [100.4, 100.15, 100],
    btcMaFast: [100.1, 100.02, 99.95],
    btcMaSlow: [100.15, 100.08, 100],
    atrPct: [0.94],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 96,
  };
  return signal;
};

const makeWeakLongFarBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'LONG';
  signal.prices.currentPrice = 100.505;
  signal.prices.takeProfitPrice = 104.5;
  signal.prices.stopLossPrice = 98.9;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 101.4 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 101.3 },
      { timestamp: 1.2, value: 101.1 },
      { timestamp: 1.4, value: 100.8 },
      { timestamp: 1.6, value: 100.4 },
      { timestamp: 1.8, value: 100.15 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.8, 100.1, 100.36],
    maSlow: [99.7, 99.95, 100],
    btcMaFast: [100.02, 100.18, 100.3],
    btcMaSlow: [100, 100.08, 100],
    atrPct: [0.93],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 1687,
  };
  return signal;
};

describe('ai helpers', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    resetAiRuntimeCache();
    resetStrategyRegistryCache();
    registerStrategyEntries(strategyEntries);
    invokeMock.mockReset();
    chatOpenAICtorMock.mockReset();
    getUserSettingsMock.mockClear();
    setDataMock.mockReset();
    analysisKeyMock.mockClear();
    setDataMock.mockResolvedValue(undefined);
  });

  afterAll(() => {
    resetStrategyRegistryCache();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('trimSeriesDeep', () => {
    it('trims nested arrays to last N values and keeps scalars', () => {
      const input = {
        a: [1, 2, 3, 4, 5, 6, 7],
        b: {
          c: [10, 11, 12, 13, 14, 15],
          d: 'x',
        },
      };

      const result = trimSeriesDeep(input);

      expect(result.a).toEqual([3, 4, 5, 6, 7]);
      expect(result.b.c).toEqual([11, 12, 13, 14, 15]);
      expect(result.b.d).toBe('x');
    });

    it('trims matrix-like arrays only by outer dimension', () => {
      const matrix = [
        [1, 2, 3, 4, 5, 6],
        [10, 20, 30, 40, 50, 60],
        [100, 200, 300, 400, 500, 600],
        [1000, 2000, 3000, 4000, 5000, 6000],
        [7, 8, 9, 10, 11, 12],
        [13, 14, 15, 16, 17, 18],
      ];

      const result = trimSeriesDeep(matrix);

      expect(result).toEqual(matrix.slice(-MAX_AI_SERIES_POINTS));
      expect(result[0]).toHaveLength(6);
    });
  });

  describe('buildAiPayload', () => {
    it('builds payload with trimmed indicators and full trendline', () => {
      const signal = makeSignal();
      const payload = buildAiPayload(signal);

      expect(payload.signal.symbol).toBe('ETHUSDT');
      expect(payload.signal.strategy).toBe('TrendLine');
      expect(payload.signal.prices).toEqual({
        currentPrice: 100,
        takeProfitPrice: 103,
        stopLossPrice: 99,
      });
      expect((payload.signal.prices as any).riskRatio).toBeUndefined();

      expect(payload.indicators.maFast).toEqual([3, 4, 5, 6, 7]);
      expect(payload.indicators.btcMaFast1h).toEqual([11, 12, 13, 14, 15]);
      expect(payload.indicators.nested.atrPct).toEqual([
        0.2, 0.3, 0.4, 0.5, 0.6,
      ]);
      expect(payload.indicators.candles15m).toHaveLength(MAX_AI_SERIES_POINTS);
      expect(payload.indicators.matrix).toHaveLength(MAX_AI_SERIES_POINTS);

      expect(payload.figures.trendline).toBe(signal.figures.trendLine);
      expect(payload.figures.trendline.touches).toHaveLength(6);
      expect(payload.figures.trendline.alpha).toHaveLength(6);
    });

    it('uses default adapter for non-trendline strategies without trendline alias', () => {
      const signal = makeSignal();
      signal.strategy = 'Breakout';
      signal.figures = {
        breakoutZone: {
          level: 100,
          values: [1, 2, 3, 4, 5, 6],
        },
      };

      const payload = buildAiPayload(signal);

      expect(payload.figures.breakoutZone).toEqual({
        level: 100,
        values: [2, 3, 4, 5, 6],
      });
      expect((payload.figures as any).trendline).toBeUndefined();
    });
  });

  describe('prompt builders', () => {
    it('system prompt includes critical constraints and examples', () => {
      const prompt = buildAiSystemPrompt();

      expect(prompt).toContain('Пиши comment по-русски');
      expect(prompt).toContain('quality" — качество ВХОДА ИМЕННО СЕЙЧАС');
      expect(prompt).toContain(
        'Никогда не предлагай противоположное направление',
      );
      expect(prompt).toContain('"needRetest": boolean');
      expect(prompt).toContain('"retestPrice": number | null');
      expect(prompt).toContain('"setup": string');
      expect(prompt).toContain('"triggerInvalidation": string');
      expect(prompt).toContain('reward/risk >= 0.33');
      expect(prompt).toContain('структурированному анализу');
      expect(prompt).toContain(
        'не пиши технический шаблон вроде "needRetest=false @ null"',
      );
      expect(prompt).toContain('payload.additionalIndicators');
      expect(prompt).toContain('Короткие примеры (few-shot');
      expect(prompt).toContain('Не добавляй другие поля');
      expect(prompt).not.toContain('runtime-нейминг');
    });

    it('adds strategy-specific system prompt section for TrendLine', () => {
      const prompt = buildAiSystemPrompt(makeSignal());

      expect(prompt).toContain('Дополнение для trendline-сетапов');
      expect(prompt).toContain('payload.figures.trendline');
      expect(prompt).toContain('trendlineContext');
    });

    it('human prompt embeds serialized payload and concise task', () => {
      const signal = makeSignal();
      const payload = buildAiPayload(signal);
      const prompt = buildAiHumanPrompt(signal, payload);

      expect(prompt).toContain('Проанализируй сделку по ETHUSDT');
      expect(prompt).toContain('Исходный сигнал имеет направление LONG');
      expect(prompt).toContain('без предложения противоположного направления');
      expect(prompt).toContain('"symbol":"ETHUSDT"');
      expect(prompt).toContain('"trendline"');
      expect(prompt).toContain('trendline.currentLinePrice=');
      expect(prompt).toContain('trendline.breakVsAtrRatio=');
      expect(prompt).toContain('trendline.strongNearBreakPressure=');
      expect(prompt).toContain('trendline.weakCleanBreak=');
      expect(prompt).toContain('trendline.weakBtcLedBreak=');
      expect(prompt).toContain('trendline.weakLongFarBreak=');
      expect(prompt).toContain('"maFast":[3,4,5,6,7]');
      expect(prompt).not.toContain('"riskRatio"');
    });

    it('builds prompt pair for dataset replay', () => {
      const prompts = buildAiPrompts(makeSignal());

      expect(prompts.systemPrompt).toContain('Ты — помощник крипто-трейдера');
      expect(prompts.humanPrompt).toContain('Проанализируй сделку по ETHUSDT');
    });

    it('falls back to additionalIndicators trendLine when figures.trendLine is missing', () => {
      const signal = makeSignal();
      const additionalTrendLine = {
        id: 'tl-ai',
        mode: 'lows',
        distance: 42,
        points: [
          { timestamp: 1, value: 99 },
          { timestamp: 2, value: 101 },
        ],
        touches: [{ timestamp: 1.5, value: 100 }],
        alpha: [0.99, 1.01],
      };
      signal.figures = {};
      signal.additionalIndicators = {
        touches: 3,
        distance: 42,
        trendLine: additionalTrendLine,
      };

      const payload = buildAiPayload(signal);
      const prompt = buildAiHumanPrompt(signal, payload);

      expect(payload.figures.trendline).toEqual(additionalTrendLine);
      expect(payload.additionalIndicators).toEqual(
        expect.objectContaining({
          trendlineContext: expect.objectContaining({
            mode: 'lows',
            touches: 3,
            distance: 42,
            currentLinePrice: 101,
            currentPrice: 100,
            priceVsLineSide: 'below',
          }),
        }),
      );
      expect(prompt).toContain('trendline.priceVsLineSide=below');
      expect(prompt).toContain('trendline.distance=42');
    });
  });

  describe('askAI', () => {
    it('replays explicit prompts via runAiPrompt', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 3.2,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: '101.5',
          stopLossPrice: '98.2',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt({
        systemPrompt: 'system',
        humanPrompt: 'human',
      });

      expect(chatOpenAICtorMock).toHaveBeenCalledTimes(1);
      const messages = invokeMock.mock.calls[0]?.[0] as any[];
      expect(messages[0].content).toBe('system');
      expect(messages[1].content.content[0].text).toBe('human');
      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 3,
          takeProfitPrice: 101.5,
          stopLossPrice: 98.2,
          comment: 'ok',
        }),
      );
    });

    it('applies TrendLine guardrail when signal context is provided', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 102,
          setup: 'Пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Сетап сильный',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeBlockedTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100.05,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('TrendLine guardrail');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks shallow BTC-led breaks without coin follow-through', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.2,
          setup: 'Чистый пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Сильный шорт',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeWeakBtcLedBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100.425,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain(
        'пробой слишком мелкий относительно ATR',
      );
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks weak clean breaks that lack displacement reserve', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.1,
          setup: 'Есть пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Чистый пробой',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeWeakCleanBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('слишком слабый относительно ATR');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks compressed clean breaks on short-range lines', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.15,
          setup: 'Есть пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Чистый пробой на короткой линии',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeCompressedCleanBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('слишком сжатым');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks weak long breaks on very long lines with weak btc support', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 104.5,
          stopLossPrice: 98.9,
          setup: 'Есть пробой вверх',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Чистый пробой вверх',
          triggerInvalidation: 'Отмена при возврате ниже',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeWeakLongFarBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('для LONG пробой очень длинной линии');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('allows aggressive pre-break pressure setups but caps quality to 4', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Агрессивное давление перед пробоем',
          retestPlan: 'Вход агрессивный',
          qualityReason: 'Сильное давление вниз',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeAggressivePreBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          takeProfitPrice: 96,
          stopLossPrice: 101.3,
        }),
      );
      expect(result.qualityReason).toBe('Сильное давление вниз');
    });

    it('allows strong near-break pressure setups but caps quality to 4', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Давление вниз у зрелой линии',
          retestPlan: 'Ждать ретест',
          qualityReason: 'Сильное давление вниз у линии',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeStrongNearBreakPressureTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          takeProfitPrice: 96,
          stopLossPrice: 101.3,
        }),
      );
      expect(result.qualityReason).toBe('Сильное давление вниз у линии');
    });

    it('reuses cached settings and model for repeated prompt calls', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 101.5,
          stopLossPrice: 98.2,
          comment: 'ok',
        },
      });

      await runAiPrompt({
        systemPrompt: 'system-1',
        humanPrompt: 'human-1',
      });
      await runAiPrompt({
        systemPrompt: 'system-2',
        humanPrompt: 'human-2',
      });

      expect(getUserSettingsMock).toHaveBeenCalledTimes(1);
      expect(chatOpenAICtorMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledTimes(2);
    });

    it('creates a separate client when model override changes', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 101.5,
          stopLossPrice: 98.2,
          comment: 'ok',
        },
      });

      await runAiPrompt(
        {
          systemPrompt: 'system-1',
          humanPrompt: 'human-1',
        },
        {
          model: 'google/gemini-3.1-pro-preview',
        },
      );
      await runAiPrompt(
        {
          systemPrompt: 'system-2',
          humanPrompt: 'human-2',
        },
        {
          model: 'openai/gpt-5-mini',
        },
      );

      expect(chatOpenAICtorMock).toHaveBeenCalledTimes(2);
      expect(chatOpenAICtorMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          modelName: 'google/gemini-3.1-pro-preview',
        }),
      );
      expect(chatOpenAICtorMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          modelName: 'openai/gpt-5-mini',
        }),
      );
    });

    it('normalizes object content and persists analysis to redis', async () => {
      getUserSettingsMock.mockResolvedValueOnce({
        userName: 'root',
        BYBIT_API_KEY: '',
        BYBIT_API_SECRET: '',
        token: '',
        COINALYZE_API_KEY: '',
        OPENAI_API_KEY: 'key_123',
        OPENAI_API_ENDPOINT: 'https://openrouter.example/v1',
        TG_BOT_TOKEN: 'tg-token',
        TG_CHAT_ID: 'tg-chat-id',
      });

      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 4.6,
          needRetest: 'yes',
          retestPrice: '101.25',
          takeProfitPrice: 104.5,
          stopLossPrice: '98.9',
          setup: 's'.repeat(500),
          confirmations: 'confirm',
          btcContext: 'btc',
          retestPlan: 'plan',
          riskLevels: 'risk',
          qualityReason: 'reason',
          triggerInvalidation: 'invalidate',
          comment: 'c'.repeat(1500),
        },
      });

      const result = await askAI(makeSignal());

      expect(chatOpenAICtorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
          modelName: 'google/gemini-3.1-pro-preview',
          apiKey: 'key_123',
          configuration: expect.objectContaining({
            baseURL: 'https://openrouter.example/v1',
          }),
        }),
      );
      expect(invokeMock).toHaveBeenCalledTimes(1);

      const messages = invokeMock.mock.calls[0]?.[0] as any[];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBeInstanceOf(MockSystemMessage);
      expect(messages[1]).toBeInstanceOf(MockHumanMessage);
      expect(messages[1].content.content[0].text).toContain(
        'Проанализируй сделку по ETHUSDT',
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 5,
          needRetest: true,
          retestPrice: 101.25,
          takeProfitPrice: 104.5,
          stopLossPrice: 98.9,
          comment: 'c'.repeat(1024),
        }),
      );
      expect(result.setup).toHaveLength(400);

      expect(analysisKeyMock).toHaveBeenCalledWith('ETHUSDT', 'sig-1');
      expect(setDataMock).toHaveBeenCalledWith(
        'analysis:ETHUSDT:sig-1',
        expect.objectContaining({
          direction: 'LONG',
          quality: 5,
        }),
      );
    });

    it('extracts JSON from array text response and parses numeric strings', async () => {
      invokeMock.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: [
              'prefix',
              '{"direction":"SHORT","quality":0,"needRetest":false,',
              '"retestPrice":"abc","takeProfitPrice":"120.5","stopLossPrice":"130",',
              '"setup":"setup","confirmations":"conf","btcContext":"ctx",',
              '"retestPlan":"plan","riskLevels":"risk","qualityReason":"q",',
              '"triggerInvalidation":"ti","comment":"ok"}',
              'suffix',
            ].join(' '),
          },
        ],
      });

      const result = await askAI(makeSignal());

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 1,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 120.5,
          stopLossPrice: 130,
          comment: 'ok',
        }),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns safe defaults when model response has no JSON block', async () => {
      invokeMock.mockResolvedValue({
        content: 'no json here',
      });

      const result = await askAI(makeSignal());

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: undefined,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          comment: '',
        }),
      );
      expect(errorSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('🔍 Исходный текст:', 'no json here');
    });

    it('handles invalid json block and non-text array parts', async () => {
      invokeMock.mockResolvedValue({
        content: [{ image_url: 'x' }, { text: '```json { invalid } ```' }],
      });

      const result = await askAI(makeSignal());

      expect(result.direction).toBeNull();
      expect(result.comment).toBe('');
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
