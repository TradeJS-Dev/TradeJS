const mockUpdate = jest.fn();
const mockGetConnectorCreatorByName = jest.fn();

jest.mock('@tradejs/node/cli', () => ({
  update: (...args: unknown[]) => mockUpdate(...args),
}));

jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByName: (...args: unknown[]) =>
    mockGetConnectorCreatorByName(...args),
}));

import {
  loadBtcReferenceConnectors,
  updateMarketHistoryWithBtcReferences,
} from '../lib/marketData/historyPrepare';

describe('market history prepare helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
  });

  it('loads dedicated BTC reference connectors when requested', async () => {
    const marketConnector = { name: 'ByBit' };
    const binanceConnector = { name: 'Binance' };
    const coinbaseConnector = { name: 'Coinbase' };
    mockGetConnectorCreatorByName
      .mockResolvedValueOnce(async () => binanceConnector)
      .mockResolvedValueOnce(async () => coinbaseConnector);

    await expect(
      loadBtcReferenceConnectors({
        connectorName: 'ByBit',
        marketConnector: marketConnector as any,
        userName: 'root',
        projectRoot: '/repo',
        shouldUseDedicatedReferences: true,
        requireDedicatedReferences: true,
        warn: jest.fn(),
      }),
    ).resolves.toEqual({
      binance: binanceConnector,
      coinbase: coinbaseConnector,
    });
  });

  it('updates market history and both dedicated BTC references', async () => {
    const marketConnector = { name: 'ByBit' };
    const binanceConnector = { name: 'Binance' };
    const coinbaseConnector = { name: 'Coinbase' };

    await updateMarketHistoryWithBtcReferences({
      marketConnector: marketConnector as any,
      connectorName: 'ByBit',
      btcReferences: {
        binance: binanceConnector as any,
        coinbase: coinbaseConnector as any,
      },
      interval: '15',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      preloadStart: 1_000,
      preloadEnd: 2_000,
      log: jest.fn(),
    });

    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenNthCalledWith(
      1,
      marketConnector,
      '15',
      ['BTCUSDT', 'ETHUSDT'],
      undefined,
      {
        connectorLabel: 'ByBit',
        preloadStart: 1_000,
        preloadEnd: 2_000,
      },
    );
    expect(mockUpdate).toHaveBeenNthCalledWith(
      2,
      binanceConnector,
      '15',
      ['BTCUSDT'],
      undefined,
      {
        connectorLabel: 'Binance',
        preloadStart: 1_000,
        preloadEnd: 2_000,
      },
    );
  });
});
