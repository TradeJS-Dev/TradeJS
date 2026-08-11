'use client';

import type { ReactNode } from 'react';
import { Box, Flex, SimpleGrid, Text } from '@chakra-ui/react';
import {
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
} from '#components/Shared/OrdersDrawer';
import type {
  DistributionBin,
  DrawdownPoint,
  HourlyPnlStat,
  RollingPerformancePoint,
  SessionPnlStat,
  StrategyTradePoint,
} from '#app/lib/strategyPerformance';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 120;
const CHART_PADDING = 10;
const POSITIVE_CHART_COLOR = '#5eead4';
const NEGATIVE_CHART_COLOR = '#f87171';
const NEUTRAL_CHART_COLOR = '#6b7280';

const getChartPnlColor = (value: number) =>
  value > 0
    ? POSITIVE_CHART_COLOR
    : value < 0
      ? NEGATIVE_CHART_COLOR
      : NEUTRAL_CHART_COLOR;

const buildPolylinePoints = (values: number[]) => {
  if (!values.length) {
    return '';
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const drawableWidth = CHART_WIDTH - CHART_PADDING * 2;
  const drawableHeight = CHART_HEIGHT - CHART_PADDING * 2;

  return values
    .map((value, index) => {
      const x =
        CHART_PADDING +
        (values.length === 1
          ? 0
          : (index / (values.length - 1)) * drawableWidth);
      const y = CHART_PADDING + ((max - value) / range) * drawableHeight;

      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

export const ChartPanel = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) => (
  <Box
    p={4}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
    minH="210px"
  >
    <Flex justify="space-between" align="baseline" gap={3} mb={3}>
      <Text fontSize="sm" color="gray.300" fontWeight="semibold">
        {title}
      </Text>
      {subtitle ? (
        <Text fontSize="xs" color="gray.500" textAlign="right">
          {subtitle}
        </Text>
      ) : null}
    </Flex>
    {children}
  </Box>
);

const EmptyChart = () => (
  <Flex h="140px" align="center" justify="center">
    <Text fontSize="sm" color="gray.500">
      No trade data
    </Text>
  </Flex>
);

export const DrawdownTimelineChart = ({
  points,
}: {
  points: DrawdownPoint[];
}) => {
  if (points.length < 2) {
    return <EmptyChart />;
  }

  const values = points.map((point) => -point.drawdownPercent);
  const maxDrawdown = Math.max(...points.map((point) => point.drawdownPercent));
  const linePoints = buildPolylinePoints(values);

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Drawdown timeline"
      >
        <line
          x1={CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y1={CHART_PADDING}
          y2={CHART_PADDING}
          stroke="#374151"
          strokeDasharray="4 4"
        />
        <polyline
          points={linePoints}
          fill="none"
          stroke={NEGATIVE_CHART_COLOR}
          strokeWidth="2"
        />
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          max drawdown
        </Text>
        <Text
          fontSize="sm"
          color="orange.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatPercent(maxDrawdown)}
        </Text>
      </Flex>
    </Box>
  );
};

export const WinLossStreakTimelineChart = ({
  trades,
}: {
  trades: StrategyTradePoint[];
}) => {
  if (!trades.length) {
    return <EmptyChart />;
  }

  const maxAbsPnl = Math.max(...trades.map((trade) => Math.abs(trade.pnl)), 1);
  const centerY = CHART_HEIGHT / 2;
  const barWidth = CHART_WIDTH / trades.length;

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Win loss streak timeline"
      >
        <line
          x1="0"
          x2={CHART_WIDTH}
          y1={centerY}
          y2={centerY}
          stroke="#374151"
        />
        {trades.map((trade, index) => {
          const height = Math.max(2, (Math.abs(trade.pnl) / maxAbsPnl) * 48);
          const isWin = trade.pnl > 0;
          const y = isWin ? centerY - height : centerY;

          return (
            <rect
              key={`${trade.timestamp}-${index}`}
              x={index * barWidth}
              y={y}
              width={Math.max(1, barWidth - 0.4)}
              height={height}
              fill={getChartPnlColor(trade.pnl)}
              opacity="0.9"
            />
          );
        })}
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          wins above line, losses below
        </Text>
        <Text
          fontSize="sm"
          color="gray.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatInteger(trades.length)} trades
        </Text>
      </Flex>
    </Box>
  );
};

export const PnlDistributionChart = ({ bins }: { bins: DistributionBin[] }) => {
  if (!bins.length) {
    return <EmptyChart />;
  }

  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const barWidth = CHART_WIDTH / bins.length;

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="P and L distribution"
      >
        {bins.map((bin, index) => {
          const height = Math.max(2, (bin.count / maxCount) * 92);
          const x = index * barWidth + 2;
          const y = CHART_HEIGHT - height - CHART_PADDING;
          const midpoint = (bin.min + bin.max) / 2;

          return (
            <rect
              key={bin.id}
              x={x}
              y={y}
              width={Math.max(2, barWidth - 4)}
              height={height}
              fill={getChartPnlColor(midpoint)}
            />
          );
        })}
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          trade P&L buckets
        </Text>
        <Text
          fontSize="sm"
          color="gray.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatInteger(bins.reduce((sum, bin) => sum + bin.count, 0))}
        </Text>
      </Flex>
    </Box>
  );
};

export const RollingPerformanceChart = ({
  points,
}: {
  points: RollingPerformancePoint[];
}) => {
  if (points.length < 2) {
    return <EmptyChart />;
  }

  const winRateLine = buildPolylinePoints(points.map((point) => point.winRate));
  const pnlLine = buildPolylinePoints(points.map((point) => point.pnl));
  const latest = points[points.length - 1];

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Rolling win rate and rolling P and L"
      >
        <line
          x1={CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke="#374151"
          strokeDasharray="4 4"
        />
        <polyline
          points={pnlLine}
          fill="none"
          stroke={POSITIVE_CHART_COLOR}
          strokeWidth="2"
        />
        <polyline
          points={winRateLine}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2"
          opacity="0.9"
        />
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          teal P&L, yellow win rate
        </Text>
        <Text
          fontSize="sm"
          color="gray.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatPercent(latest?.winRate)} /{' '}
          {formatSignedNumber(latest?.pnl ?? null)}
        </Text>
      </Flex>
    </Box>
  );
};

export const TimeOfDaySessionChart = ({
  sessions,
  hours,
}: {
  sessions: SessionPnlStat[];
  hours: HourlyPnlStat[];
}) => {
  if (!sessions.some((session) => session.orders > 0)) {
    return <EmptyChart />;
  }

  const maxSessionAbsPnl = Math.max(
    ...sessions.map((session) => Math.abs(session.pnl)),
    1,
  );
  const maxHourAbsPnl = Math.max(...hours.map((hour) => Math.abs(hour.pnl)), 1);

  return (
    <Flex direction="column" gap={4}>
      <SimpleGrid columns={3} gap={3}>
        {sessions.map((session) => {
          const width = Math.max(
            4,
            (Math.abs(session.pnl) / maxSessionAbsPnl) * 100,
          );

          return (
            <Box key={session.session}>
              <Flex justify="space-between" align="center" mb={1}>
                <Text fontSize="xs" color="gray.400" fontWeight="semibold">
                  {session.session}
                </Text>
                <Text
                  fontSize="xs"
                  color={getPnlColor(session.pnl)}
                  fontFamily="mono"
                  fontWeight="bold"
                >
                  {formatSignedNumber(session.pnl)}
                </Text>
              </Flex>
              <Box h="8px" bg="gray.800">
                <Box
                  h="full"
                  w={`${width}%`}
                  bg={getChartPnlColor(session.pnl)}
                />
              </Box>
              <Text mt={1} fontSize="xs" color="gray.500" fontFamily="mono">
                {formatInteger(session.orders)} orders
              </Text>
            </Box>
          );
        })}
      </SimpleGrid>

      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="P and L by UTC hour"
      >
        <line
          x1="0"
          x2={CHART_WIDTH}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke="#374151"
        />
        {hours.map((hour) => {
          const barWidth = CHART_WIDTH / 24;
          const height = Math.max(1, (Math.abs(hour.pnl) / maxHourAbsPnl) * 46);
          const isPositive = hour.pnl >= 0;
          const y = isPositive ? CHART_HEIGHT / 2 - height : CHART_HEIGHT / 2;

          return (
            <rect
              key={hour.hour}
              x={hour.hour * barWidth + 2}
              y={y}
              width={Math.max(2, barWidth - 4)}
              height={height}
              fill={getChartPnlColor(hour.pnl)}
              opacity={hour.orders > 0 ? 0.95 : 0.2}
            />
          );
        })}
      </svg>
      <Text fontSize="xs" color="gray.500">
        UTC hours, sessions: Asia 00-07, Europe 08-15, US 16-23
      </Text>
    </Flex>
  );
};
