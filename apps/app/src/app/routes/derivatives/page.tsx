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
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { FiBarChart2 } from 'react-icons/fi';
import { API } from '@tradejs/core/api';
import { EmptyState, Segment, Select } from '#ui';

type SummaryItem = {
  symbol: string;
  interval: '15m' | '1h';
  points: number;
  last_ts: string;
  first_ts: string;
  latest_open_interest: number | null;
  first_open_interest: number | null;
  oi_change: number | null;
  oi_change_pct: number | null;
  latest_funding_rate: number | null;
  first_funding_rate: number | null;
  funding_change: number | null;
  sum_liq_long: number | null;
  sum_liq_short: number | null;
  sum_liq_total: number | null;
};

type SummaryResponse = {
  hours: number;
  items: SummaryItem[];
};

type DetailRow = {
  symbol: string;
  interval: '15m' | '1h';
  ts: string;
  open_interest: number | null;
  funding_rate: number | null;
  liq_long: number | null;
  liq_short: number | null;
  liq_total: number | null;
};

type DetailResponse = {
  rows: DetailRow[];
  symbol: string;
  interval: '15m' | '1h';
};

type PriceRow = {
  close: number;
  timestamp: number;
};

type PriceResponse = {
  data?: PriceRow[];
};

type BiasTone = 'teal' | 'green' | 'red' | 'orange' | 'gray';

type SymbolMetrics = {
  symbol: string;
  lastTs: string | null;
  currentOpenInterest: number | null;
  oiChange: number | null;
  oiChangePct: number | null;
  currentFundingRate: number | null;
  fundingChange: number | null;
  sumLiqLong: number | null;
  sumLiqShort: number | null;
  sumLiqTotal: number | null;
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

const toFiniteNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

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

const formatTimeLabel = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'dd.MM HH:mm');
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

const getBias = (item: {
  latest_funding_rate: number | null;
  oi_change_pct: number | null;
  sum_liq_long: number | null;
  sum_liq_short: number | null;
}) => {
  const funding = toFiniteNumber(item.latest_funding_rate) ?? 0;
  const oiChangePct = toFiniteNumber(item.oi_change_pct) ?? 0;
  const longLiq = toFiniteNumber(item.sum_liq_long) ?? 0;
  const shortLiq = toFiniteNumber(item.sum_liq_short) ?? 0;

  if (shortLiq > longLiq * 1.35) {
    return { label: 'Short squeeze', tone: 'green' as BiasTone };
  }

  if (longLiq > shortLiq * 1.35) {
    return { label: 'Long flush', tone: 'red' as BiasTone };
  }

  if (oiChangePct > 1 && funding > 0) {
    return { label: 'Crowded longs', tone: 'orange' as BiasTone };
  }

  if (oiChangePct > 1 && funding < 0) {
    return { label: 'Crowded shorts', tone: 'teal' as BiasTone };
  }

  return { label: 'Balanced', tone: 'gray' as BiasTone };
};

