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
import { useTest } from '../context';
import { getFormatted } from '@utils/stat';

export const TestChart = () => {
  const { test } = useTest();

  const chart = useChart({
    data: test.orderLog.map((item) => ({
      timestamp: format(item.timestamp, 'HH:mm.dd.MM.yyyy'),
      amount: item.amount,
    })),
    series: [{ name: 'amount', color: 'teal.solid' }],
  });

  if (!test || !test.stat) {
    return null;
  }

  const { formatted: maxAmount } = getFormatted(test.stat, 'maxAmount');
  const { formatted: minAmount } = getFormatted(test.stat, 'minAmount');

  return (
    <Box w="100%" minW="600px" h="250px">
      <ResponsiveContainer width="100%" height="100%">
        <Chart.Root maxH="sm" chart={chart}>
          <LineChart data={chart.data}>
            <CartesianGrid stroke={chart.color('border')} vertical={false} />
            <ReferenceLine
              stroke={chart.color('gray.600')}
              strokeDasharray="5 5"
              y={test.stat.maxAmount}
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
              y={test.stat.minAmount}
              label={{
                value: `Min: ${minAmount}`,
                offset: 10,
                fill: chart.color('gray.600'),
                position: 'bottom',
              }}
            />
            <XAxis dataKey="timestamp" />
            <YAxis />
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
