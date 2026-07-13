const mockGetCurrentUserName = jest.fn();
const mockGetConnectorCreatorByProvider = jest.fn();
const mockGetTopTickers = jest.fn((value: unknown) => value);

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/core/tickers', () => ({
  getTopTickers: (...args: unknown[]) => mockGetTopTickers(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: { log: jest.fn() },
}));

import { GET } from '../route';

const context = (provider: string, universe?: string) => ({
  params: Promise.resolve({ provider, universe }),
});

describe('/api/scanner provider route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
  });

  it('keeps omitted universe backward compatible with crypto defaults', async () => {
    const getTickers = jest.fn(async () => [{ symbol: 'BTCUSDT' }]);
    const connectorCreator = jest.fn(async () => ({ getTickers }));
    mockGetConnectorCreatorByProvider.mockResolvedValue(connectorCreator);

    const response = await GET({} as Request, context('coinbase'));

    expect(connectorCreator).toHaveBeenCalledWith({ userName: 'root' });
    expect(getTickers).toHaveBeenCalledWith(undefined);
    expect(response).toEqual({
      status: 200,
      body: { tickers: [{ symbol: 'BTCUSDT' }] },
    });
  });

  it('passes explicit TradFi universe through connector creation and query', async () => {
    const getTickers = jest.fn(async () => [{ symbol: 'AAPLUSDT' }]);
    const connectorCreator = jest.fn(async () => ({ getTickers }));
    mockGetConnectorCreatorByProvider.mockResolvedValue(connectorCreator);

    const response = await GET({} as Request, context('bybit', 'tradfi'));

    expect(connectorCreator).toHaveBeenCalledWith({
      userName: 'root',
      universe: 'tradfi',
    });
    expect(getTickers).toHaveBeenCalledWith({ universe: 'tradfi' });
    expect(response.body).toEqual({ tickers: [{ symbol: 'AAPLUSDT' }] });
  });

  it('rejects invalid and unsupported universes', async () => {
    const invalid = await GET({} as Request, context('bybit', 'stocks'));
    expect(invalid).toEqual({
      status: 400,
      body: { error: 'Unknown market universe: stocks' },
    });

    mockGetConnectorCreatorByProvider.mockResolvedValue(async () => {
      throw new Error('Unsupported market universe: tradfi');
    });
    const unsupported = await GET({} as Request, context('coinbase', 'tradfi'));
    expect(unsupported).toEqual({
      status: 400,
      body: { error: 'Unsupported market universe: tradfi' },
    });
  });

  it('serializes object-shaped provider errors', async () => {
    mockGetConnectorCreatorByProvider.mockResolvedValue(async () => ({
      getTickers: async () => {
        throw {
          code: 403,
          message: 'Forbidden',
          body: 'CloudFront blocked this request',
          requestOptions: { apiKey: 'secret' },
        };
      },
    }));

    const response = await GET({} as Request, context('bybit', 'crypto'));

    expect(response).toEqual({
      status: 500,
      body: {
        error: '403 Forbidden: CloudFront blocked this request',
      },
    });
  });
});
