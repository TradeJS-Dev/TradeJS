import { buildBootstrapRuntimeDeployment } from '../scripts/runtimeConfig';

describe('runtime-config bootstrap', () => {
  it('creates a paused release pointer without embedding strategy config', () => {
    const deployment = buildBootstrapRuntimeDeployment({
      deploymentId: 'doubletap-forward',
      label: 'DoubleTap forward',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-default',
      strategyName: 'DoubleTap',
      releaseVersion: 7,
      config: {
        INTERVAL: '15',
        UNIVERSE: 'crypto',
        POLICY_PROFILE_ID: 'crypto',
      },
    });

    expect(deployment).toEqual({
      id: 'doubletap-forward',
      label: 'DoubleTap forward',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-default',
      universe: 'crypto',
      interval: '15',
      enabled: true,
      strategies: [
        {
          strategyName: 'DoubleTap',
          releaseVersion: 7,
          controlState: 'entries_paused',
        },
      ],
    });
    expect(deployment.strategies[0]).not.toHaveProperty('config');
  });
});
