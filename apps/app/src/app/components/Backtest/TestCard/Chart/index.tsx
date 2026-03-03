'use client';

import { useMemo } from 'react';
import { Box } from '@chakra-ui/react';
import { Chart, useChart } from '@chakra-ui/charts';
import {
  LineChart,
  CartesianGrid,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useTestsCompare } from '@store';
import { useTestContext } from '../context';
import { TestCompareList } from '@types';
import { mapOrderLogToChartData, getChartData } from './utils';
import { getFormatted } from '@utils/stat';
import { getTimeline } from '@utils/timestamp';

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
  }, [compareList]);

  const chart = useChart(chartData as any);

  const { formatted: maxAmount } = getFormatted(stat, 'maxAmount');
  const { formatted: minAmount } = getFormatted(stat, 'minAmount');

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
            <XAxis dataKey="timestamp" />
            <YAxis tickCount={10} domain={[stat.minAmount - 10, 'auto']} />
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
