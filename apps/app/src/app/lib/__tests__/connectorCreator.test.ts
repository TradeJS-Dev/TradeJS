const mockGetRegisteredConnectorCreatorByProvider = jest.fn();
const mockGetBuiltinConnectorCreatorByProvider = jest.fn();
const mockResolveTradingAccount = jest.fn();

jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetRegisteredConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/connectors', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetBuiltinConnectorCreatorByProvider(...args),
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
    expect(mockGetBuiltinConnectorCreatorByProvider).not.toHaveBeenCalled();
  });

  it('falls back to built-in connectors when project registry has no connector', async () => {
    const builtinCreator = jest.fn();
    mockGetRegisteredConnectorCreatorByProvider.mockResolvedValue(undefined);
    mockGetBuiltinConnectorCreatorByProvider
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(builtinCreator);

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
    expect(mockGetBuiltinConnectorCreatorByProvider).toHaveBeenNthCalledWith(
      1,
      'unknown-provider',
    );
    expect(mockGetBuiltinConnectorCreatorByProvider).toHaveBeenNthCalledWith(
      2,
      DEFAULT_CONNECTOR_PROVIDER,
    );
  });

  it('returns null when neither registry nor built-ins can resolve the provider', async () => {
    mockGetRegisteredConnectorCreatorByProvider.mockResolvedValue(undefined);
    mockGetBuiltinConnectorCreatorByProvider.mockReturnValue(null);

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
