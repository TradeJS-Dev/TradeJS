'use client';

import { useMemo } from 'react';
import { Box, Text } from '@chakra-ui/react';
import { Chart, useChart } from '@chakra-ui/charts';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import type { SimpleOrderLogData } from '@tradejs/types';

export const StrategySnapshotChart = ({
  orderLog,
  height = '350px',
  emptyText = 'No chart data for the selected run.',
}: {
  orderLog: SimpleOrderLogData;
  height?: string | number;
  emptyText?: string;
}) => {
  const chartData = useMemo(
    () => ({
      data: orderLog.map(([timestamp, amount]) => ({
        timestamp: format(timestamp, 'dd.MM'),
        equity: amount,
      })),
      series: [
        {
          name: 'equity',
          color: 'teal.solid',
        },
      ],
    }),
    [orderLog],
  );

  const chart = useChart(chartData as any);

  if (!orderLog.length) {
    return (
      <Box
        w="100%"
        minW="600px"
        h={height}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text color="gray.500">{emptyText}</Text>
      </Box>
    );
  }

  const values = orderLog.map(([, amount]) => amount);
  const minValue = Math.min(...values);

  return (
    <Box w="100%" minW="600px" h={height} pr={2}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart.Root maxH="md" chart={chart}>
          <LineChart data={chart.data}>
            <CartesianGrid stroke={chart.color('border')} vertical={false} />
            <XAxis dataKey="timestamp" />
            <YAxis
              tickCount={10}
              domain={[Math.min(minValue - 10, 0), 'auto']}
            />
            <Tooltip
              animationDuration={100}
              cursor={false}
              content={<Chart.Tooltip />}
            />
            {chart.series.map((item) => (
              <Line
                key={item.name as string}
                isAnimationActive={false}
                dataKey={chart.key(item.name) as string}
                stroke={chart.color(item.color)}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </Chart.Root>
      </ResponsiveContainer>
    </Box>
  );
};
