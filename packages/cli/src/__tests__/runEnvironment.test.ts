const mockGetTickers = jest.fn();
const mockUpdate = jest.fn();
const mockResolveConnectorName = jest.fn();
const mockGetConnectorCreatorByName = jest.fn();
const mockLoadBtcReferenceConnectors = jest.fn();
const mockUpdateMarketHistoryWithBtcReferences = jest.fn();

jest.mock('@tradejs/node/cli', () => ({
  getTickers: (...args: unknown[]) => mockGetTickers(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

jest.mock('@tradejs/node/connectors', () => ({
  DEFAULT_CONNECTOR_NAME: 'ByBit',
  getConnectorCreatorByName: (...args: unknown[]) =>
    mockGetConnectorCreatorByName(...args),
  resolveConnectorName: (...args: unknown[]) =>
    mockResolveConnectorName(...args),
}));

jest.mock('../lib/marketData/historyPrepare', () => ({
  loadBtcReferenceConnectors: (...args: unknown[]) =>
    mockLoadBtcReferenceConnectors(...args),
  updateMarketHistoryWithBtcReferences: (...args: unknown[]) =>
    mockUpdateMarketHistoryWithBtcReferences(...args),
}));

import {
  prepareRunEnvironment,
  resolveBacktestExecutionPreloadInterval,
} from '../lib/runEnvironment';

describe('resolveBacktestExecutionPreloadInterval', () => {
  it('maps primary backtest intervals to execution preload intervals', () => {
    expect(resolveBacktestExecutionPreloadInterval('15')).toBe('5');
    expect(resolveBacktestExecutionPreloadInterval('60')).toBe('15');
  });

  it('does not infer execution preload intervals for unsupported primary intervals', () => {
    expect(resolveBacktestExecutionPreloadInterval('5' as any)).toBeNull();
    expect(resolveBacktestExecutionPreloadInterval('240' as any)).toBeNull();
  });
});

describe('prepareRunEnvironment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveConnectorName.mockResolvedValue('ByBit');
    mockGetTickers.mockResolvedValue(['ETHUSDT']);
    mockUpdate.mockResolvedValue(undefined);
    mockUpdateMarketHistoryWithBtcReferences.mockResolvedValue(undefined);
    mockLoadBtcReferenceConnectors.mockResolvedValue({
      binance: { name: 'Binance' },
      coinbase: { name: 'Coinbase' },
    });
    mockGetConnectorCreatorByName.mockResolvedValue(async () => ({
      name: 'ByBit',
    }));
  });

  it('preloads execution interval only on the selected market connector', async () => {
    const result = await prepareRunEnvironment({
      connector: 'ByBit',
      userName: 'root',
      interval: '15',
      projectRoot: '/repo',
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
    });

    expect(result?.connectorName).toBe('ByBit');
    expect(mockUpdateMarketHistoryWithBtcReferences).toHaveBeenCalledTimes(1);
    expect(mockUpdateMarketHistoryWithBtcReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorName: 'ByBit',
        interval: '15',
        symbols: ['ETHUSDT'],
        preloadEnd: 1_700_086_400_000,
      }),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ByBit' }),
      '5',
      ['ETHUSDT'],
      undefined,
      expect.objectContaining({
        connectorLabel: 'ByBit',
        preloadEnd: 1_700_086_400_000,
      }),
    );
  });
});
