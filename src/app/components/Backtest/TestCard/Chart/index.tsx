'use client';

import { Box } from '@chakra-ui/react';
import { Chart, useChart } from '@chakra-ui/charts';
import { format } from 'date-fns';
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
import { useTestResult } from '../context';
import { OrderLogData } from '@types';
import { getFormatted } from '@utils/stat';

interface TestChartProps {
  onAddToCompare: (testId: string, orderLog: OrderLogData) => void;
  onRemoveFromCompare: () => void;
}

export const TestCardChart = () => {
  const { testResult } = useTestResult();

  const chart = useChart({
    data: testResult.orderLog.map((item) => ({
      timestamp: format(item.timestamp, 'dd.MM'),
      [testResult.test.testId]: item.amount,
    })),
    series: [{ name: testResult.test.testId, color: 'teal.solid' }],
  });

  const { formatted: maxAmount } = getFormatted(testResult.stat, 'maxAmount');
  const { formatted: minAmount } = getFormatted(testResult.stat, 'minAmount');

  return (
    <Box w="100%" minW="600px" h="450px" pr={2}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart.Root maxH="md" chart={chart}>
          <LineChart data={chart.data}>
            <CartesianGrid stroke={chart.color('border')} vertical={false} />
            <ReferenceLine
              stroke={chart.color('gray.600')}
              strokeDasharray="5 5"
              y={testResult.stat.maxAmount}
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
              y={testResult.stat.minAmount}
              label={{
                value: `Min: ${minAmount}`,
                offset: 10,
                fill: chart.color('gray.600'),
                position: 'bottom',
              }}
            />
            <XAxis dataKey="timestamp" />
            <YAxis
              tickCount={10}
              domain={[testResult.stat.minAmount - 10, 'auto']}
            />
            <Tooltip
              animationDuration={100}
              cursor={false}
              content={<Chart.Tooltip />}
            />

            {chart.series.map((item) => (
              <Line
                key={item.name}
                isAnimationActive={false}
                dataKey={chart.key(item.name)}
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
