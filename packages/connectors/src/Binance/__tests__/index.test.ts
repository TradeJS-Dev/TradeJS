import { fetchWithRetry } from '@tradejs/infra/http';
import { BinanceConnectorCreator } from '..';

jest.mock('@tradejs/infra/http', () => ({
  fetchWithRetry: jest.fn(),
}));

const mockedFetchWithRetry = fetchWithRetry as jest.MockedFunction<
  typeof fetchWithRetry
>;

const makeResponse = ({
  ok = true,
  payload = {},
}: {
  ok?: boolean;
  payload?: unknown;
} = {}) =>
  ({
    ok,
    json: jest.fn().mockResolvedValue(payload),
  }) as any;

describe('BinanceConnectorCreator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BINANCE_BASE_URL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads symbol top-of-book from Binance bookTicker endpoint', async () => {
    process.env.BINANCE_BASE_URL = ' https://binance.local ';
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({
        payload: {
          symbol: 'ETHUSDT',
          bidPrice: '100.5',
          bidQty: '12',
          askPrice: '101.5',
          askQty: '8',
        },
      }),
    );

    const connector = await BinanceConnectorCreator({ userName: 'test' });
    const ticker = await connector.getTopOfBookTicker?.(' ethusdt ');

    expect(ticker).toEqual({
      symbol: 'ETHUSDT',
      bidPrice: 100.5,
      bidQty: 12,
      askPrice: 101.5,
      askQty: 8,
      timestamp: 1_700_000_000_000,
    });

    const [urlString, options] = mockedFetchWithRetry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const url = new URL(urlString);
    expect(url.origin).toBe('https://binance.local');
    expect(url.pathname).toBe('/api/v3/ticker/bookTicker');
    expect(url.searchParams.get('symbol')).toBe('ETHUSDT');
    expect(options).toEqual({
      headers: { 'User-Agent': 'tradejs/binance-connector' },
    });
  });

  it('returns null when Binance bookTicker request fails', async () => {
    mockedFetchWithRetry.mockResolvedValue(makeResponse({ ok: false }));

    const connector = await BinanceConnectorCreator({ userName: 'test' });

    await expect(connector.getTopOfBookTicker?.('BTCUSDT')).resolves.toBeNull();
  });

  it('loads aggregate trades from Binance aggTrades endpoint', async () => {
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({
        payload: [
          {
            a: 10,
            p: '100.5',
            q: '2',
            f: 7,
            l: 9,
            T: 1_700_000_000_000,
            m: false,
          },
        ],
      }),
    );

    const connector = await BinanceConnectorCreator({ userName: 'test' });
    const rows = await connector.getAggTrades?.({
      symbol: 'btcusdt',
      startTime: 1,
      endTime: 2,
      limit: 5000,
    });

    expect(rows).toEqual([
      {
        aggregateTradeId: 10,
        price: 100.5,
        quantity: 2,
        firstTradeId: 7,
        lastTradeId: 9,
        timestamp: 1_700_000_000_000,
        isBuyerMaker: false,
      },
    ]);

    const [urlString] = mockedFetchWithRetry.mock.calls[0] as [string];
    const url = new URL(urlString);
    expect(url.pathname).toBe('/api/v3/aggTrades');
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(url.searchParams.get('startTime')).toBe('1');
    expect(url.searchParams.get('endTime')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('1000');
  });

  it('loads full order book depth from Binance depth endpoint', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({
        payload: {
          lastUpdateId: 123,
          bids: [
            ['100', '2'],
            ['99', '3'],
          ],
          asks: [['101', '4']],
        },
      }),
    );

    const connector = await BinanceConnectorCreator({ userName: 'test' });
    const depth = await connector.getOrderBookDepth?.({
      symbol: 'ethusdt',
      limit: 5000,
    });

    expect(depth).toEqual({
      symbol: 'ETHUSDT',
      lastUpdateId: 123,
      bids: [
        [100, 2],
        [99, 3],
      ],
      asks: [[101, 4]],
      timestamp: 1_700_000_000_000,
    });

    const [urlString] = mockedFetchWithRetry.mock.calls[0] as [string];
    const url = new URL(urlString);
    expect(url.pathname).toBe('/api/v3/depth');
    expect(url.searchParams.get('symbol')).toBe('ETHUSDT');
    expect(url.searchParams.get('limit')).toBe('5000');
  });
});
