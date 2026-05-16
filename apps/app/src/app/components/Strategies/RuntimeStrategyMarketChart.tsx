'use client';

import { Box, Text } from '@chakra-ui/react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  RuntimeStrategyChartMarker,
  RuntimeStrategyPricePoint,
} from '@app/lib/runtimeStrategies';

const formatAxisTime = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('ru-RU', {
    month: 'short',
    day: 'numeric',
  });

const formatTooltipTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('ru-RU');

const formatPrice = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'n/a';
  }

  return number >= 100 ? number.toFixed(2) : number.toFixed(4);
};

const splitMarkers = (markers: RuntimeStrategyChartMarker[]) => ({
  longEntries: markers.filter(
    (marker) => marker.kind === 'entry' && marker.direction === 'LONG',
  ),
  shortEntries: markers.filter(
    (marker) => marker.kind === 'entry' && marker.direction === 'SHORT',
  ),
  exits: markers.filter((marker) => marker.kind === 'exit'),
});

export const RuntimeStrategyMarketChart = ({
  symbol,
  chart,
  markers,
}: {
  symbol: string | null;
  chart: RuntimeStrategyPricePoint[];
  markers: RuntimeStrategyChartMarker[];
}) => {
  if (!symbol || !chart.length) {
    return (
      <Box
        h="260px"
        borderRadius="16px"
        border="1px solid"
        borderColor="whiteAlpha.200"
        bg="blackAlpha.300"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text color="gray.400">Нет биржевых данных для графика</Text>
      </Box>
    );
  }

  const { longEntries, shortEntries, exits } = splitMarkers(markers);

  return (
    <Box h="260px" w="100%">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chart}
          margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatAxisTime}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
          />
          <YAxis
            dataKey="close"
            domain={['auto', 'auto']}
            tickFormatter={formatPrice}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            width={72}
          />
          <Tooltip
            labelFormatter={(value) => formatTooltipTime(Number(value))}
            formatter={(value: number, name: string) => [
              formatPrice(value),
              name === 'close' ? 'Price' : name === 'price' ? 'Trade' : name,
            ]}
            contentStyle={{
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '12px',
              color: '#e2e8f0',
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="close"
            name={`${symbol} close`}
            stroke="#7dd3fc"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Scatter
            name="Long entry"
            data={longEntries}
            dataKey="price"
            fill="#34d399"
            isAnimationActive={false}
          />
          <Scatter
            name="Short entry"
            data={shortEntries}
            dataKey="price"
            fill="#f97316"
            isAnimationActive={false}
          />
          <Scatter
            name="Exit"
            data={exits}
            dataKey="price"
            fill="#facc15"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
};
