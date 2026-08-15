'use client';

import { type ReactNode, useMemo } from 'react';
import {
  Badge,
  Box,
  Card,
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
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import { TimeSeriesXAxis } from '#shared/Charts/TimeSeriesXAxis';
import { EmptyState } from '#ui';
import { FIXED_SYMBOLS, type ChartWindow } from './derivativesDashboardConfig';
import {
  type DerivativesChartRow,
  type PriceChartRow,
  type SymbolMetrics,
  buildDerivativesDashboardViewModel,
  toFiniteNumber,
} from './derivativesViewModel';

type SymbolChartTheme = {
  primary: string;
  primaryNegative: string;
  secondary: string;
};

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

type DashboardViewModel = ReturnType<typeof buildDerivativesDashboardViewModel>;

export const DerivativesDashboardView = ({
  dashboard,
  chartWindow,
}: {
  dashboard: DashboardViewModel;
  chartWindow: ChartWindow;
}) => {
  const {
    chartDataBySymbol,
    metricsBySymbol,
    noDetailData,
    noSummaryData,
    overviewRows,
    showSkeleton,
  } = dashboard;

  if (showSkeleton) return <DashboardSkeleton />;
  if (noSummaryData) {
    return (
      <EmptyState
        icon={FiBarChart2}
        title="No derivatives data found"
        description="There are no BTC or ETH derivatives rows for the selected time window and interval."
      />
    );
  }

  return (
    <>
      {noDetailData ? (
        <EmptyState
          icon={FiBarChart2}
          title="No chart data for BTC and ETH"
          description="Try another interval or a wider time window."
        />
      ) : (
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
                  <Table.ColumnHeader textAlign="right">OI</Table.ColumnHeader>
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
                {overviewRows.map(({ symbol, metrics, bias }) => (
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
                      <Text color={getValueColor(metrics.oiChangePct)}>
                        {formatPercent(metrics.oiChangePct)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="right">
                      <Text color={getFundingColor(metrics.currentFundingRate)}>
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
                      <Badge colorPalette={bias.tone}>{bias.label}</Badge>
                    </Table.Cell>
                    <Table.Cell>{formatFullTime(metrics.lastTs)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        </Card.Body>
      </Card.Root>
    </>
  );
};
