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
import type {
  RuntimeStrategyAiGateChange,
  RuntimeStrategyMaxLossValueTimeline,
} from '#app/lib/runtimeStrategies';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import { TimeSeriesXAxis } from '#shared/Charts/TimeSeriesXAxis';

interface RuntimeStrategyChartProps {
  orderLog: SimpleOrderLogData;
  stat: TestStat;
  aiGateObservedFrom: number | null;
  aiGateChanges: RuntimeStrategyAiGateChange[];
  maxLossValueTimeline: RuntimeStrategyMaxLossValueTimeline;
  startTimestamp: number;
  endTimestamp: number;
  height?: string | number;
}

export const RuntimeStrategyChart = ({
  orderLog,
  stat,
  aiGateObservedFrom,
  aiGateChanges,
  maxLossValueTimeline,
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
  const gateChangeColor = chart.color('purple.400');
  const maxLossValueChangeColor = chart.color('orange.400');

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
        <Text color="gray.500">No runtime trades for the selected window.</Text>
      </Box>
    );
  }

  return (
    <Box w="100%" minW="600px" h={height} display="flex" flexDirection="column">
      {aiGateObservedFrom != null ? (
        <Flex
          minH="24px"
          px={2}
          gap={4}
          alignItems="center"
          overflowX="auto"
          flexShrink={0}
          whiteSpace="nowrap"
        >
          <Text
            flexShrink={0}
            fontSize="xs"
            color="gray.500"
            title="AI-gate changes before this first runtime observation are unavailable"
          >
            AI-gate history from{' '}
            {formatTimeSeriesTooltipTimestamp(aiGateObservedFrom)}
          </Text>
          {aiGateChanges.map((change, index) => (
            <Text
              key={`${change.timestamp}:${change.fingerprint}:legend`}
              flexShrink={0}
              fontSize="xs"
              color="gray.400"
              title={`${change.previousFingerprint} → ${change.fingerprint}`}
            >
              <Text as="span" color={gateChangeColor} fontWeight="semibold">
                G{index + 1}
              </Text>{' '}
              {formatTimeSeriesTooltipTimestamp(change.timestamp)} ·{' '}
              {change.fingerprint.slice(0, 7)}
            </Text>
          ))}
          {maxLossValueTimeline.observedFrom != null &&
          maxLossValueTimeline.initialValue != null ? (
            <Text
              flexShrink={0}
              fontSize="xs"
              color="gray.500"
              title="MAX_LOSS_VALUE changes before this first runtime observation are unavailable"
            >
              MAX_LOSS_VALUE history from{' '}
              {formatTimeSeriesTooltipTimestamp(
                maxLossValueTimeline.observedFrom,
              )}{' '}
              · initial {maxLossValueTimeline.initialValue}$
            </Text>
          ) : null}
          {maxLossValueTimeline.changes.map((change, index) => (
            <Text
              key={`${change.timestamp}:${change.value}:max-loss-legend`}
              flexShrink={0}
              fontSize="xs"
              color="gray.400"
            >
              <Text
                as="span"
                color={maxLossValueChangeColor}
                fontWeight="semibold"
              >
                L{index + 1}
              </Text>{' '}
              {formatTimeSeriesTooltipTimestamp(change.timestamp)} ·{' '}
              {change.previousValue}$ → {change.value}$
            </Text>
          ))}
        </Flex>
      ) : null}
      <Box flex="1" minH={0} pr={2}>
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
              {aiGateChanges.map((change, index) => (
                <ReferenceLine
                  key={`${change.timestamp}:${change.fingerprint}`}
                  x={change.timestamp}
                  stroke={gateChangeColor}
                  strokeDasharray="3 5"
                  strokeWidth={1.5}
                  label={{
                    value: `G${index + 1}`,
                    fill: gateChangeColor,
                    fontSize: 10,
                    fontWeight: 600,
                    offset: 6,
                    position:
                      index % 2 === 0 ? 'insideTopRight' : 'insideTopLeft',
                  }}
                />
              ))}
              {maxLossValueTimeline.changes.map((change, index) => (
                <ReferenceLine
                  key={`${change.timestamp}:${change.value}:max-loss`}
                  x={change.timestamp}
                  stroke={maxLossValueChangeColor}
                  strokeDasharray="7 4"
                  strokeWidth={1.5}
                  label={{
                    value: `L${index + 1}`,
                    fill: maxLossValueChangeColor,
                    fontSize: 10,
                    fontWeight: 600,
                    offset: 6,
                    position:
                      index % 2 === 0
                        ? 'insideBottomRight'
                        : 'insideBottomLeft',
                  }}
                />
              ))}
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
    </Box>
  );
};
