import { resolveConnectorUniverse } from '../market';

describe('market universe contracts', () => {
  const cryptoOnly = {
    supportedUniverses: ['crypto'] as const,
    defaultUniverse: 'crypto' as const,
  };

  it('uses connector default only when universe is omitted', () => {
    expect(resolveConnectorUniverse(cryptoOnly)).toBe('crypto');
  });

  it('rejects an explicitly unsupported universe', () => {
    expect(() => resolveConnectorUniverse(cryptoOnly, 'tradfi')).toThrow(
      'Unsupported market universe: tradfi',
    );
  });
});
