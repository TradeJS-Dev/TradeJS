const mockGetRegisteredConnectorCreatorByProvider = jest.fn();
const mockResolveTradingAccount = jest.fn();

jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetRegisteredConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  resolveTradingAccount: (...args: unknown[]) =>
    mockResolveTradingAccount(...args),
}));

import {
  DEFAULT_CONNECTOR_PROVIDER,
  resolveConnectorAccountId,
  resolveConnectorCreatorByProvider,
} from '../connectorCreator';

describe('resolveConnectorCreatorByProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers registered connector creators from the project registry', async () => {
    const registeredCreator = jest.fn();
    mockGetRegisteredConnectorCreatorByProvider.mockResolvedValueOnce(
      registeredCreator,
    );

    const result = await resolveConnectorCreatorByProvider(
      'binance',
      '/tmp/project',
    );

    expect(result).toBe(registeredCreator);
    expect(mockGetRegisteredConnectorCreatorByProvider).toHaveBeenCalledWith(
      'binance',
      '/tmp/project',
    );
  });

  it('falls back to the default provider through the project registry', async () => {
    const builtinCreator = jest.fn();
    mockGetRegisteredConnectorCreatorByProvider
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(builtinCreator);

    const result = await resolveConnectorCreatorByProvider(
      'unknown-provider',
      '/tmp/project',
    );

    expect(result).toBe(builtinCreator);
    expect(mockGetRegisteredConnectorCreatorByProvider).toHaveBeenNthCalledWith(
      1,
      'unknown-provider',
      '/tmp/project',
    );
    expect(mockGetRegisteredConnectorCreatorByProvider).toHaveBeenNthCalledWith(
      2,
      DEFAULT_CONNECTOR_PROVIDER,
      '/tmp/project',
    );
  });

  it('returns null when the registry cannot resolve either provider', async () => {
    mockGetRegisteredConnectorCreatorByProvider.mockResolvedValue(undefined);

    await expect(
      resolveConnectorCreatorByProvider('unknown-provider', '/tmp/project'),
    ).resolves.toBeNull();
  });
});

describe('resolveConnectorAccountId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the effective default account id for connector scope', async () => {
    mockResolveTradingAccount.mockResolvedValue({
      id: 'bybit-default',
    });

    await expect(
      resolveConnectorAccountId({
        userName: 'root',
        provider: 'bybit',
        universe: 'crypto',
      }),
    ).resolves.toBe('bybit-default');
    expect(mockResolveTradingAccount).toHaveBeenCalledWith({
      userName: 'root',
      provider: 'bybit',
      universe: 'crypto',
    });
  });
});
