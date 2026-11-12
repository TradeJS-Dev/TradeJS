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
import { useBacktest, useTestsCompare } from '#store';
import { useTestContext } from '../context';
import { getChartData } from './utils';
import { getFormatted } from '@tradejs/core/backtest';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import { TimeSeriesXAxis } from '#shared/Charts/TimeSeriesXAxis';
import {
  buildBacktestTradeOutcomePoints,
  TradeOutcomeMarkers,
} from '#shared/Charts/TradeOutcomeMarkers';

interface TestCardChartProps {
  height?: string | number;
}

export const TestCardChart = ({ height = '350px' }: TestCardChartProps) => {
  const { testResult } = useTestContext();
  const { test, stat } = testResult;
  const { compareList } = useTestsCompare();
  const { backtest } = useBacktest(test.name);

  const startTimestamp = test.options.start ?? testResult.orderLog[0]?.[0] ?? 0;
  const endTimestamp =
    test.options.end ?? testResult.orderLog.at(-1)?.[0] ?? startTimestamp;
  const chartData = useMemo(
    () =>
      getChartData({
        testResult,
        orders: backtest,
        compareList,
        startTimestamp,
        endTimestamp,
      }),
    [backtest, compareList, endTimestamp, startTimestamp, testResult],
  );

  const chart = useChart(chartData as any);
  const tradeOutcomePoints = useMemo(
    () => buildBacktestTradeOutcomePoints(backtest),
    [backtest],
  );

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
                type="stepAfter"
                isAnimationActive={false}
                dataKey={chart.key(item.name) as string}
                stroke={chart.color(item.color)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
            ))}
            <TradeOutcomeMarkers
              points={tradeOutcomePoints}
              positiveColor={chart.color('green.400')}
              negativeColor={chart.color('red.400')}
            />
          </LineChart>
        </Chart.Root>
      </ResponsiveContainer>
    </Box>
  );
};
