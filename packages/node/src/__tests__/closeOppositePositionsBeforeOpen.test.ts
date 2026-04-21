jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

import { closeOppositePositionsBeforeOpen } from '../strategyHooks/closeOppositePositionsBeforeOpen';

describe('closeOppositePositionsBeforeOpen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes only opposite positions using entryContext values', async () => {
    const connector = {
      getPositions: jest.fn(async () => [
        { symbol: 'ETHUSDT', qty: 1, direction: 'SHORT' },
        { symbol: 'BTCUSDT', qty: 2, direction: 'LONG' },
        { symbol: 'SOLUSDT', qty: 0, direction: 'SHORT' },
        { symbol: 'XRPUSDT', qty: 1, direction: 'LONG' },
      ]),
      closePosition: jest.fn(async () => true),
    } as any;

    await closeOppositePositionsBeforeOpen({
      connector,
      entryContext: {
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        prices: {
          currentPrice: 123.45,
          takeProfitPrice: 130,
          stopLossPrice: 120,
          riskRatio: 2,
        },
        isConfigFromBacktest: false,
      },
    });

    expect(connector.closePosition).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledWith({
      symbol: 'ETHUSDT',
      price: 123.45,
      timestamp: 1_700_000_000_000,
      direction: 'SHORT',
    });
  });

  it('does nothing when no opposite positions exist', async () => {
    const connector = {
      getPositions: jest.fn(async () => [
        { symbol: 'BTCUSDT', qty: 1, direction: 'LONG' },
        { symbol: 'ETHUSDT', qty: 1, direction: 'LONG' },
      ]),
      closePosition: jest.fn(async () => true),
    } as any;

    await closeOppositePositionsBeforeOpen({
      connector,
      entryContext: {
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
      },
    });

    expect(connector.closePosition).not.toHaveBeenCalled();
  });
});
