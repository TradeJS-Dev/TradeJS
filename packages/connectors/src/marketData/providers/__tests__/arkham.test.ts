const makeResponse = ({
  ok = true,
  status = 200,
  payload = [],
  text = 'error',
}: {
  ok?: boolean;
  status?: number;
  payload?: unknown;
  text?: string;
} = {}) =>
  ({
    ok,
    status,
    headers: {
      get: jest.fn(() => null),
    },
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(text),
  }) as any;

describe('arkham onchain provider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.ARKHAM_MIN_REQUEST_DELAY_MS = '0';
    process.env.ARKHAM_MAX_RETRIES = '0';
    process.env.ARKHAM_BASE_URL = 'https://arkham.local';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ARKHAM_MIN_REQUEST_DELAY_MS;
    delete process.env.ARKHAM_MAX_RETRIES;
    delete process.env.ARKHAM_BASE_URL;
  });

  it('resolves symbol token ids from overrides and defaults', async () => {
    const { parseArkhamSymbolTokenIds, resolveArkhamTokenId } = await import(
      '../arkham'
    );

    expect(
      parseArkhamSymbolTokenIds('btcusdt=bitcoin, SOLUSDT=solana'),
    ).toEqual({
      BTCUSDT: 'bitcoin',
      SOLUSDT: 'solana',
    });
    expect(resolveArkhamTokenId('ETHUSDT')).toBe('ethereum');
    expect(resolveArkhamTokenId('WIFUSDT')).toBe('wif');
    expect(resolveArkhamTokenId('BTCUSDT', { BTCUSDT: 'bitcoin-custom' })).toBe(
      'bitcoin-custom',
    );
  });

  it('fetches Arkham histograms and maps them to one onchain row', async () => {
    const fetchMock = jest.fn(async (urlString: string, _options?: unknown) => {
      const url = new URL(urlString);
      if (url.pathname === '/transfers/histogram') {
        const flow = url.searchParams.get('flow');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const base = url.searchParams.get('base');
        if (to === 'type:cex') return makeResponse({ payload: [{ usd: 100 }] });
        if (from === 'type:cex') {
          return makeResponse({ payload: [{ usd: 900 }] });
        }
        if (base === 'smart-a' && flow === 'in') {
          return makeResponse({ payload: [{ usd: 300 }] });
        }
        if (base === 'smart-a' && flow === 'out') {
          return makeResponse({ payload: [{ usd: 50 }] });
        }
        if (base === 'whale-a' && flow === 'in') {
          return makeResponse({ payload: [{ usd: 1000 }] });
        }
        if (base === 'whale-a' && flow === 'out') {
          return makeResponse({ payload: [{ usd: 200 }] });
        }
      }
      if (url.pathname === '/swaps') {
        const flow = url.searchParams.get('flow');
        return makeResponse({
          payload: {
            swaps:
              flow === 'in'
                ? [{ historicalUSD: 400 }]
                : [{ historicalUSD: 150 }],
          },
        });
      }
      return makeResponse();
    });
    global.fetch = fetchMock as any;

    const { fetchArkhamOnchainWindow } = await import('../arkham');

    await expect(
      fetchArkhamOnchainWindow({
        symbol: 'ethusdt',
        tokenId: 'ethereum',
        apiKey: 'arkham-key',
        interval: '15m',
        fromMs: Date.UTC(2026, 0, 1, 0, 0, 0),
        toMs: Date.UTC(2026, 0, 1, 0, 15, 0) - 1,
        smartEntities: ['smart-a'],
        whaleEntities: ['whale-a'],
        dexBases: ['dex-base'],
        usdGte: 100,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        symbol: 'ETHUSDT',
        interval: '15m',
        whaleNetFlowUsd: 800,
        smartTraderNetFlowUsd: 250,
        cexDepositUsd: 100,
        cexWithdrawUsd: 900,
        dexBuyUsd: 400,
        dexSellUsd: 150,
        entityCount: 3,
        source: 'arkham',
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(8);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ headers: { 'API-Key': 'arkham-key' } });
    }
    const firstUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(firstUrl.origin).toBe('https://arkham.local');
    expect(firstUrl.pathname).toBe('/transfers/histogram');
    expect(firstUrl.searchParams.get('tokens')).toBe('ethereum');
    expect(firstUrl.searchParams.get('timeGte')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(firstUrl.searchParams.get('timeLte')).toBe(
      '2026-01-01T00:14:59.999Z',
    );
    expect(firstUrl.searchParams.get('usdGte')).toBe('100');
  });

  it('can include recent top flow as whale fallback', async () => {
    const fetchMock = jest.fn(async (urlString: string, _options?: unknown) => {
      const url = new URL(urlString);
      if (url.pathname === '/token/top_flow/bitcoin') {
        return makeResponse({
          payload: [
            { inUSD: 1000, outUSD: 100 },
            { inUSD: 50, outUSD: 200 },
          ],
        });
      }
      return makeResponse({ payload: [] });
    });
    global.fetch = fetchMock as any;

    const { fetchArkhamOnchainWindow } = await import('../arkham');

    const rows = await fetchArkhamOnchainWindow({
      symbol: 'BTCUSDT',
      apiKey: 'arkham-key',
      interval: '1h',
      fromMs: 1,
      toMs: 2,
      includeRecentTopFlow: true,
      topFlowLimit: 2,
    });

    expect(rows[0]?.whaleNetFlowUsd).toBe(750);
    const topFlowCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/token/top_flow/bitcoin'),
    );
    expect(topFlowCall).toBeTruthy();
    const topFlowUrl = new URL(topFlowCall?.[0] ?? '');
    expect(topFlowUrl.searchParams.get('timeLast')).toBe('1h');
    expect(topFlowUrl.searchParams.get('limit')).toBe('2');
  });

  it('throws when API key is missing', async () => {
    const { fetchArkhamOnchainWindow } = await import('../arkham');

    await expect(
      fetchArkhamOnchainWindow({
        symbol: 'BTCUSDT',
        interval: '15m',
        fromMs: 1,
        toMs: 2,
      }),
    ).rejects.toThrow('Missing ARKHAM_API_KEY');
  });
});
