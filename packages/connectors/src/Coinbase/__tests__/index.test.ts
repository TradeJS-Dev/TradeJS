import { CoinbaseConnectorCreator } from '..';
import { fetchWithRetry } from '../../shared/fetchWithRetry';

jest.mock('../../shared/fetchWithRetry', () => ({
  fetchWithRetry: jest.fn(),
}));

describe('CoinbaseConnectorCreator market universe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to crypto and preserves runtime scope metadata', async () => {
    const connector = await CoinbaseConnectorCreator({
      userName: 'root',
      accountId: 'coinbase-main',
      deploymentId: 'crypto-live',
    });

    expect(connector.universe).toBe('crypto');
    expect(connector.capabilities).toEqual({
      supportedUniverses: ['crypto'],
      defaultUniverse: 'crypto',
    });
    expect(connector.accountId).toBe('coinbase-main');
    expect(connector.deploymentId).toBe('crypto-live');
  });

  it('rejects explicit TradFi before making market-data requests', async () => {
    await expect(
      CoinbaseConnectorCreator({ userName: 'root', universe: 'tradfi' }),
    ).rejects.toThrow('Unsupported market universe: tradfi');
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });
});
