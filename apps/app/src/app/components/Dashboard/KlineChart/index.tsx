'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Box,
  Button,
  Flex,
  Grid,
  Input,
  Popover,
  Portal,
  Separator,
  chakra,
  NativeSelect,
  Text,
} from '@chakra-ui/react';
import {
  FiChevronLeft,
  FiChevronRight,
  FiColumns,
  FiRewind,
  FiSquare,
} from 'react-icons/fi';
import { init, dispose, type Chart } from 'klinecharts';
import { intervalToMs } from '@tradejs/core/data';
import { toMs } from '@tradejs/core/time';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import type { Items, UIFilters } from '#app/types/ui';
import { ChartDrawings } from './ChartDrawings';
import { LinkedChart, type LinkedMarket } from './LinkedChart';
import { TradeReview, type TradeSelection } from './TradeReview';
import {
  compareTradeEntries,
  findCandleIndex,
  getChartTrades,
  type BacktestRun,
} from './trades';
import { startChartReplay, stepChartReplay, type ChartReplay } from './replay';
import { useChartHistory } from './chartHistory';
import { ChartSkeleton } from './ChartSkeleton';
import type { Indicator, OrderLogData } from '@tradejs/types';
import {
  useBbIndicator,
  useAtrIndicator,
  useMaIndicator,
  useEmaIndicator,
  useWmaIndicator,
  useVolIndicator,
  useBtcIndicator,
  useBtcCorrelation,
  useSpreadIndicator,
  useDashboardSignal,
  useSignalFigures,
  useBacktest,
  useSupportResistanceLines,
  useResize,
  useTradeSetup,
} from './hooks';
import { usePluginIndicators } from './hooks/usePluginIndicators';
import {
  type IndicatorRendererConfig,
  useBacktest as useBacktestStore,
  useData,
} from '#store';
import { darkTheme } from './styles';

interface KlineChartProps {
  id: string;
  filters: UIFilters;
  indicators: Record<string, Indicator>;
  indicatorRenderers: Record<string, IndicatorRendererConfig>;
  live?: boolean;
  interactive?: boolean;
  backtestFiles?: Items;
  toolbar?: ReactNode;
  linkedMarket?: LinkedMarket;
  onLinkedMarketChange?: (market: LinkedMarket) => void;
  onToggleLinked?: () => void;
}

const emptyOrders: OrderLogData = [];

