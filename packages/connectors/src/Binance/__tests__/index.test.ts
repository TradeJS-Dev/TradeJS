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
});
