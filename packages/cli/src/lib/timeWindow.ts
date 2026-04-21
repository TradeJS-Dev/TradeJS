export interface ResolveTimeWindowParams {
  days?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  nowMs?: number;
  defaultStartMs: number;
  defaultEndMs?: number;
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
}: ResolveTimeWindowParams): ResolvedTimeWindow => {
  const explicitStart = toEpochMs(startTime);
  const explicitEnd = toEpochMs(endTime);

  if (explicitStart != null || explicitEnd != null) {
    const resolvedEnd = explicitEnd ?? defaultEndMs ?? nowMs;
    const resolvedStart = explicitStart ?? defaultStartMs;

    if (resolvedStart >= resolvedEnd) {
      throw new Error(
        `Invalid time window: startTime (${resolvedStart}) must be less than endTime (${resolvedEnd})`,
      );
    }

    return {
      start: resolvedStart,
      end: resolvedEnd,
      source: 'explicit',
    };
  }

  const resolvedDays = toPositiveNumber(days);
  if (resolvedDays != null) {
    const resolvedEnd = defaultEndMs ?? nowMs;
    const resolvedStart = resolvedEnd - resolvedDays * ONE_DAY_MS;

    if (resolvedStart >= resolvedEnd) {
      throw new Error(
        `Invalid time window: computed start (${resolvedStart}) must be less than end (${resolvedEnd})`,
      );
    }

    return {
      start: Math.trunc(resolvedStart),
      end: Math.trunc(resolvedEnd),
      source: 'days',
    };
  }

  const resolvedEnd = defaultEndMs ?? nowMs;
  if (defaultStartMs >= resolvedEnd) {
    throw new Error(
      `Invalid default time window: start (${defaultStartMs}) must be less than end (${resolvedEnd})`,
    );
  }

  return {
    start: Math.trunc(defaultStartMs),
    end: Math.trunc(resolvedEnd),
    source: 'default',
  };
};
