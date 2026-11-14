import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Flex, Input, NativeSelect, Text } from '@chakra-ui/react';
import { FiCheck } from 'react-icons/fi';
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

export type LinkedMarket = Pick<UIFilters, 'symbol' | 'interval'> & {
  provider: Provider;
  universe: NonNullable<UIFilters['universe']>;
};

export const LinkedChart = ({
  id,
  primary,
  filters,
  market,
  onMarketChange,
  live,
  replayEnd,
}: {
  id: string;
  primary: Chart | null;
  filters: UIFilters;
  market: LinkedMarket;
  onMarketChange: (market: LinkedMarket) => void;
  live: boolean;
  replayEnd?: number;
}) => {
  const [chart, setChart] = useState<Chart | null>(null);
  const { interval, provider, symbol } = market;
  const [symbolInput, setSymbolInput] = useState(symbol);
  const { data, key, fulfilled, failed } = useData(
    {
      ...filters,
      ...market,
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
    <Box
      as="section"
      aria-label="Linked chart"
      minW={0}
      borderLeftWidth={{ xl: '1px' }}
      borderColor="border"
    >
      <Flex
        as="form"
        gap={1}
        wrap="wrap"
        px={2}
        py={1}
        borderBottomWidth="1px"
        borderColor="border"
        onSubmit={(event) => {
          event.preventDefault();
          const next = symbolInput.trim().toUpperCase();
          if (next) {
            setSymbolInput(next);
            onMarketChange({ ...market, symbol: next });
          }
        }}
      >
        <Input
          aria-label="Linked symbol"
          size="xs"
          w="7rem"
          required
          value={symbolInput}
          onChange={(event) => setSymbolInput(event.target.value)}
        />
        <Button
          type="submit"
          size="xs"
          variant="ghost"
          disabled={
            !symbolInput.trim() || symbolInput.trim().toUpperCase() === symbol
          }
          aria-label="Apply symbol"
          title="Apply symbol"
        >
          <FiCheck />
        </Button>
        <NativeSelect.Root size="xs" w="auto">
          <NativeSelect.Field
            aria-label="Linked timeframe"
            value={interval}
            onChange={(event) =>
              onMarketChange({
                ...market,
                interval: event.target.value as Interval,
              })
            }
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
        <NativeSelect.Root size="xs" w="auto">
          <NativeSelect.Field
            aria-label="Linked exchange"
            value={provider}
            onChange={(event) =>
              onMarketChange({
                ...market,
                provider: event.target.value as Provider,
                universe:
                  event.target.value === 'bybit' ? market.universe : 'crypto',
              })
            }
          >
            <option value="bybit">Bybit</option>
            <option value="binance">Binance</option>
            <option value="coinbase">Coinbase</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Flex>
      <Box
        position="relative"
        h={{ base: '25rem', lg: 'max(28rem, calc(100dvh - 112px))' }}
      >
        {(failed || (fulfilled && !displayed.length)) && (
          <Text
            role="status"
            position="absolute"
            left={3}
            bottom={3}
            zIndex={1}
            fontSize="xs"
            color="fg.muted"
          >
            {failed ? 'Could not load candles' : 'No candles in this window'}
          </Text>
        )}
        <div id={id} role="img" aria-label={`Linked chart for ${symbol}`} />
        {!fulfilled && <ChartSkeleton />}
      </Box>
    </Box>
  );
};
