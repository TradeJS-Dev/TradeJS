import {
  resolveStrategyConfigIdentityByKey,
  resolveStrategyNameByConfigKey,
} from '../runtimeStrategyConfigs';

describe('runtimeStrategyConfigs', () => {
  it('parses named runtime config keys', () => {
    expect(
      resolveStrategyConfigIdentityByKey(
        'root',
        'users:root:strategies:TrendLine:conservative',
      ),
    ).toEqual({ strategyName: 'TrendLine', configId: 'conservative' });
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:config',
      ),
    ).toBe('TrendLine');
  });

  it('rejects foreign, malformed, and reserved keys', () => {
    expect(
      resolveStrategyConfigIdentityByKey(
        'other',
        'users:root:strategies:TrendLine:config',
      ),
    ).toBeNull();
    expect(
      resolveStrategyConfigIdentityByKey(
        'root',
        'users:root:strategies:TrendLine:results',
      ),
    ).toBeNull();
    expect(
      resolveStrategyConfigIdentityByKey(
        'root',
        'users:root:strategies:TrendLine',
      ),
    ).toBeNull();
  });
});
