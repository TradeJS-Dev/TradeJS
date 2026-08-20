import { defineConfig, normalizeTradejsConfigHooks } from '../config';

describe('defineConfig hooks', () => {
  it('merges project hooks without dropping earlier presets', () => {
    const beforeSignalsPreset = jest.fn(async () => {});
    const beforeSignalsProject = jest.fn(async () => {});
    const afterSignalsProject = jest.fn(async () => {});
    const beforePlaceOrderPreset = jest.fn(async () => {});
    const beforePlaceOrderProject = jest.fn(async () => {});
    const onBarProject = jest.fn(async () => {});
    const afterCoreDecisionProject = jest.fn(async () => {});
    const afterBarDecisionProject = jest.fn(async () => {});

    const config = defineConfig(
      {
        hooks: {
          beforeSignals: beforeSignalsPreset,
          beforePlaceOrder: beforePlaceOrderPreset,
        },
      },
      {
        hooks: {
          beforeSignals: beforeSignalsProject,
          afterSignals: afterSignalsProject,
          beforePlaceOrder: beforePlaceOrderProject,
          onBar: onBarProject,
          afterCoreDecision: afterCoreDecisionProject,
          afterBarDecision: afterBarDecisionProject,
        },
      },
    );

    expect(config.hooks).toEqual({
      beforeSignals: [beforeSignalsPreset, beforeSignalsProject],
      afterSignals: [afterSignalsProject],
      beforePlaceOrder: [beforePlaceOrderPreset, beforePlaceOrderProject],
      onBar: [onBarProject],
      afterCoreDecision: [afterCoreDecisionProject],
      afterBarDecision: [afterBarDecisionProject],
    });
  });

  it('normalizes hook arrays by dropping non-functions and deduplicating references', () => {
    const beforeSignals = jest.fn(async () => {});
    const afterSignals = jest.fn(async () => {});
    const beforePlaceOrder = jest.fn(async () => {});
    const onBar = jest.fn(async () => {});
    const afterCoreDecision = jest.fn(async () => {});
    const afterBarDecision = jest.fn(async () => {});

    const hooks = normalizeTradejsConfigHooks({
      beforeSignals: [beforeSignals, undefined as any, beforeSignals] as any,
      afterSignals: [afterSignals, null as any, afterSignals] as any,
      beforePlaceOrder: [
        beforePlaceOrder,
        null as any,
        beforePlaceOrder,
      ] as any,
      onBar: [onBar, undefined as any, onBar] as any,
      afterCoreDecision: [
        undefined as any,
        afterCoreDecision,
        afterCoreDecision,
      ] as any,
      afterBarDecision: [
        undefined as any,
        afterBarDecision,
        afterBarDecision,
      ] as any,
    });

    expect(hooks).toEqual({
      beforeSignals: [beforeSignals],
      afterSignals: [afterSignals],
      beforePlaceOrder: [beforePlaceOrder],
      onBar: [onBar],
      afterCoreDecision: [afterCoreDecision],
      afterBarDecision: [afterBarDecision],
    });
  });
});

describe('defineConfig runtime declarations', () => {
  it('keeps one Git-owned deployment declaration without Redis release fields', () => {
    const runtime = {
      deployments: {
        production: {
          connectorName: 'bybit',
          accountId: 'bybit-default',
          strategies: {
            DoubleTap: {
              generation: 'forward-4',
              enabled: true,
              config: {
                INTERVAL: '15',
                UNIVERSE: 'crypto',
                MAX_LOSS_VALUE: 1,
              },
            },
          },
        },
      },
    };

    const config = defineConfig({ runtime } as any);

    expect(config.runtime).toEqual(runtime);
  });
});
