'use client';

import { useMemo } from 'react';
import { Box } from '@chakra-ui/react';
import { Chart, useChart } from '@chakra-ui/charts';
import {
  LineChart,
  CartesianGrid,
  Line,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useTestsCompare } from '#store';
import { useTestContext } from '../context';
import { TestCompareList } from '@tradejs/types';
import { mapOrderLogToChartData, getChartData } from './utils';
import { getFormatted, getTimeline } from '@tradejs/core/backtest';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import { TimeSeriesXAxis } from '#shared/Charts/TimeSeriesXAxis';

interface TestCardChartProps {
  height?: string | number;
}

export const TestCardChart = ({ height = '350px' }: TestCardChartProps) => {
  const { testResult } = useTestContext();
  const { test, stat } = testResult;
  const { compareList } = useTestsCompare();

  const chartData = useMemo(() => {
    if (!compareList.length) {
      return mapOrderLogToChartData(testResult);
    }

    const timeline = getTimeline(test.options.start, test.options.end);

    const testList: TestCompareList = [
      ...compareList.filter(
        ({ testResult }) => testResult.test.testId !== test.testId,
      ),
      {
        testResult,
        color: 'teal',
      },
    ];

    return getChartData(testList, timeline);
  }, [
    compareList,
    test.options.end,
    test.options.start,
    test.testId,
    testResult,
  ]);

  const chart = useChart(chartData as any);

  const { formatted: maxAmount } = getFormatted(stat, 'maxAmount');
  const { formatted: minAmount } = getFormatted(stat, 'minAmount');
  const startTimestamp = test.options.start ?? testResult.orderLog[0]?.[0] ?? 0;
  const endTimestamp =
    test.options.end ?? testResult.orderLog.at(-1)?.[0] ?? startTimestamp;

  return (
    <Box w="100%" minW="600px" h={height} pr={2}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart.Root maxH="md" chart={chart}>
          <LineChart data={chart.data}>
            <CartesianGrid stroke={chart.color('border')} vertical={false} />
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
    </Box>
  );
};
