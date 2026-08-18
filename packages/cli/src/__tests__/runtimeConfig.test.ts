import {
  RUNTIME_CONFIG_ACTIONS,
  buildProvisionedRuntimeDeployment,
  isEquivalentRuntimeStrategyRelease,
  pointRuntimeDeploymentAtRelease,
  resolveProvisionConnectorName,
} from '../scripts/runtimeConfig';

describe('runtime-config canonical commands', () => {
  it('has no legacy migration or fallback actions', () => {
    expect(RUNTIME_CONFIG_ACTIONS).toEqual([
      'inspect',
      'verify',
      'provision',
      'rollout',
      'pause',
      'resume',
      'rollback',
    ]);
  });

  it('creates a paused release pointer without embedding strategy config', () => {
    const deployment = buildProvisionedRuntimeDeployment({
      deploymentId: 'doubletap-forward',
      label: 'DoubleTap forward',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-default',
      strategyName: 'DoubleTap',
      releaseVersion: 7,
    });

    expect(deployment).toEqual({
      id: 'doubletap-forward',
      label: 'DoubleTap forward',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-default',
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

  it('requires an explicit connector when provisioning', () => {
    expect(() => resolveProvisionConnectorName(undefined)).toThrow(
      '--connector is required',
    );
    expect(resolveProvisionConnectorName(' sandbox ')).toBe('sandbox');
  });
});

describe('runtime-config rollout', () => {
  it('does not allocate a release when config and package versions match', () => {
    expect(
      isEquivalentRuntimeStrategyRelease({
        release: {
          config: {
            UNIVERSE: 'crypto',
            INTERVAL: '15',
            LONG: { enable: true, minRiskRatio: 1.5 },
          },
          strategyPackage: '@tradejs/strategy-double-tap',
          strategyPackageVersion: '3.0.0',
          runtimePackageVersion: '3.1.2',
        },
        config: {
          LONG: { minRiskRatio: 1.5, enable: true },
          INTERVAL: '15',
          UNIVERSE: 'crypto',
        },
        strategyPackage: '@tradejs/strategy-double-tap',
        strategyPackageVersion: '3.0.0',
        runtimePackageVersion: '3.1.2',
      }),
    ).toBe(true);
  });

  it('switches only the selected strategy to a paused version pointer', () => {
    const deployment = pointRuntimeDeploymentAtRelease({
      deployment: {
        id: 'multi-forward',
        label: 'Multi forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'bybit-default',
        enabled: true,
        strategies: [
          {
            strategyName: 'DoubleTap',
            releaseVersion: 1,
            controlState: 'active',
          },
          {
            strategyName: 'Grid',
            releaseVersion: 4,
            controlState: 'active',
          },
        ],
      },
      strategyName: 'DoubleTap',
      releaseVersion: 2,
    });

    expect(deployment.strategies).toEqual([
      {
        strategyName: 'DoubleTap',
        releaseVersion: 2,
        controlState: 'entries_paused',
      },
      {
        strategyName: 'Grid',
        releaseVersion: 4,
        controlState: 'active',
      },
    ]);
  });
});
