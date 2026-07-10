import type {
  RuntimeStrategyCloseNotification,
  Strategy,
} from '@tradejs/types';
import {
  buildSignalsStrategyLifecycleKey,
  createSignalsStrategyLifecycle,
} from '../lib/signals/runtimeLifecycle';

const INTERVAL_MS = 15 * 60_000;
const makeLifecycle = (maxLiveBars = 100) =>
  createSignalsStrategyLifecycle({
    intervalMs: INTERVAL_MS,
    maxLiveBars,
  });

const makeParams = ({
  timestamp,
  config = { VALUE: 1 },
  create,
  run,
  onRuntimeClose = jest.fn(),
}: {
  timestamp: number;
  config?: Record<string, unknown>;
  create: jest.Mock;
  run: jest.Mock;
  onRuntimeClose?: jest.Mock;
}) => ({
  key: 'ByBit:ETHUSDT:15:TrendLine',
  timestamp,
  config,
  btcBinanceData: [{ timestamp, close: 100 }] as any,
  btcCoinbaseData: [{ timestamp, close: 101 }] as any,
  onRuntimeClose,
  create,
  run,
});

describe('signals strategy runtime lifecycle', () => {
  it('reuses one strategy instance for sequential candles', async () => {
    const lifecycle = makeLifecycle();
    const updateReferenceData = jest.fn();
    const strategy = Object.assign(jest.fn(), {
      __tradejsUpdateReferenceData: updateReferenceData,
    }) as unknown as Strategy;
    const create = jest.fn(async () => strategy);
    const run = jest.fn(async () => 'NO_SIGNAL');

    await expect(
      lifecycle.evaluate(makeParams({ timestamp: 1_000_000, create, run })),
    ).resolves.toMatchObject({ action: 'created', result: 'NO_SIGNAL' });
    await expect(
      lifecycle.evaluate(
        makeParams({ timestamp: 1_000_000 + INTERVAL_MS, create, run }),
      ),
    ).resolves.toMatchObject({ action: 'reused', result: 'NO_SIGNAL' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(updateReferenceData).toHaveBeenCalledWith({
      btcBinanceData: [{ timestamp: 1_000_000 + INTERVAL_MS, close: 100 }],
      btcCoinbaseData: [{ timestamp: 1_000_000 + INTERVAL_MS, close: 101 }],
    });
    expect(lifecycle.size()).toBe(1);
  });

  it('does not evaluate duplicate or stale candles', async () => {
    const lifecycle = makeLifecycle();
    const create = jest.fn(async () => jest.fn() as unknown as Strategy);
    const run = jest.fn(async () => 'NO_SIGNAL');

    await lifecycle.evaluate(makeParams({ timestamp: 2_000_000, create, run }));
    await expect(
      lifecycle.evaluate(makeParams({ timestamp: 2_000_000, create, run })),
    ).resolves.toEqual({ action: 'duplicate' });
    await expect(
      lifecycle.evaluate(makeParams({ timestamp: 1_000_000, create, run })),
    ).resolves.toEqual({ action: 'stale' });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['gap', { nextTimestamp: 1_000_000 + INTERVAL_MS * 2 }],
    [
      'config',
      { nextTimestamp: 1_000_000 + INTERVAL_MS, config: { VALUE: 2 } },
    ],
  ])('rebuilds from warmup after a %s', async (_name, next) => {
    const lifecycle = makeLifecycle();
    const create = jest.fn(async () => jest.fn() as unknown as Strategy);
    const run = jest.fn(async () => 'NO_SIGNAL');

    await lifecycle.evaluate(makeParams({ timestamp: 1_000_000, create, run }));
    const result = await lifecycle.evaluate(
      makeParams({
        timestamp: next.nextTimestamp,
        config: 'config' in next ? next.config : undefined,
        create,
        run,
      }),
    );

    expect(result.action).toBe(
      _name === 'gap' ? 'rebuilt_gap' : 'rebuilt_config',
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('periodically rebuilds to keep runtime history bounded', async () => {
    const lifecycle = makeLifecycle(1);
    const create = jest.fn(async () => jest.fn() as unknown as Strategy);
    const run = jest.fn(async () => 'NO_SIGNAL');

    await lifecycle.evaluate(makeParams({ timestamp: 1_000_000, create, run }));
    await expect(
      lifecycle.evaluate(
        makeParams({ timestamp: 1_000_000 + INTERVAL_MS, create, run }),
      ),
    ).resolves.toMatchObject({ action: 'rebuilt_limit' });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('routes runtime close events to the current cycle', async () => {
    const lifecycle = makeLifecycle();
    let emitRuntimeClose:
      | ((event: RuntimeStrategyCloseNotification) => void)
      | undefined;
    const create = jest.fn(async (params) => {
      emitRuntimeClose = params.onRuntimeClose;
      return jest.fn() as unknown as Strategy;
    });
    const firstSink = jest.fn();
    const secondSink = jest.fn();
    const run = jest.fn(async () => 'NO_SIGNAL');

    await lifecycle.evaluate(
      makeParams({
        timestamp: 1_000_000,
        create,
        run,
        onRuntimeClose: firstSink,
      }),
    );
    await lifecycle.evaluate(
      makeParams({
        timestamp: 1_000_000 + INTERVAL_MS,
        create,
        run,
        onRuntimeClose: secondSink,
      }),
    );
    emitRuntimeClose?.({ symbol: 'ETHUSDT' } as any);

    expect(firstSink).not.toHaveBeenCalled();
    expect(secondSink).toHaveBeenCalledTimes(1);
  });

  it('evicts failed and inactive strategy instances', async () => {
    const lifecycle = makeLifecycle();
    const create = jest.fn(async () => jest.fn() as unknown as Strategy);
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('broken'))
      .mockResolvedValue('NO_SIGNAL');

    await expect(
      lifecycle.evaluate(makeParams({ timestamp: 1_000_000, create, run })),
    ).rejects.toThrow('broken');
    expect(lifecycle.size()).toBe(0);

    await lifecycle.evaluate(
      makeParams({ timestamp: 1_000_000 + INTERVAL_MS, create, run }),
    );
    lifecycle.retain(new Set());

    expect(create).toHaveBeenCalledTimes(2);
    expect(lifecycle.size()).toBe(0);
  });

  it('builds stable keys for a strategy runtime instance', () => {
    expect(
      buildSignalsStrategyLifecycleKey({
        connectorName: 'ByBit',
        symbol: 'ETHUSDT',
        interval: '15',
        strategyName: 'TrendLine',
      }),
    ).toBe('ByBit:ETHUSDT:15:TrendLine');
  });
});
