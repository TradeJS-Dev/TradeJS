'use client';

import { useMemo } from 'react';
import { XAxis } from 'recharts';
import {
  buildTimeSeriesTicks,
  formatTimeSeriesAxisTimestamp,
} from '#app/lib/timeSeriesChart';

export const TimeSeriesXAxis = ({
  startTimestamp,
  endTimestamp,
  tickCount = 7,
  minTickGap = 24,
  includeTime,
}: {
  startTimestamp: number;
  endTimestamp: number;
  tickCount?: number;
  minTickGap?: number;
  includeTime?: boolean;
}) => {
  const start = Math.min(startTimestamp, endTimestamp);
  const end = Math.max(startTimestamp, endTimestamp);
  const ticks = useMemo(
    () => buildTimeSeriesTicks(start, end, tickCount),
    [end, start, tickCount],
  );

  return (
    <XAxis
      dataKey="timestamp"
      type="number"
      scale="time"
      domain={[start, end]}
      ticks={ticks}
      tickFormatter={(timestamp) =>
        formatTimeSeriesAxisTimestamp({
          timestamp,
          startTimestamp: start,
          endTimestamp: end,
          includeTime,
        })
      }
      tickCount={tickCount}
      interval="preserveStartEnd"
      minTickGap={minTickGap}
      allowDataOverflow
    />
  );
};
