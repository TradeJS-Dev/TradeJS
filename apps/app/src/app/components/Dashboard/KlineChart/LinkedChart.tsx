import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Flex, Input, NativeSelect, Text } from '@chakra-ui/react';
import { dispose, init, type Chart, type Crosshair } from 'klinecharts';
import type { Interval, Provider } from '@tradejs/types';
import { intervalToMs } from '@tradejs/core/data';
import { useData } from '#store';
import type { UIFilters } from '#app/types/ui';
import { intervals } from '#shared/Filters/Interval/intervals';
import { useChartHistory } from './chartHistory';
import { findCandleIndex } from './trades';
import { useResize } from './hooks/useResize';
import { darkTheme } from './styles';
import { ChartSkeleton } from './ChartSkeleton';

const paneId = 'candle_pane';

const synchronizeCrosshair = (source: Chart, target: Chart) => {
  const onCrosshair = (value?: unknown) => {
    const crosshair = value as Crosshair | undefined;
    if (typeof crosshair?.x !== 'number') return;
    const point = source.convertFromPixel([{ x: crosshair.x }]);
    const timestamp = Array.isArray(point) ? point[0]?.timestamp : undefined;
    if (timestamp === undefined) return;
    const candles = target.getDataList();
    const index = findCandleIndex(candles, timestamp);
    const exact = candles[index]?.timestamp === timestamp;
    const candle = candles[exact ? index : index - 1];
    if (!candle) return;
    const coordinates = target.convertToPixel({
      timestamp: candle.timestamp,
      value: candle.close,
    });
    if (
      !Array.isArray(coordinates) &&
      coordinates.x !== undefined &&
      coordinates.y !== undefined
    ) {
      target.executeAction('onCrosshairChange', { ...coordinates, paneId });
    }
  };
  const root = source.getDom();
  const onLeave = () =>
    target.executeAction('onCrosshairChange', {
      paneId: 'x_axis_pane',
      x: -100,
    });
  source.subscribeAction('onCrosshairChange', onCrosshair);
  root?.addEventListener('mouseleave', onLeave);
  return () => {
    source.unsubscribeAction('onCrosshairChange', onCrosshair);
    root?.removeEventListener('mouseleave', onLeave);
  };
};

export const useLinkedCharts = (
  primary: Chart | null,
  secondary: Chart | null,
) => {
  useEffect(() => {
    if (!primary || !secondary) return;
    let syncing = false;
    const align = (source: Chart, target: Chart) => {
      if (syncing) return;
      const candles = source.getDataList();
      const targetCandles = target.getDataList();
      if (!candles.length || !targetCandles.length) return;
      const { from, to } = source.getVisibleRange();
      const start = candles[Math.max(0, from)]?.timestamp;
      const end = candles[Math.min(candles.length - 1, to - 1)]?.timestamp;
      const width = target.getSize(paneId, 'main')?.width ?? 0;
      if (start === undefined || end === undefined || width <= 0) return;
      const startIndex = findCandleIndex(targetCandles, start);
      const first = Math.max(
        0,
        targetCandles[startIndex]?.timestamp === start
          ? startIndex
          : startIndex - 1,
      );
      const endIndex = findCandleIndex(targetCandles, end);
      const last = Math.max(
        0,
        targetCandles[endIndex]?.timestamp === end ? endIndex : endIndex - 1,
      );
      syncing = true;
      try {
        target.setBarSpace(
          Math.max(
            1,
            Math.min(50, width / (Math.max(1, last - first + 1) + 3)),
          ),
        );
        target.scrollToDataIndex(Math.min(targetCandles.length - 1, last + 1));
      } finally {
        syncing = false;
      }
    };
    const primaryMoved = () => align(primary, secondary);
    const secondaryMoved = () => align(secondary, primary);
    const unsubscribePrimary = synchronizeCrosshair(primary, secondary);
    const unsubscribeSecondary = synchronizeCrosshair(secondary, primary);
    const actions = ['onScroll', 'onZoom'] as const;
    for (const action of actions) {
      primary.subscribeAction(action, primaryMoved);
      secondary.subscribeAction(action, secondaryMoved);
    }
    primaryMoved();
    return () => {
      unsubscribePrimary();
      unsubscribeSecondary();
      for (const action of actions) {
        primary.unsubscribeAction(action, primaryMoved);
        secondary.unsubscribeAction(action, secondaryMoved);
      }
    };
  }, [primary, secondary]);
};

export const LinkedChart = ({
  id,
  primary,
  filters,
  live,
  replayEnd,
}: {
  id: string;
  primary: Chart | null;
  filters: UIFilters;
  live: boolean;
  replayEnd?: number;
}) => {
  const [chart, setChart] = useState<Chart | null>(null);
  const [interval, setInterval] = useState<Interval>(
    filters.interval === '60' ? '240' : '60',
  );
  const [provider, setProvider] = useState<Provider>(
    filters.provider ?? 'bybit',
  );
  const [symbol, setSymbol] = useState(filters.symbol);
  const [symbolInput, setSymbolInput] = useState(filters.symbol);
  const sameProvider = provider === (filters.provider ?? 'bybit');
  const { data, key, fulfilled, failed } = useData(
    {
      ...filters,
      provider,
      universe: sameProvider ? filters.universe : 'crypto',
      interval,
      symbol,
    },
    live,
  );
  const displayed = useMemo(
    () =>
      replayEnd === undefined
        ? data
        : data.filter(
            (candle) => candle.timestamp + intervalToMs(interval) <= replayEnd,
          ),
    [data, interval, replayEnd],
  );

  useEffect(() => {
    const next = init(id);
    if (!next) return;
    darkTheme(next);
    setChart(next);
    return () => dispose(next);
  }, [id]);

  const ready = useChartHistory({
    chart,
    data: displayed,
    fulfilled,
    historyKey: `${key}:${replayEnd !== undefined}`,
    symbol,
    interval,
    replay: replayEnd !== undefined,
  });
  useResize(chart, id);
  useLinkedCharts(primary, ready ? chart : null);

  return (
    <Box as="section" aria-label="Linked chart" minW={0}>
      <Flex
        as="form"
        gap={2}
        wrap="wrap"
        mb={2}
        onSubmit={(event) => {
          event.preventDefault();
          const next = symbolInput.trim().toUpperCase();
          if (next) setSymbol(next);
        }}
      >
        <Input
          aria-label="Linked symbol"
          size="sm"
          w="9rem"
          required
          value={symbolInput}
          onChange={(event) => setSymbolInput(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline">
          Apply symbol
        </Button>
        <NativeSelect.Root size="sm" w="auto">
          <NativeSelect.Field
            aria-label="Linked timeframe"
            value={interval}
            onChange={(event) => setInterval(event.target.value as Interval)}
          >
            <option value="1">1m</option>
            {intervals.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <NativeSelect.Root size="sm" w="auto">
          <NativeSelect.Field
            aria-label="Linked exchange"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
          >
            <option value="bybit">Bybit</option>
            <option value="binance">Binance</option>
            <option value="coinbase">Coinbase</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Flex>
      <Text fontSize="sm" color="gray.300" mb={2}>
        {symbol} · {provider}
        {failed
          ? ' · Could not load candles'
          : fulfilled && !displayed.length
            ? ' · No candles in this window'
            : ''}
      </Text>
      <Box position="relative" h={{ base: '20rem', lg: 'min(68vh, 52rem)' }}>
        <div id={id} role="img" aria-label={`Linked chart for ${symbol}`} />
        {!fulfilled && <ChartSkeleton />}
      </Box>
    </Box>
  );
};
