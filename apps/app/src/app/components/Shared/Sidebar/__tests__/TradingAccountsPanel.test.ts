import { getDeploymentProcessStatus } from '../TradingAccountsPanel';

const deployment = (heartbeat?: any) =>
  ({
    id: 'tradfi-live',
    label: 'TradFi Live',
    connectorName: 'bybit',
    provider: 'bybit',
    accountId: 'tradfi-main',
    universe: 'tradfi',
    interval: '15',
    enabled: true,
    strategies: [],
    heartbeat,
  }) as any;

describe('getDeploymentProcessStatus', () => {
  it('distinguishes not-started, running, stale and error deployments', () => {
    jest.spyOn(Date, 'now').mockReturnValue(2_000_000);

    expect(getDeploymentProcessStatus(deployment())).toBe('not started');
    expect(
      getDeploymentProcessStatus(
        deployment({ status: 'running', lastCycleAt: 1_500_000 }),
      ),
    ).toBe('running');
    expect(
      getDeploymentProcessStatus(
        deployment({ status: 'running', lastCycleAt: 100_000 }),
      ),
    ).toBe('stale');
    expect(
      getDeploymentProcessStatus(
        deployment({ status: 'error', lastCycleAt: 1_900_000 }),
      ),
    ).toBe('error');
  });
});
