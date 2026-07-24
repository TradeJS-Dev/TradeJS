export interface ResolveTimeWindowParams {
  days?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  nowMs?: number;
  defaultStartMs: number;
  defaultEndMs?: number;
  closedIntervalMs?: number;
}

export interface ResolvedTimeWindow {
  start: number;
  end: number;
  source: 'default' | 'days' | 'explicit';
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const toEpochMs = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed < 1e12 ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
};

const toPositiveNumber = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

export const resolveTimeWindow = ({
  days,
  startTime,
  endTime,
  nowMs = Date.now(),
  defaultStartMs,
  defaultEndMs,
  closedIntervalMs,
}: ResolveTimeWindowParams): ResolvedTimeWindow => {
  const explicitStart = toEpochMs(startTime);
  const explicitEnd = toEpochMs(endTime);
  const resolvedDays = toPositiveNumber(days);

  const alignToLastClosedInterval = (
    window: ResolvedTimeWindow,
    preserveDuration: boolean,
  ): ResolvedTimeWindow => {
    if (
      typeof closedIntervalMs !== 'number' ||
      !Number.isFinite(closedIntervalMs) ||
      closedIntervalMs <= 0
    ) {
      return window;
    }

    const alignedEnd =
      Math.floor(window.end / closedIntervalMs) * closedIntervalMs - 1;
    const delta = window.end - alignedEnd;
    const alignedStart = preserveDuration ? window.start - delta : window.start;
    if (alignedStart >= alignedEnd) {
      throw new Error(
        `Invalid closed-candle window: start (${alignedStart}) must be less than end (${alignedEnd})`,
      );
    }

    return {
      ...window,
      start: Math.trunc(alignedStart),
      end: Math.trunc(alignedEnd),
    };
  };

  if (explicitStart != null || explicitEnd != null) {
    const resolvedStart =
      explicitStart ??
      (resolvedDays != null && explicitEnd != null
        ? explicitEnd - resolvedDays * ONE_DAY_MS
        : defaultStartMs);
    const resolvedEnd =
      explicitEnd ??
      (resolvedDays != null && explicitStart != null
        ? explicitStart + resolvedDays * ONE_DAY_MS
        : defaultEndMs ?? nowMs);

    if (resolvedStart >= resolvedEnd) {
      throw new Error(
        `Invalid time window: startTime (${resolvedStart}) must be less than endTime (${resolvedEnd})`,
      );
    }

    return alignToLastClosedInterval(
      {
        start: resolvedStart,
        end: resolvedEnd,
        source: 'explicit',
      },
      explicitStart == null && resolvedDays != null,
    );
  }

  if (resolvedDays != null) {
    const resolvedEnd = defaultEndMs ?? nowMs;
    const resolvedStart = resolvedEnd - resolvedDays * ONE_DAY_MS;

    if (resolvedStart >= resolvedEnd) {
      throw new Error(
        `Invalid time window: computed start (${resolvedStart}) must be less than end (${resolvedEnd})`,
      );
    }

    return alignToLastClosedInterval(
      {
        start: Math.trunc(resolvedStart),
        end: Math.trunc(resolvedEnd),
        source: 'days',
      },
      true,
    );
  }

  const resolvedEnd = defaultEndMs ?? nowMs;
  if (defaultStartMs >= resolvedEnd) {
    throw new Error(
      `Invalid default time window: start (${defaultStartMs}) must be less than end (${resolvedEnd})`,
    );
  }

  return alignToLastClosedInterval(
    {
      start: Math.trunc(defaultStartMs),
      end: Math.trunc(resolvedEnd),
      source: 'default',
    },
    true,
  );
};
