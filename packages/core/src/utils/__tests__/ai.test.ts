const invokeMock = jest.fn();
const chatOpenAICtorMock = jest.fn();
const setDataMock = jest.fn();
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

const {
  MAX_AI_SERIES_POINTS,
  askAI,
  buildAiHumanPrompt,
  buildAiPayload,
  buildAiSystemPrompt,
  trimSeriesDeep,
} = require('../ai');
const {
  registerStrategyEntries,
  resetStrategyRegistryCache,
} = require('../../strategy/manifests');
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

describe('ai helpers', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    resetStrategyRegistryCache();
    registerStrategyEntries(strategyEntries);
    invokeMock.mockReset();
    chatOpenAICtorMock.mockReset();
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
      expect(prompt).toContain('Короткие примеры (few-shot');
      expect(prompt).toContain('Не добавляй другие поля');
      expect(prompt).not.toContain('runtime-нейминг');
    });

    it('adds strategy-specific system prompt section for TrendLine', () => {
      const prompt = buildAiSystemPrompt(makeSignal());

      expect(prompt).toContain('Дополнение для trendline-сетапов');
      expect(prompt).toContain('figures.trendline');
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
      expect(prompt).toContain('"maFast":[3,4,5,6,7]');
      expect(prompt).not.toContain('"riskRatio"');
    });
  });

  describe('askAI', () => {
    it('normalizes object content and persists analysis to redis', async () => {
      process.env.OPENAI_API_KEY = 'key_123';
      process.env.OPENAI_API_ENDPOINT = 'https://openrouter.example/v1';

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
          openAIApiKey: 'key_123',
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
