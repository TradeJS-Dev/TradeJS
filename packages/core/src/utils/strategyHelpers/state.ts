import type {
  StrategySharedReplayStateGetter,
  StrategyStateController,
  StrategyStateControllerOptions,
} from '@tradejs/types';

export interface LastTradeController {
  isInCooldown: (timestamp: number) => boolean;
  markTrade: (timestamp: number) => void;
  getLastTradeTimestamp: () => number | null;
}

export interface CreateLastTradeControllerParams {
  env?: string;
  enabled?: boolean;
  cooldownMs?: number;
}

export const createLastTradeController = ({
  env,
  enabled = env ? env === 'BACKTEST' : true,
  cooldownMs = 86_400_000,
}: CreateLastTradeControllerParams): LastTradeController => {
  let lastTradeTimestamp: number | null = null;

  return {
    isInCooldown: (timestamp: number) =>
      Boolean(
        enabled &&
          lastTradeTimestamp != null &&
          timestamp <= lastTradeTimestamp + cooldownMs,
      ),
    markTrade: (timestamp: number) => {
      if (!enabled) return;
      lastTradeTimestamp = timestamp;
    },
    getLastTradeTimestamp: () => lastTradeTimestamp,
  };
};

type StrategyStateControllerStore<TState, TResult> = {
  state: TState;
  lastTimestamp: number | null;
  lastResult: TResult | undefined;
  hasLastResult: boolean;
};

export interface CreateStrategyStateControllerFactoryParams {
  env: string;
  sharedReplayKey?: string;
  getSharedReplayState?: StrategySharedReplayStateGetter;
}

const stableStringify = (
  value: unknown,
  seen = new WeakSet<object>(),
): string => {
  if (value == null) {
    return String(value);
  }

  const valueType = typeof value;
  if (valueType === 'number') {
    return Number.isFinite(value)
      ? String(value)
      : JSON.stringify(String(value));
  }
  if (valueType === 'string') {
    return JSON.stringify(value);
  }
  if (valueType === 'boolean') {
    return String(value);
  }
  if (valueType === 'bigint') {
    return JSON.stringify(`${String(value)}n`);
  }
  if (valueType === 'undefined' || valueType === 'function') {
    return JSON.stringify(`[${valueType}]`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (valueType === 'object') {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) {
      return JSON.stringify('[Circular]');
    }
    seen.add(record);
    const serialized = `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`,
      )
      .join(',')}}`;
    seen.delete(record);
    return serialized;
  }

  return JSON.stringify(String(value));
};

const hashStableValue = (value: unknown) => {
  const serialized = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const canUseSharedStrategyState = ({
  env,
  sharedReplayKey,
  getSharedReplayState,
  sharedReplay,
}: {
  env: string;
  sharedReplayKey?: string;
  getSharedReplayState?: StrategySharedReplayStateGetter;
  sharedReplay: boolean;
}) =>
  sharedReplay &&
  (env === 'BACKTEST' || env === 'PARITY') &&
  Boolean(sharedReplayKey && getSharedReplayState);

export const createStrategyStateControllerFactory = ({
  env,
  sharedReplayKey,
  getSharedReplayState,
}: CreateStrategyStateControllerFactoryParams) => {
  const localStores = new Map<
    string,
    StrategyStateControllerStore<unknown, unknown>
  >();

  return <TState, TResult = unknown, TSnapshot = TState>(
    key: string,
    createState: () => TState,
    options: StrategyStateControllerOptions<TState, TSnapshot> = {},
  ): StrategyStateController<TState, TResult, TSnapshot> => {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) {
      throw new Error('strategyApi.createStateController requires a state key');
    }

    const configKey =
      typeof options.configKey === 'string' && options.configKey.trim()
        ? options.configKey.trim()
        : null;
    const controllerKey = configKey
      ? `${normalizedKey}:${configKey}`
      : normalizedKey;
    const createStore = (): StrategyStateControllerStore<TState, TResult> => ({
      state: createState(),
      lastTimestamp: null,
      lastResult: undefined,
      hasLastResult: false,
    });
    const sharedAllowed = canUseSharedStrategyState({
      env,
      sharedReplayKey,
      getSharedReplayState,
      sharedReplay: options.sharedReplay !== false,
    });
    const store = sharedAllowed
      ? getSharedReplayState!(
          `${sharedReplayKey}:state:${controllerKey}`,
          createStore,
        )
      : (() => {
          const existing = localStores.get(controllerKey);
          if (existing) {
            return existing as StrategyStateControllerStore<TState, TResult>;
          }
          const created = createStore();
          localStores.set(
            controllerKey,
            created as StrategyStateControllerStore<unknown, unknown>,
          );
          return created;
        })();
    const snapshot = (): TSnapshot =>
      options.snapshot
        ? options.snapshot(store.state)
        : (store.state as unknown as TSnapshot);
    const clearCachedResult = () => {
      store.lastResult = undefined;
      store.hasLastResult = false;
    };

    return {
      get: () => store.state,
      set: (state) => {
        store.state = state;
        clearCachedResult();
      },
      update: (fn) => {
        fn(store.state);
        clearCachedResult();
        return store.state;
      },
      oncePerTimestamp: (timestamp, compute) => {
        if (!Number.isFinite(timestamp)) {
          throw new Error(
            `Strategy state controller "${controllerKey}" received non-finite timestamp ${String(timestamp)}`,
          );
        }

        if (store.lastTimestamp === timestamp && store.hasLastResult) {
          return store.lastResult as TResult;
        }

        if (
          options.monotonic !== false &&
          store.lastTimestamp != null &&
          timestamp < store.lastTimestamp
        ) {
          throw new Error(
            `Strategy state controller "${controllerKey}" received non-monotonic timestamp ${timestamp} after ${store.lastTimestamp}`,
          );
        }

        const result = compute(store.state);
        store.lastTimestamp = timestamp;
        store.lastResult = result;
        store.hasLastResult = true;
        return result;
      },
      snapshot,
      hash: () => {
        const currentSnapshot = snapshot();
        return options.hash
          ? options.hash(currentSnapshot as TSnapshot)
          : hashStableValue(currentSnapshot);
      },
    };
  };
};
