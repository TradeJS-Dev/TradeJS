import {
  getCurrentSignalsCycleDelay,
  getNextSignalsCycleDelay,
  getSignalsHeartbeatStatus,
  runSignalsDaemon,
} from '../lib/signals/daemon';

describe('signals daemon', () => {
  it('keeps deployment heartbeat running between daemon cycles', () => {
    expect(
      getSignalsHeartbeatStatus({
        cycleStatus: 'completed',
        continuous: true,
      }),
    ).toBe('running');
    expect(
      getSignalsHeartbeatStatus({
        cycleStatus: 'completed',
        continuous: false,
      }),
    ).toBe('stopped');
    expect(
      getSignalsHeartbeatStatus({
        cycleStatus: 'failed',
        continuous: true,
      }),
    ).toBe('error');
  });

  it('schedules the next cycle after the next candle boundary', () => {
    expect(
      getNextSignalsCycleDelay({
        now: 1_000,
        intervalMs: 1_000,
        settleDelayMs: 100,
      }),
    ).toBe(1_100);
  });

  it('waits for the current candle settle window on startup', async () => {
    const controller = new AbortController();
    let now = 1_001;
    const runCycle = jest.fn(async () => controller.abort());
    const wait = jest.fn(async (delayMs: number) => {
      now += delayMs;
    });

    expect(
      getCurrentSignalsCycleDelay({
        now,
        intervalMs: 1_000,
        settleDelayMs: 100,
      }),
    ).toBe(99);

    await runSignalsDaemon({
      runCycle,
      intervalMs: 1_000,
      settleDelayMs: 100,
      signal: controller.signal,
      onCycleError: jest.fn(),
      now: () => now,
      wait,
    });

    expect(wait).toHaveBeenCalledWith(99, controller.signal);
    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it('keeps the next deadline when a cycle crosses a candle boundary', async () => {
    const controller = new AbortController();
    let now = 900;
    const runCycle = jest.fn(async () => {
      if (runCycle.mock.calls.length === 1) {
        now = 1_050;
        return;
      }
      controller.abort();
    });
    const wait = jest.fn(async (delayMs: number) => {
      now += delayMs;
    });

    await runSignalsDaemon({
      runCycle,
      intervalMs: 1_000,
      settleDelayMs: 100,
      signal: controller.signal,
      onCycleError: jest.fn(),
      now: () => now,
      wait,
    });

    expect(wait).toHaveBeenCalledWith(50, controller.signal);
    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it('runs sequential cycles until aborted', async () => {
    const controller = new AbortController();
    const runCycle = jest.fn(async () => undefined);
    const wait = jest.fn(async () => {
      if (runCycle.mock.calls.length === 2) {
        controller.abort();
      }
    });

    await runSignalsDaemon({
      runCycle,
      intervalMs: 1_000,
      settleDelayMs: 100,
      signal: controller.signal,
      onCycleError: jest.fn(),
      now: () => 1_100,
      wait,
    });

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('reports a failed cycle and continues with the next one', async () => {
    const controller = new AbortController();
    const error = new Error('temporary failure');
    const runCycle = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(async () => {
        controller.abort();
      });
    const onCycleError = jest.fn();

    await runSignalsDaemon({
      runCycle,
      intervalMs: 1_000,
      settleDelayMs: 0,
      signal: controller.signal,
      onCycleError,
      now: () => 1_100,
      wait: jest.fn(async () => undefined),
    });

    expect(onCycleError).toHaveBeenCalledWith(error);
    expect(runCycle).toHaveBeenCalledTimes(2);
  });
});
