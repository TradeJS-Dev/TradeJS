import { fetchWithRetry } from '@tradejs/core/http';
import { HyperliquidConnectorCreator } from '../index';

jest.mock('@tradejs/core/http', () => ({ fetchWithRetry: jest.fn() }));
const fetchInfo = jest.mocked(fetchWithRetry);

const candle = (t: number) => ({
  s: 'kPEPE',
  i: '15m',
  t,
  T: t + 899_999,
  o: '1',
  h: '2',
  l: '0.5',
  c: '1.5',
  v: '3',
  n: 1,
});
const response = (payload: unknown) =>
  ({ ok: true, json: async () => payload }) as Response;

afterEach(() => {
  jest.restoreAllMocks();
  fetchInfo.mockReset();
});

it('resolves native market spelling and separates settlement from quote', async () => {
  fetchInfo.mockResolvedValue(
    response({
      universe: [
        { name: 'kPEPE', szDecimals: 0, maxLeverage: 10 },
        { name: 'HYPE', szDecimals: 2, maxLeverage: 10 },
      ],
    }),
  );
  const connector = await HyperliquidConnectorCreator({ userName: 'test' });
  const instruments = await connector.listInstruments();
  expect(instruments).toEqual([
    expect.objectContaining({
      symbol: 'KPEPEUSDT',
      quoteAsset: 'USDT',
      settleAsset: 'USDC',
      venueMetadata: expect.objectContaining({ coin: 'kPEPE' }),
    }),
    expect.objectContaining({
      symbol: 'HYPEUSDC',
      quoteAsset: 'USDC',
      settleAsset: 'USDC',
    }),
  ]);
  await expect(
    connector.kline({ symbol: 'HYPEUSDT', interval: '15', end: 900_000 }),
  ).rejects.toThrow('Unknown Hyperliquid perpetual');
  expect(fetchInfo).toHaveBeenCalledTimes(1);
});

it('returns only closed requested candles in time order, once each', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(3_000_000);
  fetchInfo.mockResolvedValueOnce(
    response({ universe: [{ name: 'kPEPE', szDecimals: 0, maxLeverage: 10 }] }),
  );
  fetchInfo.mockResolvedValueOnce(
    response([
      candle(2_700_000),
      candle(1_800_000),
      candle(900_000),
      candle(900_000),
      candle(0),
    ]),
  );
  const connector = await HyperliquidConnectorCreator({ userName: 'test' });
  expect(
    await connector.kline({
      symbol: 'KPEPEUSDT',
      interval: '15',
      start: 900_000,
      end: 3_000_000,
    }),
  ).toEqual([
    expect.objectContaining({ timestamp: 900_000, volume: 3, turnover: 4.5 }),
    expect.objectContaining({ timestamp: 1_800_000 }),
  ]);
  expect(JSON.parse(String(fetchInfo.mock.calls[1][1]?.body))).toEqual({
    type: 'candleSnapshot',
    req: {
      coin: 'kPEPE',
      interval: '15m',
      startTime: 900_000,
      endTime: 3_000_000,
    },
  });
});

it('paginates funding events without rounding settlement timestamps', async () => {
  fetchInfo.mockResolvedValueOnce(
    response({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] }),
  );
  const rows = Array.from({ length: 501 }, (_, i) => ({
    coin: 'BTC',
    time: i * 3_600_000 + 76,
    fundingRate: '0.0000125',
  }));
  fetchInfo
    .mockResolvedValueOnce(response(rows.slice(0, 500)))
    .mockResolvedValueOnce(response(rows.slice(500)));
  const connector = await HyperliquidConnectorCreator({ userName: 'test' });
  const funding = await connector.getFundingRateHistory!({
    symbol: 'BTCUSDT',
    startTime: 0,
    endTime: rows[500].time,
  });
  expect(funding).toHaveLength(501);
  expect(funding.at(-1)).toEqual({
    symbol: 'BTCUSDT',
    timestamp: rows[500].time,
    rate: 0.0000125,
  });
  expect(JSON.parse(String(fetchInfo.mock.calls[2][1]?.body)).startTime).toBe(
    rows[499].time + 1,
  );
});
