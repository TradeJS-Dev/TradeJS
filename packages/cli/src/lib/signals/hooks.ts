import type {
  TradejsConfigAfterSignalsHook,
  TradejsConfigAfterSignalsHookContext,
  TradejsConfigBeforeSignalsHook,
  TradejsConfigBeforeSignalsHookResult,
  TradejsConfigHooks,
  TradejsConfigSignalsHookContext,
} from '@tradejs/core/config';

export const normalizeHookList = <THook extends (...args: any[]) => unknown>(
  value: THook | THook[] | undefined,
): THook[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
};

export const invokeBeforeSignalsHooks = async (
  hooks: TradejsConfigHooks | undefined,
  params: TradejsConfigSignalsHookContext,
): Promise<TradejsConfigBeforeSignalsHookResult | undefined> => {
  for (const hook of normalizeHookList(
    hooks?.beforeSignals,
  ) as TradejsConfigBeforeSignalsHook[]) {
    const result = await hook(params);
    if (result?.abort === true) {
      return result;
    }
  }

  return undefined;
};

export const invokeAfterSignalsHooks = async (
  hooks: TradejsConfigHooks | undefined,
  params: TradejsConfigAfterSignalsHookContext,
) => {
  for (const hook of normalizeHookList(
    hooks?.afterSignals,
  ) as TradejsConfigAfterSignalsHook[]) {
    await hook(params);
  }
};
