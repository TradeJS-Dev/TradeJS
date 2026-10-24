import { createStrategyAPI } from '../strategyHelpers/signalBuilders';
import type {
  KlineChartItem,
  StrategyClosedCandlesRequest,
} from '@tradejs/types';

const STEP = 15 * 60_000;
const HOUR = 4 * STEP;
const END = Date.UTC(2026, 9, 20);
const candle = (timestamp: number): KlineChartItem => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
  turnover: 1000,
});
const request: StrategyClosedCandlesRequest = {
  interval: '15',
  start: END - HOUR,
  end: END,
  limit: 4,
};
const setup = (
  env = 'BACKTEST',
  rows = Array.from({ length: 4 }, (_, i) => candle(END - HOUR + i * STEP)),
  interval: any = '60',
) => {
  const kline = jest.fn(async () => rows);
  const data = [candle(END)];
  const api = createStrategyAPI({
    strategy: 'Test',
    symbol: 'BTCUSDT',
    interval,
    env,
    cachedData: data,
    connector: { kline } as any,
  });
  return { api, kline, data, rows };
};

describe('StrategyAPI.getClosedCandles', () => {
  it.each(['BACKTEST', 'PARITY', 'CRON'])(
    'binds venue, symbol and causal source window in %s',
    async (env) => {
      const { api, kline } = setup(env);
      const snapshot = await api.getClosedCandles(request);
      expect(snapshot).toMatchObject({
        interval: '15',
        start: request.start,
        end: END,
        asOf: END + HOUR,
        complete: true,
        missingRanges: [],
      });
      expect(snapshot.candles.map((c) => c.timestamp)).toEqual([
        END - HOUR,
        END - 3 * STEP,
        END - 2 * STEP,
        END - STEP,
      ]);
      expect(kline).toHaveBeenCalledWith({
        symbol: 'BTCUSDT',
        interval: '15',
        start: request.start,
        end: END - 1,
        cacheOnly: env !== 'CRON',
        silent: true,
      });
    },
  );
  it('includes exactly closed source candles and ignores unfinished, future and outside-window data', async () => {
    const rows = [
      candle(END + HOUR),
      candle(END - STEP),
      candle(END + 2 * STEP),
      candle(END),
      candle(END + STEP),
      candle(END + 3 * STEP),
      candle(END - HOUR),
    ];
    const { api } = setup('BACKTEST', rows);
    const snapshot = await api.getClosedCandles({
      interval: '15',
      start: END,
      end: END + HOUR,
      limit: 4,
    });
    expect(snapshot.candles.map((c) => c.timestamp)).toEqual([
      END,
      END + STEP,
      END + 2 * STEP,
      END + 3 * STEP,
    ]);
    expect(snapshot.complete).toBe(true);
    const old = await api.getClosedCandles({
      interval: '15',
      start: END - STEP,
      end: END,
      limit: 1,
    });
    expect(old.candles).toEqual([candle(END - STEP)]);
  });
  it('freezes asOf before asynchronous loading and detaches returned candles', async () => {
    const { api, kline, data } = setup();
    let resolve!: (rows: KlineChartItem[]) => void;
    kline.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = api.getClosedCandles(request);
    data.push(candle(END + HOUR));
    const row = candle(request.start);
    resolve([row]);
    const snapshot = await pending;
    expect(snapshot.asOf).toBe(END + HOUR);
    snapshot.candles[0].close = 999;
    expect(row.close).toBe(101);
  });
  it('reports contiguous missing slots without fabricating zero-volume candles', async () => {
    const { api } = setup('BACKTEST', [candle(END - HOUR), candle(END - STEP)]);
    const snapshot = await api.getClosedCandles(request);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.candles).toHaveLength(2);
    expect(snapshot.missingRanges).toEqual([
      { start: END - 3 * STEP, end: END - STEP },
    ]);
    const empty = setup('PARITY', []).api;
    expect((await empty.getClosedCandles(request)).missingRanges).toEqual([
      { start: END - HOUR, end: END },
    ]);
  });
  it.each([
    { start: END + HOUR, end: END + 2 * HOUR },
    { start: END - 1 },
    { end: END + 1 },
    { start: NaN },
    { end: Infinity },
    { start: -STEP },
    { start: END },
    { limit: 3 },
    { limit: 0 },
    { limit: 1.5 },
    { limit: 1537 },
    { interval: '60' },
    { start: END - 1537 * STEP, limit: 1536 },
  ])('rejects invalid or non-causal bounds before IO: %j', async (patch) => {
    const { api, kline } = setup();
    await expect(
      api.getClosedCandles({ ...request, ...patch } as any),
    ).rejects.toThrow('window');
    expect(kline).not.toHaveBeenCalled();
  });
  it.each(['D', 'M', 'invalid'])(
    'rejects unsupported execution interval %s before IO',
    async (interval) => {
      const { api, kline } = setup('BACKTEST', [], interval);
      await expect(api.getClosedCandles(request)).rejects.toThrow(
        'fixed minute',
      );
      expect(kline).not.toHaveBeenCalled();
    },
  );
  it.each([
    { timestamp: END - STEP + 1 },
    { timestamp: NaN },
    { open: NaN },
    { high: 98 },
    { close: 103 },
    { volume: -1 },
    { turnover: -1 },
  ])('rejects malformed source OHLCV: %j', async (patch) => {
    const { api } = setup('BACKTEST', [{ ...candle(END - STEP), ...patch }]);
    await expect(api.getClosedCandles(request)).rejects.toThrow('source row');
  });
  it('rejects duplicate timestamps instead of choosing a revision by provider ordering', async () => {
    const row = candle(END - STEP);
    await expect(
      setup('BACKTEST', [row, { ...row }]).api.getClosedCandles(request),
    ).rejects.toThrow('duplicate');
  });
  it('allows the maximum bounded window and propagates provider failure', async () => {
    const { api, kline } = setup('BACKTEST', []);
    const snapshot = await api.getClosedCandles({
      ...request,
      start: END - 1536 * STEP,
      limit: 1536,
    });
    expect(snapshot.missingRanges).toEqual([
      { start: END - 1536 * STEP, end: END },
    ]);
    kline.mockRejectedValueOnce(new Error('cache unavailable'));
    await expect(api.getClosedCandles(request)).rejects.toThrow(
      'cache unavailable',
    );
  });
  it('uses source duration rather than execution duration to decide whether a 15m candle is closed', async () => {
    const { api } = setup('BACKTEST', [candle(END)], '15');
    const snapshot = await api.getClosedCandles({
      ...request,
      start: END,
      end: END + STEP,
      limit: 1,
    });
    expect(snapshot.asOf).toBe(END + STEP);
    expect(snapshot.complete).toBe(true);
  });
});
