export const getNextSignalsCycleDelay = ({
  now,
  intervalMs,
  settleDelayMs,
}: {
  now: number;
  intervalMs: number;
  settleDelayMs: number;
}) => {
  const nextBoundary = (Math.floor(now / intervalMs) + 1) * intervalMs;
  return Math.max(0, nextBoundary + settleDelayMs - now);
};

export const getCurrentSignalsCycleDelay = ({
  now,
  intervalMs,
  settleDelayMs,
}: {
  now: number;
  intervalMs: number;
  settleDelayMs: number;
}) => {
  const currentBoundary = Math.floor(now / intervalMs) * intervalMs;
  return Math.max(0, currentBoundary + settleDelayMs - now);
};

export const getSignalsHeartbeatStatus = ({
  cycleStatus,
  continuous,
}: {
  cycleStatus: 'completed' | 'failed';
  continuous: boolean;
}) => {
  if (cycleStatus === 'failed') return 'error' as const;
  return continuous ? ('running' as const) : ('stopped' as const);
};

const waitForNextCycle = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export const runSignalsDaemon = async ({
  runCycle,
  intervalMs,
  settleDelayMs,
  signal,
  onCycleError,
  now = Date.now,
  wait = waitForNextCycle,
}: {
  runCycle: () => Promise<void>;
  intervalMs: number;
  settleDelayMs: number;
  signal: AbortSignal;
  onCycleError: (error: unknown) => Promise<void> | void;
  now?: () => number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}) => {
  const initialDelay = getCurrentSignalsCycleDelay({
    now: now(),
    intervalMs,
    settleDelayMs,
  });
  if (initialDelay > 0) {
    await wait(initialDelay, signal);
  }

  while (!signal.aborted) {
    const cycleStartedAt = now();
    const nextCycleAt =
      cycleStartedAt +
      getNextSignalsCycleDelay({
        now: cycleStartedAt,
        intervalMs,
        settleDelayMs,
      });
    try {
      await runCycle();
    } catch (error) {
      await onCycleError(error);
    }

    if (signal.aborted) {
      break;
    }
    await wait(Math.max(0, nextCycleAt - now()), signal);
  }
};