const buildMetricsFromRows = (
  symbol: string,
  rows: DetailRow[],
  summaryRow?: SummaryItem,
): SymbolMetrics => {
  if (!rows.length) {
    return {
      symbol,
      lastTs: summaryRow?.last_ts ?? null,
      currentOpenInterest: summaryRow?.latest_open_interest ?? null,
      oiChange: summaryRow?.oi_change ?? null,
      oiChangePct: summaryRow?.oi_change_pct ?? null,
      currentFundingRate: summaryRow?.latest_funding_rate ?? null,
      fundingChange: summaryRow?.funding_change ?? null,
      sumLiqLong: summaryRow?.sum_liq_long ?? null,
      sumLiqShort: summaryRow?.sum_liq_short ?? null,
      sumLiqTotal: summaryRow?.sum_liq_total ?? null,
    };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstOi = toFiniteNumber(first.open_interest);
  const lastOi = toFiniteNumber(last.open_interest);
  const oiChange = firstOi != null && lastOi != null ? lastOi - firstOi : null;
  const oiChangePct =
    oiChange != null && firstOi != null && Math.abs(firstOi) > 0
      ? (oiChange / Math.abs(firstOi)) * 100
      : null;
  const firstFunding = toFiniteNumber(first.funding_rate);
  const lastFunding = toFiniteNumber(last.funding_rate);
  const fundingChange =
    firstFunding != null && lastFunding != null
      ? lastFunding - firstFunding
      : null;

  return rows.reduce<SymbolMetrics>(
    (acc, row) => {
      acc.sumLiqLong = (acc.sumLiqLong ?? 0) + Number(row.liq_long || 0);
      acc.sumLiqShort = (acc.sumLiqShort ?? 0) + Number(row.liq_short || 0);
      acc.sumLiqTotal = (acc.sumLiqTotal ?? 0) + Number(row.liq_total || 0);
      return acc;
    },
    {
      symbol,
      lastTs: last.ts,
      currentOpenInterest: lastOi,
      oiChange,
      oiChangePct,
      currentFundingRate: lastFunding,
      fundingChange,
      sumLiqLong: 0,
      sumLiqShort: 0,
      sumLiqTotal: 0,
    },
  );
};

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

const mapRowsToChartRows = (rows: DetailRow[]) =>
  rows.map((row) => ({
    timestamp: formatTimeLabel(row.ts),
    openInterest: toFiniteNumber(row.open_interest) ?? 0,
    funding: (toFiniteNumber(row.funding_rate) ?? 0) * 10_000,
    longLiquidations: -(toFiniteNumber(row.liq_long) ?? 0),
    shortLiquidations: toFiniteNumber(row.liq_short) ?? 0,
  }));

const mapPriceRowsToChartRows = (rows: PriceRow[]) =>
  rows.map((row) => ({
    price: toFiniteNumber(row.close) ?? 0,
    timestamp: formatTimeLabel(new Date(row.timestamp).toISOString()),
  }));

const SymbolPriceCard = ({
  symbol,
  rows,
}: {
  symbol: string;
  rows: PriceRow[];
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);
  const chartRows = useMemo(() => mapPriceRowsToChartRows(rows), [rows]);

  const priceChartConfig = useMemo(
    () => ({
      data: chartRows,
      series: [{ name: 'price', color: theme.primary }],
    }),
    [chartRows, theme.primary],
  );

  const priceChart = useChart(priceChartConfig as never);
  const latestPrice = rows[rows.length - 1]?.close ?? null;
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
              <XAxis dataKey="timestamp" minTickGap={36} />
              <YAxis domain={priceDomain} tickFormatter={formatPrice} />
              <Tooltip cursor={false} content={<Chart.Tooltip />} />
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
  rows,
}: {
  symbol: string;
  rows: DetailRow[];
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);
  const chartRows = useMemo(() => mapRowsToChartRows(rows), [rows]);

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
              <XAxis dataKey="timestamp" minTickGap={36} />
              <YAxis domain={oiDomain} tickFormatter={formatAxisCompact} />
              <Tooltip cursor={false} content={<Chart.Tooltip />} />
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
  rows,
}: {
  symbol: string;
  rows: DetailRow[];
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);
  const chartRows = useMemo(() => mapRowsToChartRows(rows), [rows]);

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
              <XAxis dataKey="timestamp" minTickGap={36} />
              <YAxis tickFormatter={(value) => `${value} bps`} />
              <Tooltip cursor={false} content={<Chart.Tooltip />} />
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
  rows,
}: {
  symbol: string;
  rows: DetailRow[];
}) => {
  const theme = SYMBOL_THEMES[symbol];
  const symbolLabel = getSymbolLabel(symbol);
  const chartRows = useMemo(() => mapRowsToChartRows(rows), [rows]);

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
              <XAxis dataKey="timestamp" minTickGap={28} />
              <YAxis tickFormatter={formatAxisCompact} />
              <Tooltip cursor={false} content={<Chart.Tooltip />} />
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
  const [selectedInterval, setSelectedInterval] = useState<'15m' | '1h'>('1h');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [detailsBySymbol, setDetailsBySymbol] = useState<
    Record<string, DetailRow[]>
  >({});
  const [pricesBySymbol, setPricesBySymbol] = useState<
    Record<string, PriceRow[]>
  >({});
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
      setSummaryError((err as Error)?.message || 'Failed to load derivatives');
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
              `/api/kline/bybit/${symbol}/${klineInterval}`,
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
    } catch (err) {
      setDetailError(
        (err as Error)?.message ||
          'Failed to load symbol derivatives and price data',
      );
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

  const filteredSummary = useMemo(
    () =>
      (summary?.items ?? []).filter(
        (item) =>
          item.interval === selectedInterval &&
          FIXED_SYMBOLS.includes(item.symbol as (typeof FIXED_SYMBOLS)[number]),
      ),
    [selectedInterval, summary?.items],
  );

  const summaryBySymbol = useMemo(
    () =>
      Object.fromEntries(
        filteredSummary.map((item) => [item.symbol, item]),
      ) as Record<string, SummaryItem | undefined>,
    [filteredSummary],
  );

  const metricsBySymbol = useMemo(
    () =>
      Object.fromEntries(
        FIXED_SYMBOLS.map((symbol) => [
          symbol,
          buildMetricsFromRows(
            symbol,
            detailsBySymbol[symbol] ?? [],
            summaryBySymbol[symbol],
          ),
        ]),
      ) as Record<string, SymbolMetrics>,
    [detailsBySymbol, summaryBySymbol],
  );

  const noSummaryData =
    !summaryLoading && !summaryError && filteredSummary.length === 0;
  const noDetailData =
    !detailLoading &&
    !detailError &&
    FIXED_SYMBOLS.every(
      (symbol) => (detailsBySymbol[symbol] ?? []).length === 0,
    );
  const showSkeleton = (summaryLoading || detailLoading) && !summary;

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
                  setSelectedInterval((value as '15m' | '1h' | null) ?? '1h')
                }
                items={INTERVAL_OPTIONS.map((value) => ({
                  label: value,
                  value,
                }))}
              />
            </Flex>
          </Flex>

          {summaryError ? (
            <Box
              mb={4}
              p={4}
              borderRadius="md"
              borderWidth="1px"
              borderColor="red.900"
              bg="red.950"
            >
              <Text color="red.200">{summaryError}</Text>
            </Box>
          ) : null}

          {detailError ? (
            <Box
              mb={4}
              p={4}
              borderRadius="md"
              borderWidth="1px"
              borderColor="red.900"
              bg="red.950"
            >
              <Text color="red.200">{detailError}</Text>
            </Box>
          ) : null}

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
                        rows={pricesBySymbol[symbol] ?? []}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolOpenInterestCard
                        key={`${symbol}:oi`}
                        symbol={symbol}
                        rows={detailsBySymbol[symbol] ?? []}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolFundingCard
                        key={`${symbol}:funding`}
                        symbol={symbol}
                        rows={detailsBySymbol[symbol] ?? []}
                      />
                    ))}
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} mb={6}>
                    {FIXED_SYMBOLS.map((symbol) => (
                      <SymbolLiquidationCard
                        key={`${symbol}:liq`}
                        symbol={symbol}
                        rows={detailsBySymbol[symbol] ?? []}
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
                        {FIXED_SYMBOLS.map((symbol) => {
                          const row = summaryBySymbol[symbol];
                          const bias = getBias({
                            latest_funding_rate:
                              metricsBySymbol[symbol].currentFundingRate,
                            oi_change_pct: metricsBySymbol[symbol].oiChangePct,
                            sum_liq_long: metricsBySymbol[symbol].sumLiqLong,
                            sum_liq_short: metricsBySymbol[symbol].sumLiqShort,
                          });

                          return (
                            <Table.Row key={symbol}>
                              <Table.Cell>
                                <Text fontWeight="semibold">
                                  {getSymbolLabel(symbol)}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                {formatCompact(
                                  metricsBySymbol[symbol].currentOpenInterest,
                                )}
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                <Text
                                  color={getValueColor(
                                    metricsBySymbol[symbol].oiChangePct,
                                  )}
                                >
                                  {formatPercent(
                                    metricsBySymbol[symbol].oiChangePct,
                                  )}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                <Text
                                  color={getFundingColor(
                                    metricsBySymbol[symbol].currentFundingRate,
                                  )}
                                >
                                  {formatFunding(
                                    metricsBySymbol[symbol].currentFundingRate,
                                  )}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                {formatCompact(
                                  metricsBySymbol[symbol].sumLiqLong,
                                )}
                              </Table.Cell>
                              <Table.Cell textAlign="right">
                                {formatCompact(
                                  metricsBySymbol[symbol].sumLiqShort,
                                )}
                              </Table.Cell>
                              <Table.Cell>
                                <Badge colorPalette={bias.tone}>
                                  {bias.label}
                                </Badge>
                              </Table.Cell>
                              <Table.Cell>
                                {formatFullTime(
                                  metricsBySymbol[symbol].lastTs ??
                                    row?.last_ts,
                                )}
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
