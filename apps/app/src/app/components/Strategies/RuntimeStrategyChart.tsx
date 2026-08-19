'use client';

import { useMemo } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Chart, useChart } from '@chakra-ui/charts';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from 'recharts';
import { getFormatted } from '@tradejs/core/backtest';
import type { SimpleOrderLogData, TestStat } from '@tradejs/types';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import { TimeSeriesXAxis } from '#shared/Charts/TimeSeriesXAxis';

interface RuntimeStrategyChartProps {
  orderLog: SimpleOrderLogData;
  stat: TestStat;
  startTimestamp: number;
  endTimestamp: number;
  height?: string | number;
}

export const RuntimeStrategyChart = ({
  orderLog,
  stat,
  startTimestamp,
  endTimestamp,
  height = '350px',
}: RuntimeStrategyChartProps) => {
  const chartData = useMemo(
    () => ({
      data: orderLog.map(([timestamp, amount]) => ({
        timestamp,
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
  const { formatted: maxAmount } = getFormatted(stat, 'maxAmount');
  const { formatted: minAmount } = getFormatted(stat, 'minAmount');
  return (
    <Box w="100%" minW="600px" h={height} display="flex" flexDirection="column">
      <Box flex="1" minH={0} pr={2}>
        {orderLog.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <Chart.Root maxH="md" chart={chart}>
              <LineChart data={chart.data}>
                <CartesianGrid
                  stroke={chart.color('border')}
                  vertical={false}
                />
                <ReferenceLine
                  stroke={chart.color('gray.600')}
                  strokeDasharray="5 5"
                  y={stat.maxAmount}
                  label={{
                    value: `Max: ${maxAmount}`,
                    offset: 10,
                    fill: chart.color('gray.600'),
                    position: 'top',
                  }}
                />
                <ReferenceLine
                  stroke={chart.color('gray.600')}
                  strokeDasharray="8 8"
                  y={100}
                />
                <ReferenceLine
                  stroke={chart.color('gray.600')}
                  strokeDasharray="5 5"
                  y={stat.minAmount}
                  label={{
                    value: `Min: ${minAmount}`,
                    offset: 10,
                    fill: chart.color('gray.600'),
                    position: 'bottom',
                  }}
                />
                <TimeSeriesXAxis
                  startTimestamp={startTimestamp}
                  endTimestamp={endTimestamp}
                />
                <YAxis tickCount={10} domain={[stat.minAmount - 10, 'auto']} />
                <Tooltip
                  animationDuration={100}
                  cursor={false}
                  content={
                    <Chart.Tooltip
                      labelFormatter={formatTimeSeriesTooltipTimestamp}
                    />
                  }
                />
                {chart.series.map((item) => (
                  <Line
                    key={item.name as string}
                    isAnimationActive={false}
                    dataKey={chart.key(item.name) as string}
                    stroke={chart.color(item.color)}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2 }}
                  />
                ))}
              </LineChart>
            </Chart.Root>
          </ResponsiveContainer>
        ) : (
          <Flex h="100%" align="center" justify="center">
            <Text color="gray.500">
              No runtime trades for the selected window.
            </Text>
          </Flex>
        )}
      </Box>
    </Box>
  );
};
