import { createPortfolioReplayConnector } from '../lib/replay/portfolioReplayConnector';

describe('portfolio replay connector', () => {
  const baseConnector = {
    kline: jest.fn(),
    getState: jest.fn(async () => ({})),
    setState: jest.fn(async () => undefined),
    getPosition: jest.fn(),
    getPositions: jest.fn(),
    placeOrder: jest.fn(),
    setTakeProfits: jest.fn(),
    setStopLoss: jest.fn(),
    closePosition: jest.fn(),
    getTickers: jest.fn(async () => []),
  } as any;

  it('tracks multiple open positions and open pnl across symbols', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'TrendLine',
      } as any,
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 2,
      price: 50,
      timestamp: 1,
      direction: 'SHORT',
      signal: {
        strategy: 'TrendShift',
      } as any,
    });

    await connector.advanceMarket({
      symbol: 'BTCUSDT',
      candle: {
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 0,
        turnover: 0,
        timestamp: 2,
      },
    });
    await connector.advanceMarket({
      symbol: 'ETHUSDT',
      candle: {
        open: 50,
        high: 52,
        low: 45,
        close: 46,
        volume: 0,
        turnover: 0,
        timestamp: 2,
      },
    });

    expect(await connector.getPositions()).toHaveLength(2);
    expect(connector.getOpenPositionPnl).toBeDefined();
    expect(await connector.getOpenPositionPnl!()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'BTCUSDT',
          unrealizedPnl: 5,
        }),
        expect.objectContaining({
          symbol: 'ETHUSDT',
          unrealizedPnl: 8,
        }),
      ]),
    );
  });

  it('keeps separate strategy artifacts and closes positions by take profit', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'TrendLine',
      } as any,
    });
    await connector.setTakeProfits({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      takeProfits: [{ price: 110, rate: 1 }],
    });

    await connector.advanceMarket({
      symbol: 'BTCUSDT',
      candle: {
        open: 100,
        high: 111,
        low: 99,
        close: 108,
        volume: 0,
        turnover: 0,
        timestamp: 2,
      },
    });

    expect(await connector.getPosition('BTCUSDT')).toBeNull();

    const artifacts = connector.getReplayArtifacts();
    expect(artifacts.orderLog).toHaveLength(2);
    expect(artifacts.positionLog).toHaveLength(1);
    expect(artifacts.orderLogByStrategy.get('TrendLine')).toHaveLength(2);
    expect(artifacts.positionLogByStrategy.get('TrendLine')).toHaveLength(1);
    expect(artifacts.orderLog[0]).toEqual(
      expect.objectContaining({
        type: 'OPEN_LONG',
        fee: 0.3,
        profit: -0.3,
      }),
    );
    expect(artifacts.orderLog[1]).toEqual(
      expect.objectContaining({
        type: 'TAKE_PROFIT_LONG',
        fee: 0.33,
        profit: 9.67,
        amount: 109.37,
      }),
    );
  });
});
