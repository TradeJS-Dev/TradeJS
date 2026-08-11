'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Badge,
  Box,
  Card,
  ClientOnly,
  Flex,
  Heading,
  SimpleGrid,
  Skeleton,
  SkeletonText,
  Stat,
  Table,
  Text,
} from '@chakra-ui/react';
import { Chart, useChart } from '@chakra-ui/charts';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { FiBarChart2 } from 'react-icons/fi';
import { API } from '@tradejs/core/api';
import { buildKlinePath } from '#app/lib/marketRoutes';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import { TimeSeriesXAxis } from '#shared/Charts/TimeSeriesXAxis';
import { EmptyState, Segment, Select, toaster } from '#ui';
import {
  buildDerivativesDashboardViewModel,
  toFiniteNumber,
  type DerivativesChartRow,
  type DerivativesInterval,
  type DetailResponse,
  type DetailRow,
  type PriceChartRow,
  type PriceResponse,
  type PriceRow,
  type SummaryResponse,
  type SymbolMetrics,
} from './derivativesViewModel';

type ChartWindow = {
  startTimestamp: number;
  endTimestamp: number;
};

type SymbolChartTheme = {
  primary: string;
  primaryNegative: string;
  secondary: string;
};

const HOURS_OPTIONS = [
  { label: 'Last 24h', value: '24' },
  { label: 'Last 7d', value: '168' },
  { label: 'Last 30d', value: '720' },
  { label: 'Last 60d', value: '1440' },
  { label: 'Last 90d', value: '2160' },
];

const INTERVAL_OPTIONS = ['15m', '1h'] as const;

const FIXED_SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;

const DERIVATIVES_TO_KLINE_INTERVAL = {
  '15m': '15',
  '1h': '60',
} as const;

const SYMBOL_THEMES: Record<string, SymbolChartTheme> = {
  BTCUSDT: {
    primary: 'orange.solid',
    primaryNegative: 'red.solid',
    secondary: 'orange.solid',
  },
  ETHUSDT: {
    primary: 'teal.solid',
    primaryNegative: 'pink.solid',
    secondary: 'teal.solid',
  },
};

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const compactSignedFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
  signDisplay: 'always',
});

const formatCompact = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return 'n/a';
  return compactFormatter.format(parsed);
};

const formatSignedCompact = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return 'n/a';
  return compactSignedFormatter.format(parsed);
};

const formatPercent = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return 'n/a';
  return `${parsed >= 0 ? '+' : ''}${parsed.toFixed(2)}%`;
};

const formatFunding = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return 'n/a';
  const basisPoints = parsed * 10_000;
  return `${basisPoints >= 0 ? '+' : ''}${basisPoints.toFixed(2)} bps`;
};

const formatAxisCompact = (value: number) =>
  compactFormatter.format(Math.abs(value));

const formatPrice = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return 'n/a';

  const digits = parsed >= 1000 ? 2 : parsed >= 1 ? 3 : 6;
  return parsed.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
};

const getChartDomain = (
  values: Array<number | null | undefined>,
  options?: { includeZero?: boolean; minPaddingPct?: number },
): [number, number] | undefined => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );

  if (!finite.length) return undefined;

  let min = Math.min(...finite);
  let max = Math.max(...finite);

  if (options?.includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }

  const span = max - min;
  const paddingPct = options?.minPaddingPct ?? 0.06;
  const basePadding =
    span > 0
      ? span * paddingPct
      : Math.max(Math.abs(max || min || 1) * paddingPct, 1e-6);

  return [min - basePadding, max + basePadding];
};

const formatFullTime = (value: string | null | undefined) => {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'dd.MM.yyyy HH:mm');
};

const getValueColor = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null || parsed === 0) return 'gray.200';
  return parsed > 0 ? 'teal.300' : 'red.300';
};

const getFundingColor = (value: number | null | undefined) => {
  const parsed = toFiniteNumber(value);
  if (parsed == null || parsed === 0) return 'gray.200';
  return parsed > 0 ? 'orange.300' : 'teal.300';
};

