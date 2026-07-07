export const createTestStateController = () => {
  const stores = new Map<string, unknown>();
  const lastResults = new Map<string, { timestamp: number; result: unknown }>();

  return jest.fn((key: string, createState: () => unknown, options?: any) => {
    const stateKey = [key, options?.configKey ?? 'default'].join(':');
    if (!stores.has(stateKey)) {
      stores.set(stateKey, createState());
    }

    const snapshot = jest.fn(() =>
      typeof options?.snapshot === 'function'
        ? options.snapshot(stores.get(stateKey))
        : stores.get(stateKey),
    );

    const controller = {
      get: jest.fn(() => stores.get(stateKey)),
      set: jest.fn((nextState: unknown) => {
        stores.set(stateKey, nextState);
        lastResults.delete(stateKey);
        return nextState;
      }),
      update: jest.fn((updater: (state: unknown) => unknown) => {
        const nextState = updater(stores.get(stateKey));
        stores.set(stateKey, nextState);
        lastResults.delete(stateKey);
        return nextState;
      }),
      oncePerTimestamp: jest.fn(
        (timestamp: number, compute: (state: unknown) => unknown) => {
          const lastResult = lastResults.get(stateKey);
          if (lastResult?.timestamp === timestamp) {
            return lastResult.result;
          }
          if (lastResult && timestamp < lastResult.timestamp) {
            throw new Error('non-monotonic timestamp');
          }
          const result = compute(stores.get(stateKey));
          lastResults.set(stateKey, { timestamp, result });
          return result;
        },
      ),
      snapshot,
      hash: jest.fn(() => JSON.stringify(snapshot())),
    };

    return controller;
  });
};
