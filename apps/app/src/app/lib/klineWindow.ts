import { intervalToMs } from '@tradejs/core/data';
import { Interval } from '@tradejs/types';

export const normalizeEndToIntervalBoundary = (
  end: number,
  interval: Interval,
): number => {
  const stepMs = intervalToMs(interval);
  if (!Number.isFinite(end) || stepMs <= 0) {
    return end;
  }

  return Math.floor(end / stepMs) * stepMs;
};

export const getCurrentIntervalBoundary = (interval: Interval) =>
  normalizeEndToIntervalBoundary(Date.now(), interval);
