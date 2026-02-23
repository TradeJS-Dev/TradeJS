jest.mock('@langchain/openai', () => ({
  ChatOpenAI: class {},
}));

jest.mock('@langchain/core/messages', () => ({
  HumanMessage: class {},
  SystemMessage: class {},
}));

const {
  MAX_AI_SERIES_POINTS,
  buildAiHumanPrompt,
  buildAiPayload,
  buildAiSystemPrompt,
  trimSeriesDeep,
} = require('../ai');

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
      expect(payload.indicators.nested.atrPct).toEqual([0.2, 0.3, 0.4, 0.5, 0.6]);
      expect(payload.indicators.candles15m).toHaveLength(MAX_AI_SERIES_POINTS);
      expect(payload.indicators.matrix).toHaveLength(MAX_AI_SERIES_POINTS);

      expect(payload.figures.trendline).toBe(signal.figures.trendLine);
      expect(payload.figures.trendline.touches).toHaveLength(6);
      expect(payload.figures.trendline.alpha).toHaveLength(6);
    });
  });

  describe('prompt builders', () => {
    it('system prompt includes critical constraints and examples', () => {
      const prompt = buildAiSystemPrompt();

      expect(prompt).toContain('Пиши comment по-русски');
      expect(prompt).toContain('quality" — качество ВХОДА ИМЕННО СЕЙЧАС');
      expect(prompt).toContain('Никогда не предлагай противоположное направление');
      expect(prompt).toContain('"needRetest": boolean');
      expect(prompt).toContain('"retestPrice": number | null');
      expect(prompt).toContain('reward/risk >= 0.33');
      expect(prompt).toContain('Одна строка по шаблону');
      expect(prompt).toContain('Короткие примеры (few-shot');
      expect(prompt).toContain('Не добавляй другие поля');
      expect(prompt).not.toContain('runtime-нейминг');
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
});