const getSymbolLabel = (symbol: string) =>
  symbol === 'BTCUSDT' ? 'BTC' : symbol === 'ETHUSDT' ? 'ETH' : symbol;

const DashboardSkeleton = () => (
  <>
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
      {FIXED_SYMBOLS.map((symbol) => (
        <Card.Root
          key={symbol}
          bg="gray.900"
          borderColor="gray.800"
          borderWidth="1px"
          size="sm"
        >
          <Card.Header>
            <Skeleton height="24px" width="120px" />
          </Card.Header>
          <Card.Body>
            <SimpleGrid columns={{ base: 2, xl: 4 }} gap={4}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Box key={`${symbol}:${index}`}>
                  <SkeletonText noOfLines={2} gap="3" mb={2} />
                  <Skeleton height="18px" width="70%" />
                </Box>
              ))}
            </SimpleGrid>
          </Card.Body>
        </Card.Root>
      ))}
    </SimpleGrid>

    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="280px" />
        </Card.Body>
      </Card.Root>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="280px" />
        </Card.Body>
      </Card.Root>
    </SimpleGrid>

    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="280px" />
        </Card.Body>
      </Card.Root>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="280px" />
        </Card.Body>
      </Card.Root>
    </SimpleGrid>

    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="280px" />
        </Card.Body>
      </Card.Root>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="280px" />
        </Card.Body>
      </Card.Root>
    </SimpleGrid>

    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="220px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="320px" />
        </Card.Body>
      </Card.Root>
      <Card.Root
        bg="gray.900"
        borderColor="gray.800"
        borderWidth="1px"
        size="sm"
      >
        <Card.Header>
          <Skeleton height="24px" width="260px" />
        </Card.Header>
        <Card.Body>
          <Skeleton height="320px" />
        </Card.Body>
      </Card.Root>
    </SimpleGrid>

    <Card.Root bg="gray.900" borderColor="gray.800" borderWidth="1px" size="sm">
      <Card.Header>
        <Skeleton height="24px" width="180px" />
      </Card.Header>
      <Card.Body>
        <SkeletonText noOfLines={8} gap="5" />
      </Card.Body>
    </Card.Root>
  </>
);

const SymbolMetricsCard = ({
  title,
  metrics,
}: {
  title: string;
  metrics: SymbolMetrics;
}) => (
  <Card.Root bg="gray.900" borderColor="gray.800" borderWidth="1px" size="sm">
    <Card.Header pb={0}>
      <Heading size="md">{title}</Heading>
      <Text mt={1} color="gray.500" fontSize="sm">
        Updated {formatFullTime(metrics.lastTs)}
      </Text>
    </Card.Header>
    <Card.Body>
      <SimpleGrid columns={{ base: 2, xl: 4 }} gap={4}>
        <Stat.Root>
          <Stat.Label color="gray.400">Open Interest</Stat.Label>
          <Stat.ValueText color={getValueColor(metrics.oiChange)}>
            {formatCompact(metrics.currentOpenInterest)}
          </Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label color="gray.400">OI Change</Stat.Label>
          <Stat.ValueText color={getValueColor(metrics.oiChangePct)}>
            {formatPercent(metrics.oiChangePct)}
          </Stat.ValueText>
          <Stat.HelpText color="gray.500">
            {formatSignedCompact(metrics.oiChange)}
          </Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label color="gray.400">Funding</Stat.Label>
          <Stat.ValueText color={getFundingColor(metrics.currentFundingRate)}>
            {formatFunding(metrics.currentFundingRate)}
          </Stat.ValueText>
          <Stat.HelpText color="gray.500">
            Delta {formatFunding(metrics.fundingChange)}
          </Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label color="gray.400">Liquidations</Stat.Label>
          <Stat.ValueText color="gray.200">
            {formatCompact(metrics.sumLiqTotal)}
          </Stat.ValueText>
          <Stat.HelpText color="gray.500">
            Long {formatCompact(metrics.sumLiqLong)} / Short{' '}
            {formatCompact(metrics.sumLiqShort)}
          </Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>
    </Card.Body>
  </Card.Root>
);

