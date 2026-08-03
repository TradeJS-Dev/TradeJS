import { format } from 'date-fns';

const SHORT_TIME_RANGE_MS = 48 * 60 * 60 * 1000;

type TooltipPayloadEntry = {
  payload?: unknown;
};

const getValidDate = (value: unknown) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }

  let timestamp: number;
  try {
    timestamp = Number(value);
  } catch {
    return null;
  }

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const buildTimeSeriesTicks = (
  startTimestamp: number,
  endTimestamp: number,
  tickCount = 7,
) => {
  if (!getValidDate(startTimestamp) || !getValidDate(endTimestamp)) {
    return [];
  }

  const start = Math.min(startTimestamp, endTimestamp);
  const end = Math.max(startTimestamp, endTimestamp);
  if (start === end) {
    return [start];
  }

  const count = Math.max(2, Math.trunc(tickCount));
  const ticks = Array.from({ length: count }, (_, index) =>
    index === count - 1
      ? end
      : Math.round(start + ((end - start) * index) / (count - 1)),
  );

  return [...new Set(ticks)];
};

export const formatTimeSeriesAxisTimestamp = ({
  timestamp,
  startTimestamp,
  endTimestamp,
  includeTime,
}: {
  timestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  includeTime?: boolean;
}) => {
  const date = getValidDate(timestamp);
  if (!date) {
    return String(timestamp);
  }

  return format(
    date,
    includeTime ?? endTimestamp - startTimestamp <= SHORT_TIME_RANGE_MS
      ? 'dd.MM HH:mm'
      : 'dd.MM',
  );
};

export const formatTimeSeriesTooltipTimestamp = (
  value: unknown,
  payload: ReadonlyArray<TooltipPayloadEntry> = [],
) => {
  const payloadTimestamp = payload.reduce<unknown>((timestamp, item) => {
    if (timestamp !== undefined) {
      return timestamp;
    }

    const row = item.payload;
    return row && typeof row === 'object' && 'timestamp' in row
      ? row.timestamp
      : undefined;
  }, undefined);
  const date = getValidDate(value) ?? getValidDate(payloadTimestamp);

  return date ? format(date, 'dd.MM.yyyy HH:mm') : String(value ?? '');
};
