import { defineConfig, normalizeTradejsConfigHooks } from '../config';

describe('defineConfig hooks', () => {
  it('merges project hooks without dropping earlier presets', () => {
    const beforePlaceOrderPreset = jest.fn(async () => {});
    const beforePlaceOrderProject = jest.fn(async () => {});
    const onBarProject = jest.fn(async () => {});
    const afterCoreDecisionProject = jest.fn(async () => {});
    const afterBarDecisionProject = jest.fn(async () => {});

    const config = defineConfig(
      {
        hooks: {
          beforePlaceOrder: beforePlaceOrderPreset,
        },
      },
      {
        hooks: {
          beforePlaceOrder: beforePlaceOrderProject,
          onBar: onBarProject,
          afterCoreDecision: afterCoreDecisionProject,
          afterBarDecision: afterBarDecisionProject,
        },
      },
    );

    expect(config.hooks).toEqual({
      beforePlaceOrder: [beforePlaceOrderPreset, beforePlaceOrderProject],
      onBar: [onBarProject],
      afterCoreDecision: [afterCoreDecisionProject],
      afterBarDecision: [afterBarDecisionProject],
    });
  });

  it('normalizes hook arrays by dropping non-functions and deduplicating references', () => {
    const beforePlaceOrder = jest.fn(async () => {});
    const onBar = jest.fn(async () => {});
    const afterCoreDecision = jest.fn(async () => {});
    const afterBarDecision = jest.fn(async () => {});

    const hooks = normalizeTradejsConfigHooks({
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
      beforePlaceOrder: [beforePlaceOrder],
      onBar: [onBar],
      afterCoreDecision: [afterCoreDecision],
      afterBarDecision: [afterBarDecision],
    });
  });
});