const ChartCard = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <Card.Root bg="gray.900" borderColor="gray.800" borderWidth="1px" size="sm">
    <Card.Header pb={0}>
      <Heading size="md">{title}</Heading>
      <Text mt={1} color="gray.500" fontSize="sm">
        {description}
      </Text>
    </Card.Header>
    <Card.Body>{children}</Card.Body>
  </Card.Root>
);

const SymbolPriceCard = ({
  symbol,
  chartRows,
  window,
}: {
  symbol: string;
  chartRows: PriceChartRow[];
  window: ChartWindow;
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);

  const priceChartConfig = useMemo(
    () => ({
      data: chartRows,
      series: [{ name: 'price', color: theme.primary }],
    }),
    [chartRows, theme.primary],
  );

  const priceChart = useChart(priceChartConfig as never);
  const latestPrice = chartRows[chartRows.length - 1]?.price ?? null;
  const priceDomain = useMemo(
    () => getChartDomain(chartRows.map((row) => row.price)),
    [chartRows],
  );

  return (
    <ChartCard
      title={`${symbolLabel} Price`}
      description={`Last close ${formatPrice(latestPrice)}`}
    >
      <Box h="280px">
        <ResponsiveContainer width="100%" height="100%">
          <Chart.Root chart={priceChart}>
            <AreaChart data={priceChart.data}>
              <defs>
                <linearGradient
                  id={`${symbol}-price-fill`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={priceChart.color(theme.primary)}
                    stopOpacity={0.28}
                  />
                  <stop
                    offset="95%"
                    stopColor={priceChart.color(theme.primary)}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke={priceChart.color('border')}
                vertical={false}
              />
              <TimeSeriesXAxis
                startTimestamp={window.startTimestamp}
                endTimestamp={window.endTimestamp}
                tickCount={5}
                minTickGap={36}
              />
              <YAxis domain={priceDomain} tickFormatter={formatPrice} />
              <Tooltip
                cursor={false}
                content={
                  <Chart.Tooltip
                    labelFormatter={formatTimeSeriesTooltipTimestamp}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey={priceChart.key('price') as string}
                stroke={priceChart.color(theme.primary)}
                fill={`url(#${symbol}-price-fill)`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </Chart.Root>
        </ResponsiveContainer>
      </Box>
    </ChartCard>
  );
};

const SymbolOpenInterestCard = ({
  symbol,
  chartRows,
  window,
}: {
  symbol: string;
  chartRows: DerivativesChartRow[];
  window: ChartWindow;
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);

  const oiChartConfig = useMemo(
    () => ({
      data: chartRows,
      series: [{ name: 'openInterest', color: theme.primary }],
    }),
    [chartRows, theme.primary],
  );

  const oiChart = useChart(oiChartConfig as never);
  const oiDomain = useMemo(
    () => getChartDomain(chartRows.map((row) => row.openInterest)),
    [chartRows],
  );

  return (
    <ChartCard
      title={`${symbolLabel} Open Interest`}
      description="Position size through the selected window."
    >
      <Box h="280px">
        <ResponsiveContainer width="100%" height="100%">
          <Chart.Root chart={oiChart}>
            <AreaChart data={oiChart.data}>
              <defs>
                <linearGradient
                  id={`${symbol}-oi-fill`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={oiChart.color(theme.primary)}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={oiChart.color(theme.primary)}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke={oiChart.color('border')}
                vertical={false}
              />
              <TimeSeriesXAxis
                startTimestamp={window.startTimestamp}
                endTimestamp={window.endTimestamp}
                tickCount={5}
                minTickGap={36}
              />
              <YAxis domain={oiDomain} tickFormatter={formatAxisCompact} />
              <Tooltip
                cursor={false}
                content={
                  <Chart.Tooltip
                    labelFormatter={formatTimeSeriesTooltipTimestamp}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey={oiChart.key('openInterest') as string}
                stroke={oiChart.color(theme.primary)}
                fill={`url(#${symbol}-oi-fill)`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </Chart.Root>
        </ResponsiveContainer>
      </Box>
    </ChartCard>
  );
};

const SymbolFundingCard = ({
  symbol,
  chartRows,
  window,
}: {
  symbol: string;
  chartRows: DerivativesChartRow[];
  window: ChartWindow;
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);

  const fundingChartConfig = useMemo(
    () => ({
      data: chartRows,
      series: [{ name: 'funding', color: theme.primary }],
    }),
    [chartRows, theme.primary],
  );

  const fundingChart = useChart(fundingChartConfig as never);

  return (
    <ChartCard
      title={`${symbolLabel} Funding`}
      description="Positive values mean longs pay shorts."
    >
      <Box h="280px">
        <ResponsiveContainer width="100%" height="100%">
          <Chart.Root chart={fundingChart}>
            <BarChart data={fundingChart.data}>
              <CartesianGrid
                stroke={fundingChart.color('border')}
                vertical={false}
              />
              <ReferenceLine
                y={0}
                stroke={fundingChart.color('gray.600')}
                strokeDasharray="4 4"
              />
              <TimeSeriesXAxis
                startTimestamp={window.startTimestamp}
                endTimestamp={window.endTimestamp}
                tickCount={5}
                minTickGap={36}
              />
              <YAxis tickFormatter={(value) => `${value} bps`} />
              <Tooltip
                cursor={false}
                content={
                  <Chart.Tooltip
                    labelFormatter={formatTimeSeriesTooltipTimestamp}
                  />
                }
              />
              <Bar
                dataKey={fundingChart.key('funding') as string}
                isAnimationActive={false}
              >
                {fundingChart.data.map((entry, idx) => (
                  <Cell
                    key={`${symbol}:${entry.timestamp}:${idx}`}
                    fill={
                      entry.funding >= 0
                        ? fundingChart.color(theme.primary)
                        : fundingChart.color(theme.primaryNegative)
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </Chart.Root>
        </ResponsiveContainer>
      </Box>
    </ChartCard>
  );
};

const SymbolLiquidationCard = ({
  symbol,
  chartRows,
  window,
}: {
  symbol: string;
  chartRows: DerivativesChartRow[];
  window: ChartWindow;
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);

  const liquidationChartConfig = useMemo(
    () => ({
      data: chartRows,
      series: [
        { name: 'longLiquidations', color: theme.primaryNegative },
        { name: 'shortLiquidations', color: theme.secondary },
      ],
    }),
    [chartRows, theme.primaryNegative, theme.secondary],
  );

  const liquidationChart = useChart(liquidationChartConfig as never);

  return (
    <ChartCard
      title={`${symbolLabel} Liquidation Pressure`}
      description="Long liquidations are below zero, short liquidations are above zero."
    >
      <Box h="320px">
        <ResponsiveContainer width="100%" height="100%">
          <Chart.Root chart={liquidationChart}>
            <BarChart data={liquidationChart.data}>
              <CartesianGrid
                stroke={liquidationChart.color('border')}
                vertical={false}
              />
              <ReferenceLine
                y={0}
                stroke={liquidationChart.color('gray.600')}
                strokeDasharray="4 4"
              />
              <TimeSeriesXAxis
                startTimestamp={window.startTimestamp}
                endTimestamp={window.endTimestamp}
                tickCount={5}
                minTickGap={28}
              />
              <YAxis tickFormatter={formatAxisCompact} />
              <Tooltip
                cursor={false}
                content={
                  <Chart.Tooltip
                    labelFormatter={formatTimeSeriesTooltipTimestamp}
                  />
                }
              />
              <Legend />
              <Bar
                dataKey={liquidationChart.key('longLiquidations') as string}
                name={`${symbolLabel} long liq`}
                fill={liquidationChart.color(theme.primaryNegative)}
                isAnimationActive={false}
              />
              <Bar
                dataKey={liquidationChart.key('shortLiquidations') as string}
                name={`${symbolLabel} short liq`}
                fill={liquidationChart.color(theme.secondary)}
                isAnimationActive={false}
              />
            </BarChart>
          </Chart.Root>
        </ResponsiveContainer>
      </Box>
    </ChartCard>
  );
};

const DerivativesPage = () => {
  const [hours, setHours] = useState('24');
  const [selectedInterval, setSelectedInterval] =
    useState<DerivativesInterval>('1h');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [detailsBySymbol, setDetailsBySymbol] = useState<
    Record<string, DetailRow[]>
  >({});
  const [pricesBySymbol, setPricesBySymbol] = useState<
    Record<string, PriceRow[]>
  >({});
  const [chartWindow, setChartWindow] = useState<ChartWindow>(() => {
    const endTimestamp = Date.now();
    return {
      startTimestamp: endTimestamp - 24 * 60 * 60 * 1000,
      endTimestamp,
    };
  });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [detailError, setDetailError] = useState('');

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');

    try {
      const symbolsParam = FIXED_SYMBOLS.join(',');
      const response = await API.get<SummaryResponse>(
        `/api/derivatives/summary?hours=${hours}&limit=200&symbols=${symbolsParam}`,
      );
      setSummary(response);
    } catch (err) {
      const message = (err as Error)?.message || 'Failed to load derivatives';
      setSummaryError(message);
      toaster.error({
        title: 'Failed to load derivatives',
        description: message,
      });
    } finally {
      setSummaryLoading(false);
    }
  }, [hours]);

  const loadDetails = useCallback(async () => {
    setDetailLoading(true);
    setDetailError('');

    const now = Date.now();
    const from = now - Number(hours) * 60 * 60 * 1000;
    const klineInterval = DERIVATIVES_TO_KLINE_INTERVAL[selectedInterval];

    try {
      const responses = await Promise.all(
        FIXED_SYMBOLS.map(async (symbol) => {
          const [derivativesResponse, priceResponse] = await Promise.all([
            API.get<DetailResponse>(
              `/api/derivatives/${symbol}/${selectedInterval}?from=${from}&to=${now}`,
            ),
            API.post<PriceResponse>(
              buildKlinePath({
                provider: 'bybit',
                universe: 'crypto',
                symbol,
                interval: klineInterval,
              }),
              {
                start: from,
                end: now,
              },
            ),
          ]);

          return [
            symbol,
            {
              detailRows: derivativesResponse.rows,
              priceRows: priceResponse.data ?? [],
            },
          ] as const;
        }),
      );

      setDetailsBySymbol(
        Object.fromEntries(
          responses.map(([symbol, payload]) => [symbol, payload.detailRows]),
        ),
      );
      setPricesBySymbol(
        Object.fromEntries(
          responses.map(([symbol, payload]) => [symbol, payload.priceRows]),
        ),
      );
      setChartWindow({ startTimestamp: from, endTimestamp: now });
    } catch (err) {
      const message =
        (err as Error)?.message ||
        'Failed to load symbol derivatives and price data';
      setDetailError(message);
      toaster.error({
        title: 'Failed to load derivative details',
        description: message,
      });
    } finally {
      setDetailLoading(false);
    }
  }, [hours, selectedInterval]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const dashboard = useMemo(
    () =>
      buildDerivativesDashboardViewModel({
        symbols: FIXED_SYMBOLS,
        selectedInterval,
        summary,
        detailsBySymbol,
        pricesBySymbol,
        summaryLoading,
        detailLoading,
        summaryError,
        detailError,
      }),
    [
      detailError,
      detailLoading,
      detailsBySymbol,
      pricesBySymbol,
      selectedInterval,
      summary,
      summaryError,
      summaryLoading,
    ],
  );
  const {
    chartDataBySymbol,
    metricsBySymbol,
    noDetailData,
    noSummaryData,
    overviewRows,
    showSkeleton,
  } = dashboard;

  return (
    <ClientOnly>
      <Box minH="100vh" bg="gray.950">
        <Box as="main" maxW="1600px" mx="auto" px={6} py={6}>
          <Flex
            mb={6}
            gap={4}
            alignItems={{ base: 'flex-start', lg: 'center' }}
            justifyContent="space-between"
            wrap="wrap"
          >
            <Box>
              <Heading size="lg">Derivatives Dashboard</Heading>
            </Box>

            <Flex gap={3} wrap="wrap" alignItems="center">
              <Select
                placeholder="Window"
                defaultValue={[hours]}
                value={[hours]}
                onChange={(value) => setHours(value[0] || '24')}
                items={HOURS_OPTIONS}
                width="180px"
              />

              <Segment
                defaultValue={selectedInterval}
                value={selectedInterval}
                onChange={(value) =>
                  setSelectedInterval(
                    (value as DerivativesInterval | null) ?? '1h',
                  )
                }
                items={INTERVAL_OPTIONS.map((value) => ({
                  label: value,
                  value,
                }))}
              />
            </Flex>
          </Flex>

          {showSkeleton ? <DashboardSkeleton /> : null}

          {noSummaryData ? (
            <EmptyState
              icon={FiBarChart2}
              title="No derivatives data found"
              description="There are no BTC or ETH derivatives rows for the selected time window and interval."
            />
          ) : null}

          {!showSkeleton && !noSummaryData && (
            <>
              {noDetailData ? (
                <EmptyState
                  icon={FiBarChart2}
                  title="No chart data for BTC and ETH"
                  description="Try another interval or a wider time window."
                />
              ) : null}

              {!noDetailData && (
                <>
                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolMetricsCard
                        key={symbol}
                        title={`${getSymbolLabel(symbol)} Snapshot`}
                        metrics={metricsBySymbol[symbol]}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolPriceCard
                        key={`${symbol}:price`}
                        symbol={symbol}
                        chartRows={chartDataBySymbol[symbol].prices}
                        window={chartWindow}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolOpenInterestCard
                        key={`${symbol}:oi`}
                        symbol={symbol}
                        chartRows={chartDataBySymbol[symbol].derivatives}
                        window={chartWindow}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolFundingCard
                        key={`${symbol}:funding`}
                        symbol={symbol}
                        chartRows={chartDataBySymbol[symbol].derivatives}
                        window={chartWindow}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolLiquidationCard
                        key={`${symbol}:liq`}
                        symbol={symbol}
                        chartRows={chartDataBySymbol[symbol].derivatives}
                        window={chartWindow}
                      />
                    ))}
                  </SimpleGrid>
                </>
              )}

              <Card.Root
                bg="gray.900"
                borderColor="gray.800"
                borderWidth="1px"
                size="sm"
              >
                <Card.Header>
                  <Heading size="md">BTC / ETH Overview</Heading>
                  <Text mt={1} color="gray.500" fontSize="sm">
                    One row per symbol for the selected interval and window.
                  </Text>
                </Card.Header>
                <Card.Body>
                  <Box overflowX="auto">
                    <Table.Root size="sm">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Symbol</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="right">
                            OI
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="right">
                            OI Δ
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="right">
                            Funding
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="right">
                            Long Liq
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="right">
                            Short Liq
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Pressure</Table.ColumnHeader>
                          <Table.ColumnHeader>Updated</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {overviewRows.map(({ symbol, metrics, bias }) => {
                          return (
                            <Table.Row key={symbol}>
                              <Table.Cell>
                                <Text fontWeight="semibold">
                                  {getSymbolLabel(symbol)}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                {formatCompact(metrics.currentOpenInterest)}
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                <Text
                                  color={getValueColor(metrics.oiChangePct)}
                                >
                                  {formatPercent(metrics.oiChangePct)}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                <Text
                                  color={getFundingColor(
                                    metrics.currentFundingRate,
                                  )}
                                >
                                  {formatFunding(metrics.currentFundingRate)}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                {formatCompact(metrics.sumLiqLong)}
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                {formatCompact(metrics.sumLiqShort)}
                              </Table.Cell>
                              <Table.Cell>
                                <Badge colorPalette={bias.tone}>
                                  {bias.label}
                                </Badge>
                              </Table.Cell>
                              <Table.Cell>
                                {formatFullTime(metrics.lastTs)}
                              </Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                </Card.Body>
              </Card.Root>
            </>
          )}
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default DerivativesPage;
