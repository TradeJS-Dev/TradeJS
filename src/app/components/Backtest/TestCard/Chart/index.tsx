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
import { OrderLogData, Test } from '@types';
import { TestCompareList } from '../types';
import { getFormatted } from '@utils/stat';

const inc = 6300_000;

const getTimeline = (test: Test) => {
  const { start, end } = test.options;
  const res = new Array<number>();

  for (let ind = start!; ind <= end; ind += inc) {
    res.push(ind);
  }

  return res;
};

const getAmountFromOrderLog = (
  ind: number,
  timeline: number[],
  orderLog: OrderLogData,
  fallback: number,
) => {
  if (ind < 1) {
    return fallback;
  }

  const order = orderLog.find(
    (log) =>
      log.timestamp <= timeline[ind] && log.timestamp > timeline[ind - 1],
  );

  if (!order) {
    return fallback;
  }

  return order.amount;
};

const getChartData = (testList: TestCompareList, timeline: number[]) => {
  const values: Record<string, number> = {};

  const data = timeline.map((timestamp, ind) => {
    const formattedTimestamp = format(timestamp, 'dd.MM');

    testList.forEach(({ testId, orderLog }) => {
      values[testId] = getAmountFromOrderLog(
        ind,
        timeline,
        orderLog,
        values[testId] || 100,
      );
    });

    return {
      ...values,
      timestamp: formattedTimestamp,
    };
  });

  const series = testList.map(({ testId, color }) => ({
    name: testId,
    color,
  }));

  return {
    data,
    series,
  };
};

export const TestCardChart = () => {
  const {
    testResult: { test, stat, orderLog },
    compareList,
  } = useTestResult();

  const timeline = getTimeline(test);

  const testList: TestCompareList = [
    ...compareList.filter((testCompare) => testCompare.testId !== test.testId),
    {
      testId: test.testId,
      orderLog,
      color: 'teal.solid',
    },
  ];

  const chart = useChart(getChartData(testList, timeline) as any);

  const { formatted: maxAmount } = getFormatted(stat, 'maxAmount');
  const { formatted: minAmount } = getFormatted(stat, 'minAmount');

  return (
    <Box w="100%" minW="600px" h="450px" pr={2}>
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