export const KlineChart = ({
  id,
  filters,
  indicators,
  indicatorRenderers,
  live = true,
  interactive = false,
  backtestFiles = [],
  toolbar,
  linkedMarket,
  onLinkedMarketChange,
  onToggleLinked,
}: KlineChartProps) => {
  const [chart, setChart] = useState<Chart | null>(null);
  const [replay, setReplay] = useState<ChartReplay | null>(null);
  const [comparison, setComparison] = useState('');
  const [replayError, setReplayError] = useState(false);
  const [selected, setSelected] = useState<TradeSelection | null>(null);
  const [highlight, setHighlight] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const primary = useBacktestStore(
    filters.backtestId || undefined,
    filters.backtestStrategy || undefined,
  );
  const comparisonId =
    filters.backtestId && filters.backtestId !== comparison ? comparison : '';
  const secondary = useBacktestStore(comparisonId || undefined);
  const marketFilters = useMemo(() => {
    // Include saved trades outside the standard dashboard history window.
    let start = filters.start;
    let end = filters.end;
    const interval = intervalToMs(filters.interval);
    for (const orders of [primary.backtest, secondary.backtest]) {
      for (const order of orders) {
        if (!Number.isFinite(order.timestamp)) continue;
        start = Math.min(start, order.timestamp - 50 * interval);
        end = Math.max(end, order.timestamp + interval);
      }
    }
    return { ...filters, start, end };
  }, [filters, primary.backtest, secondary.backtest]);
  const {
    data: history,
    key,
    fulfilled,
    failed,
  } = useData(marketFilters, live && !replay);
  const data = useMemo(
    () => (replay ? replay.candles.slice(0, replay.index + 1) : history),
    [history, replay],
  );
  const cutoff = replay ? data.at(-1)?.timestamp : undefined;
  const filterOrders = useCallback(
    (orders: OrderLogData) =>
      cutoff === undefined
        ? orders
        : orders.filter((order) => order.timestamp <= cutoff),
    [cutoff],
  );
  const primaryOrders = useMemo(
    () => filterOrders(primary.backtest),
    [filterOrders, primary.backtest],
  );
  const secondaryOrders = useMemo(
    () => filterOrders(secondary.backtest),
    [filterOrders, secondary.backtest],
  );
  const primaryTrades = useMemo(
    () => getChartTrades(primaryOrders),
    [primaryOrders],
  );
  const secondaryTrades = useMemo(
    () => getChartTrades(secondaryOrders),
    [secondaryOrders],
  );
  const comparing = Boolean(comparisonId);
  const comparisonReady = comparing && !secondary.loading;
  const rows = useMemo(() => {
    const differences = comparisonReady
      ? compareTradeEntries(primaryTrades, secondaryTrades)
      : undefined;
    return (['A', 'B'] as const)
      .flatMap((run) =>
        (run === 'A' ? primaryTrades : secondaryTrades).map((trade) => ({
          run,
          id: trade.id,
          trade,
          difference: differences?.[run].get(trade.id),
        })),
      )
      .sort((a, b) => a.trade.entry.timestamp - b.trade.entry.timestamp);
  }, [comparisonReady, primaryTrades, secondaryTrades]);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');
  const autoZoom = searchParams.get('autoZoom') === 'true';
  const dashboardSignal = useDashboardSignal({
    symbol: filters.symbol,
    signalId,
  });

  useEffect(() => {
    const next = init(id);
    if (!next) return;
    setChart(next);
    darkTheme(next);
    return () => dispose(next);
  }, [id]);

  const historyReady = useChartHistory({
    chart,
    data,
    fulfilled: fulfilled || replay !== null,
    historyKey: `${key}:${marketFilters.start}:${marketFilters.end}:${replay !== null}`,
    symbol: filters.symbol,
    interval: filters.interval,
    replay: replay !== null,
  });

  const selectTrade = useCallback(
    (selection: TradeSelection) => {
      const row = rows.find(
        ({ run, id }) => run === selection.run && id === selection.id,
      );
      if (!row) return;
      setSelected(selection);
      setHighlight({
        from: row.trade.entry.timestamp,
        to: row.trade.lastExit?.timestamp ?? row.trade.entry.timestamp,
      });
    },
    [rows],
  );

  const selectOrder = useCallback(
    (run: BacktestRun, index: number) => {
      const row = rows.find(
        (row) =>
          row.run === run &&
          row.trade.events.some((event) => event.index === index),
      );
      if (row) selectTrade(row);
    },
    [rows, selectTrade],
  );

  useEffect(() => {
    if (!chart || !historyReady || !highlight) return;
    const data = chart.getDataList();
    if (!data.length) return;
    const first = findCandleIndex(data, highlight.from);
    const last = Math.min(data.length - 1, findCandleIndex(data, highlight.to));
    if (first >= data.length || highlight.to < data[0].timestamp) return;
    const fit = () => {
      const width = chart.getSize('candle_pane', 'main')?.width ?? 0;
      if (width > 0) {
        chart.setBarSpace(
          Math.min(50, Math.max(1, width / (last - first + 17))),
        );
      }
      chart.scrollToDataIndex(Math.min(data.length - 1, last + 7));
    };
    fit();
    const pane = chart.getDom('candle_pane', 'main');
    if (!pane) return;
    let width = pane.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== pane.clientWidth) {
        width = pane.clientWidth;
        fit();
      }
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [chart, historyReady, highlight]);

  const startReplay = (date: string) => {
    const row = rows.find(
      ({ run, id }) => run === selected?.run && id === selected?.id,
    );
    const signalTime =
      row?.trade.entry.timestamp ?? dashboardSignal.signal?.timestamp;
    const beforeSignal =
      signalTime === undefined
        ? Math.max(0, data.length - 51)
        : Math.max(0, findCandleIndex(data, toMs(signalTime)) - 5);
    const timestamp = date
      ? new Date(date).getTime()
      : data[beforeSignal]?.timestamp;
    const nextReplay =
      timestamp === undefined ? null : startChartReplay(data, timestamp);
    if (!nextReplay) {
      setReplayError(true);
      return;
    }
    setReplayError(false);
    setSelected(null);
    setHighlight(null);
    setReplay(nextReplay);
  };

  useResize(chart, id);
  useAtrIndicator(chart, indicators.atr.enabled, indicators.atr.periods || []);
  useBbIndicator(chart, indicators.bb.enabled, indicators.bb.periods || []);
  useMaIndicator(chart, indicators.ma.enabled, indicators.ma.periods || []);
  useEmaIndicator(chart, indicators.ema.enabled, indicators.ema.periods || []);
  useWmaIndicator(chart, indicators.wma.enabled, indicators.wma.periods || []);
  useVolIndicator(chart, indicators.vol.enabled);
  useBtcIndicator(chart, indicators.btc.enabled, filters);
  useBtcCorrelation(
    chart,
    indicators.btcCorrelation?.enabled && filters.universe !== 'tradfi',
    filters,
  );
  useSpreadIndicator(
    chart,
    indicators.spread?.enabled && filters.universe !== 'tradfi',
    filters,
  );
  useBacktest(
    historyReady ? chart : null,
    data,
    primaryOrders,
    'A',
    comparing,
    interactive ? selectOrder : undefined,
  );
  useBacktest(
    historyReady ? chart : null,
    data,
    comparing ? secondaryOrders : emptyOrders,
    'B',
    comparing,
    interactive ? selectOrder : undefined,
  );
  useSupportResistanceLines(chart, indicators.resistant?.enabled);
  const signalReady =
    dashboardSignal.status === 'loaded' &&
    dashboardSignal.signal != null &&
    (cutoff === undefined || toMs(dashboardSignal.signal.timestamp) <= cutoff);
  const signalFiguresReady = useSignalFigures({
    chart,
    lastDataTimestamp: data.at(-1)?.timestamp ?? null,
    enabled: historyReady && signalReady,
    signal: dashboardSignal.signal,
    autoZoom: autoZoom && !replay,
  });
  const tradeSetupReady = useTradeSetup({
    chart,
    enabled: historyReady && signalReady,
    signal: dashboardSignal.signal,
  });
  usePluginIndicators(chart, indicators, indicatorRenderers, data);

  const screenshotReady = signalId
    ? historyReady && signalReady && signalFiguresReady && tradeSetupReady
    : historyReady;

  const chartContents = (
    <>
      <div
        id={id}
        role="img"
        aria-label={`${filters.symbol} price chart`}
        data-testid="market-chart"
        data-chart-ready={historyReady ? 'true' : 'false'}
        data-signal-status={dashboardSignal.status}
        data-screenshot-ready={screenshotReady ? 'true' : 'false'}
      />
      {!fulfilled && !replay && <ChartSkeleton />}
      {fulfilled && !data.length && (
        <Text pos="absolute" top={4} left={4}>
          {failed ? 'Could not load candles' : 'No candles in this window'}
        </Text>
      )}
    </>
  );

  if (!interactive) return chartContents;

  return (
    <Flex direction="column" w="full" minW={0}>
      <Flex
        as="header"
        aria-label="Chart controls"
        gap={1}
        px={2}
        py={1}
        wrap="wrap"
        align="center"
        borderBottomWidth="1px"
        borderColor="border"
      >
        {toolbar}
        {toolbar && <Separator orientation="vertical" h={5} mx={1} />}
        {replay ? (
          <>
            <Button
              size="xs"
              variant="ghost"
              aria-label="Previous candle"
              title="Previous candle"
              disabled={replay.index === 0}
              onClick={() => setReplay(stepChartReplay(replay, -1))}
            >
              <FiChevronLeft />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-label="Next candle"
              title="Next candle"
              disabled={replay.index + 1 === replay.candles.length}
              onClick={() => setReplay(stepChartReplay(replay, 1))}
            >
              <FiChevronRight />
            </Button>
            <Button
              size="xs"
              variant="subtle"
              colorPalette="teal"
              aria-label="End replay"
              title="End replay"
              onClick={() => {
                setReplay(null);
                setSelected(null);
                setHighlight(null);
              }}
            >
              <FiSquare />
            </Button>
            <Text
              fontSize="xs"
              color="fg.muted"
              role="status"
              fontVariantNumeric="tabular-nums"
              px={1}
            >
              {formatTimeSeriesTooltipTimestamp(cutoff)} · {replay.index + 1} /{' '}
              {replay.candles.length}
            </Text>
          </>
        ) : (
          <Popover.Root positioning={{ placement: 'bottom-start' }}>
            <Popover.Trigger asChild>
              <Button size="xs" variant="ghost">
                <FiRewind /> Replay
              </Button>
            </Popover.Trigger>
            <Portal>
              <Popover.Positioner>
                <Popover.Content w="min(18rem, calc(100vw - 1rem))">
                  <Popover.Body>
                    <chakra.form
                      display="flex"
                      flexDirection="column"
                      gap={2}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const date = new FormData(event.currentTarget).get(
                          'date',
                        );
                        startReplay(typeof date === 'string' ? date : '');
                      }}
                    >
                      <Popover.Title asChild>
                        <label htmlFor={`${id}-replay-start`}>
                          Replay start
                        </label>
                      </Popover.Title>
                      <Input
                        id={`${id}-replay-start`}
                        name="date"
                        aria-label="Replay start date and time"
                        type="datetime-local"
                        size="sm"
                        aria-invalid={replayError || undefined}
                        aria-describedby={`${id}-replay-help`}
                        onChange={() => setReplayError(false)}
                      />
                      <Text
                        id={`${id}-replay-help`}
                        fontSize="xs"
                        color="fg.muted"
                      >
                        {historyReady
                          ? 'Leave blank for the suggested candle. Dates use your local time.'
                          : 'Replay is available when candles are loaded.'}
                      </Text>
                      {replayError && (
                        <Text role="alert" color="fg.error" fontSize="xs">
                          Choose a date within the loaded history.
                        </Text>
                      )}
                      <Button
                        size="xs"
                        type="submit"
                        colorPalette="teal"
                        disabled={!historyReady}
                      >
                        Start replay
                      </Button>
                    </chakra.form>
                  </Popover.Body>
                </Popover.Content>
              </Popover.Positioner>
            </Portal>
          </Popover.Root>
        )}
        {onToggleLinked && (
          <Button
            size="xs"
            variant={linkedMarket ? 'subtle' : 'ghost'}
            colorPalette={linkedMarket ? 'teal' : 'gray'}
            aria-label="Linked chart"
            title="Linked chart"
            aria-pressed={Boolean(linkedMarket)}
            onClick={onToggleLinked}
          >
            <FiColumns />
          </Button>
        )}
        {filters.backtestId && (
          <NativeSelect.Root
            size="xs"
            w="auto"
            maxW="full"
            disabled={Boolean(replay)}
          >
            <NativeSelect.Field
              aria-label="Compare backtest"
              value={comparisonId}
              onChange={(event) => {
                setComparison(event.target.value);
                setSelected(null);
                setHighlight(null);
              }}
            >
              <option value="">Compare backtest…</option>
              {backtestFiles
                .filter(({ value }) => value !== filters.backtestId)
                .map(({ label, value, data }) => (
                  <option key={value} value={value}>
                    {data?.strategyName ? `${data.strategyName} · ` : ''}
                    {label}
                  </option>
                ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        )}
      </Flex>
      {filters.backtestId && (
        <TradeReview
          rows={rows}
          selected={selected}
          selectTrade={selectTrade}
          comparing={comparing}
          loading={primary.loading || secondary.loading}
          unavailable={primary.unavailable}
          comparisonUnavailable={secondary.unavailable}
          replaying={Boolean(replay)}
        />
      )}
      <Flex align="stretch" minW={0}>
        {chart && (
          <ChartDrawings
            key={`${key}:${replay !== null}`}
            chart={chart}
            storageKey={`tradejs:chart-drawings:${key}`}
            cutoff={cutoff}
            ready={historyReady}
          />
        )}
        <Grid
          flex="1"
          minW={0}
          templateColumns={{
            base: 'minmax(0, 1fr)',
            xl: linkedMarket ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
          }}
          gap={0}
          alignItems="end"
        >
          <Box
            position="relative"
            minW={0}
            h={{ base: '25rem', lg: 'max(28rem, calc(100dvh - 112px))' }}
          >
            {chartContents}
          </Box>
          {linkedMarket && onLinkedMarketChange && (
            <LinkedChart
              id={`${id}-linked`}
              primary={historyReady ? chart : null}
              filters={marketFilters}
              market={linkedMarket}
              onMarketChange={onLinkedMarketChange}
              live={live && !replay}
              replayEnd={
                cutoff === undefined
                  ? undefined
                  : cutoff + intervalToMs(filters.interval)
              }
            />
          )}
        </Grid>
      </Flex>
    </Flex>
  );
};
