'use client';

import {
  Box,
  CloseButton,
  Drawer,
  Flex,
  Grid,
  Portal,
  SimpleGrid,
  Text,
} from '@chakra-ui/react';
import type { ThresholdLevel } from '@tradejs/types';
import {
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
  type OrdersDrawerSummaryItem,
} from '#components/Shared/OrdersDrawer';
import type { RuntimeStrategyView } from '#app/lib/runtimeStrategyContracts';
import { buildQuarterlyMonthlyStats } from '#app/lib/strategyPerformance';
import { AdvancedMetricsPanel } from './AdvancedMetricsPanel';
import {
  ChartPanel,
  DrawdownTimelineChart,
  PnlDistributionChart,
  RollingPerformanceChart,
  TimeOfDaySessionChart,
  WinLossStreakTimelineChart,
} from './StrategyPerformanceCharts';
import {
  buildRuntimeStrategyCardViewModel,
  getMetricColor,
  getPnlBarColor,
  type RuntimeSymbolPnlRank,
} from './RuntimeStrategyCard.presenter';

type RuntimeStrategyCardViewModel = ReturnType<
  typeof buildRuntimeStrategyCardViewModel
>;

const RuntimeOrdersSummaryBlock = ({
  items,
}: {
  items: OrdersDrawerSummaryItem[];
}) => (
  <Box
    p={4}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
  >
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
      {items.map((item) => (
        <Box key={item.title}>
          <Text fontSize="sm" color="gray.500">
            {item.title}
          </Text>
          <Text
            mt={1}
            fontSize="2xl"
            color={item.color ?? 'gray.100'}
            fontWeight="bold"
            fontFamily="mono"
            lineHeight="1.1"
          >
            {item.value}
          </Text>
        </Box>
      ))}
    </SimpleGrid>
  </Box>
);

const renderPnlRanking = ({
  title,
  subtitle,
  ranking,
  maxAbsPnl,
}: {
  title: string;
  subtitle: string;
  ranking: RuntimeSymbolPnlRank[];
  maxAbsPnl: number;
}) => (
  <Box
    p={4}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
  >
    <Flex justify="space-between" align="baseline" gap={3} mb={4}>
      <Text fontSize="sm" color="gray.300" fontWeight="semibold">
        {title}
      </Text>
      <Text fontSize="xs" color="gray.500">
        {subtitle}
      </Text>
    </Flex>

    {ranking.length ? (
      <Flex direction="column" gap={3}>
        {ranking.map((rank) => {
          const width = Math.max(4, (Math.abs(rank.pnl) / maxAbsPnl) * 100);

          return (
            <Grid
              key={rank.symbol}
              templateColumns="1.1fr 2fr 0.8fr"
              alignItems="center"
              gap={3}
            >
              <Box minW={0}>
                <Text
                  fontSize="sm"
                  color="gray.200"
                  fontWeight="bold"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {rank.symbol}
                </Text>
                <Text fontSize="xs" color="gray.500" fontFamily="mono">
                  {formatInteger(rank.orders)} orders ·{' '}
                  {formatPercent(rank.winRate)}
                </Text>
                <Text fontSize="xs" color="gray.600" fontFamily="mono">
                  avg {formatSignedNumber(rank.avgPnl)}
                </Text>
              </Box>
              <Box h="10px" bg="gray.800">
                <Box h="full" w={`${width}%`} bg={getPnlBarColor(rank.pnl)} />
              </Box>
              <Text
                fontSize="sm"
                color={getPnlColor(rank.pnl)}
                fontWeight="bold"
                fontFamily="mono"
                textAlign="right"
              >
                {formatSignedNumber(rank.pnl)}
              </Text>
            </Grid>
          );
        })}
      </Flex>
    ) : (
      <Text fontSize="sm" color="gray.500">
        No symbol P&L data
      </Text>
    )}
  </Box>
);

export const RuntimeStrategyStatsDrawer = ({
  strategy,
  provider,
  open,
  onOpenChange,
  viewModel,
}: {
  strategy: RuntimeStrategyView;
  provider: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewModel: RuntimeStrategyCardViewModel;
}) => {
  const {
    runtimeOrderSummaryItems,
    drawerMetrics,
    symbolConcentration,
    topSymbolPnlRanking,
    worstSymbolPnlRanking,
    symbolRankingMaxAbsPnl,
    directionStats,
    advancedMetrics,
  } = viewModel;
  const {
    monthlyStats,
    tradePoints: runtimeTradePoints,
    drawdownPoints,
    rollingPerformancePoints,
    pnlDistributionBins,
    sessionPnlStats,
    hourlyPnlStats,
  } = viewModel.performance;

  return (
    <Drawer.Root
      size="xl"
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content
            display="flex"
            flexDirection="column"
            w="50vw"
            minW="640px"
            maxW="50vw"
            bg="gray.950"
          >
            <Drawer.Header>
              <Drawer.Title>{strategy.strategyName}</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body
              display="flex"
              flexDirection="column"
              gap={4}
              overflowY="auto"
              flex="1"
              minH="0"
              w="full"
            >
              <RuntimeOrdersSummaryBlock items={runtimeOrderSummaryItems} />

              <Box
                p={4}
                borderWidth="1px"
                borderColor="gray.800"
                borderRadius="md"
                bg="gray.900"
              >
                <Text fontSize="sm" color="gray.500" mb={3}>
                  connector: {provider}
                </Text>

                <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
                  {drawerMetrics.map((metric) => (
                    <Box
                      key={metric.id}
                      p={3}
                      borderWidth="1px"
                      borderColor="gray.800"
                      borderRadius="md"
                      bg="blackAlpha.300"
                    >
                      <Text
                        fontSize="xs"
                        color="gray.400"
                        fontWeight="semibold"
                        textTransform="uppercase"
                      >
                        {metric.label}
                      </Text>
                      <Text
                        mt={1}
                        fontSize="xl"
                        color={getMetricColor(metric.level)}
                        fontWeight="bold"
                        fontFamily="mono"
                        lineHeight="1.2"
                      >
                        {metric.value}
                      </Text>
                    </Box>
                  ))}
                </SimpleGrid>
              </Box>

              <AdvancedMetricsPanel metrics={advancedMetrics} />

              {monthlyStats.length ? (
                <Box
                  p={4}
                  borderWidth="1px"
                  borderColor="gray.800"
                  borderRadius="md"
                  bg="gray.900"
                >
                  <Text
                    fontSize="sm"
                    color="gray.300"
                    fontWeight="semibold"
                    mb={3}
                  >
                    Monthly Performance
                  </Text>

                  <Flex direction="column" gap={4}>
                    {monthlyStats.map((yearGroup) => (
                      <Box key={yearGroup.year}>
                        <Flex align="center" gap={3} mb={3}>
                          <Text
                            fontSize="lg"
                            color="gray.100"
                            fontWeight="bold"
                            fontFamily="mono"
                          >
                            {yearGroup.year}
                          </Text>
                          <Box flex="1" h="1px" bg="gray.800" />
                        </Flex>

                        <Flex direction="column" gap={3}>
                          {buildQuarterlyMonthlyStats(yearGroup.months).map(
                            (quarter) => (
                              <Flex
                                key={`${yearGroup.year}-${quarter.label}`}
                                align="stretch"
                                gap={3}
                              >
                                <Flex
                                  w="34px"
                                  flexShrink={0}
                                  align="center"
                                  justify="center"
                                >
                                  <Text
                                    fontSize="xs"
                                    color="gray.500"
                                    fontFamily="mono"
                                    fontWeight="bold"
                                  >
                                    {quarter.label}
                                  </Text>
                                </Flex>

                                <SimpleGrid columns={3} gap={3} flex="1">
                                  {quarter.months.map((month, monthOffset) => {
                                    const monthIndex =
                                      quarter.monthIndexes[monthOffset] ?? 0;

                                    if (!month) {
                                      return (
                                        <Box
                                          key={`${quarter.label}-${monthIndex}-empty`}
                                          minH="116px"
                                          visibility="hidden"
                                        />
                                      );
                                    }

                                    const winRate =
                                      month.orders > 0
                                        ? (month.wins / month.orders) * 100
                                        : null;

                                    return (
                                      <Box
                                        key={month.id}
                                        p={3}
                                        minH="116px"
                                        borderWidth="1px"
                                        borderColor="gray.800"
                                        borderLeftWidth="3px"
                                        borderLeftColor={getPnlColor(month.pnl)}
                                        borderRadius="md"
                                        bg="blackAlpha.300"
                                      >
                                        <Flex
                                          justify="space-between"
                                          align="baseline"
                                          gap={2}
                                        >
                                          <Text
                                            fontSize="sm"
                                            color="gray.200"
                                            fontWeight="bold"
                                          >
                                            {month.monthLabel}
                                          </Text>
                                          <Text
                                            fontSize="xs"
                                            color="gray.500"
                                            fontFamily="mono"
                                          >
                                            {String(month.monthIndex).padStart(
                                              2,
                                              '0',
                                            )}
                                          </Text>
                                        </Flex>
                                        <Text
                                          mt={3}
                                          fontSize="xl"
                                          color={getPnlColor(month.pnl)}
                                          fontWeight="bold"
                                          fontFamily="mono"
                                          lineHeight="1.2"
                                        >
                                          {formatSignedNumber(month.pnl)}
                                        </Text>
                                        <Flex
                                          mt={3}
                                          justify="space-between"
                                          gap={3}
                                        >
                                          <Box>
                                            <Text
                                              fontSize="xs"
                                              color="gray.500"
                                            >
                                              Orders
                                            </Text>
                                            <Text
                                              fontSize="sm"
                                              color="gray.300"
                                              fontFamily="mono"
                                              fontWeight="semibold"
                                            >
                                              {formatInteger(month.orders)}
                                            </Text>
                                          </Box>
                                          <Box textAlign="right">
                                            <Text
                                              fontSize="xs"
                                              color="gray.500"
                                            >
                                              Win rate
                                            </Text>
                                            <Text
                                              fontSize="sm"
                                              color="gray.300"
                                              fontFamily="mono"
                                              fontWeight="semibold"
                                            >
                                              {formatPercent(winRate)}
                                            </Text>
                                          </Box>
                                        </Flex>
                                      </Box>
                                    );
                                  })}
                                </SimpleGrid>
                              </Flex>
                            ),
                          )}
                        </Flex>
                      </Box>
                    ))}
                  </Flex>
                </Box>
              ) : null}

              <Flex direction="column" gap={4}>
                <ChartPanel
                  title="Drawdown Timeline"
                  subtitle="equity peak to current equity"
                >
                  <DrawdownTimelineChart points={drawdownPoints} />
                </ChartPanel>

                <ChartPanel
                  title="Rolling Performance"
                  subtitle="last 50 trades"
                >
                  <RollingPerformanceChart points={rollingPerformancePoints} />
                </ChartPanel>

                <ChartPanel
                  title="Win / Loss Streak Timeline"
                  subtitle="trade sequence"
                >
                  <WinLossStreakTimelineChart trades={runtimeTradePoints} />
                </ChartPanel>

                <ChartPanel
                  title="P&L Distribution"
                  subtitle="trade result buckets"
                >
                  <PnlDistributionChart bins={pnlDistributionBins} />
                </ChartPanel>

                <ChartPanel title="P&L by Time of Day / Session" subtitle="UTC">
                  <TimeOfDaySessionChart
                    sessions={sessionPnlStats}
                    hours={hourlyPnlStats}
                  />
                </ChartPanel>
              </Flex>

              <Flex direction="column" gap={4}>
                {renderPnlRanking({
                  title: 'P&L Ranking',
                  subtitle: 'Top 10 contracts',
                  ranking: topSymbolPnlRanking,
                  maxAbsPnl: symbolRankingMaxAbsPnl,
                })}
                {renderPnlRanking({
                  title: 'Worst Contracts',
                  subtitle: 'Worst 10 contracts',
                  ranking: worstSymbolPnlRanking,
                  maxAbsPnl: symbolRankingMaxAbsPnl,
                })}
              </Flex>

              {symbolConcentration.length ? (
                <Box
                  p={4}
                  borderWidth="1px"
                  borderColor="gray.800"
                  borderRadius="md"
                  bg="gray.900"
                >
                  <Flex justify="space-between" align="baseline" mb={3}>
                    <Text fontSize="sm" color="gray.300" fontWeight="semibold">
                      Symbol Concentration
                    </Text>
                    <Text fontSize="xs" color="gray.600" textAlign="right">
                      absolute P&L and order share
                    </Text>
                  </Flex>

                  <Flex direction="column" gap={2}>
                    {symbolConcentration.map((row) => (
                      <Box
                        key={row.symbol}
                        p={3}
                        borderWidth="1px"
                        borderColor="gray.800"
                        borderRadius="md"
                        bg="blackAlpha.300"
                      >
                        <Flex justify="space-between" align="center" gap={3}>
                          <Box minW="0">
                            <Text
                              color="gray.100"
                              fontSize="sm"
                              fontWeight="bold"
                            >
                              {row.symbol}
                            </Text>
                            <Text
                              mt={1}
                              color="gray.500"
                              fontSize="xs"
                              fontFamily="mono"
                            >
                              {formatInteger(row.orders)} trades / order share{' '}
                              {formatPercent(row.orderShare)}
                            </Text>
                          </Box>
                          <Box textAlign="right" flexShrink={0}>
                            <Text
                              color={getPnlColor(row.pnl)}
                              fontSize="sm"
                              fontWeight="bold"
                              fontFamily="mono"
                            >
                              {formatSignedNumber(row.pnl)}
                            </Text>
                            <Text
                              mt={1}
                              color="gray.400"
                              fontSize="xs"
                              fontFamily="mono"
                            >
                              abs {formatPercent(row.absPnlShare)}
                            </Text>
                          </Box>
                        </Flex>
                      </Box>
                    ))}
                  </Flex>
                </Box>
              ) : null}

              <Box
                p={4}
                borderWidth="1px"
                borderColor="gray.800"
                borderRadius="md"
                bg="gray.900"
              >
                <Text
                  fontSize="sm"
                  color="gray.300"
                  fontWeight="semibold"
                  mb={3}
                >
                  LONG / SHORT
                </Text>
                <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
                  {directionStats.map((group) => {
                    const ordersWithPnl = group.closed + group.active;
                    const winRate =
                      ordersWithPnl > 0
                        ? (group.wins / ordersWithPnl) * 100
                        : null;

                    return (
                      <Box
                        key={group.direction}
                        p={3}
                        borderWidth="1px"
                        borderColor="gray.800"
                        borderRadius="md"
                        bg="blackAlpha.300"
                      >
                        <Flex justify="space-between" align="center" mb={3}>
                          <Text
                            fontSize="sm"
                            color={
                              group.direction === 'LONG'
                                ? 'teal.400'
                                : 'pink.300'
                            }
                            fontWeight="bold"
                          >
                            {group.direction}
                          </Text>
                          {!group.orders ? (
                            <Text fontSize="xs" color="gray.500">
                              no data
                            </Text>
                          ) : null}
                        </Flex>

                        <SimpleGrid columns={1} gap={2}>
                          {[
                            ['Orders', formatInteger(group.orders), 'neutral'],
                            ['Active', formatInteger(group.active), 'warning'],
                            ['Closed', formatInteger(group.closed), 'neutral'],
                            ['Win rate', formatPercent(winRate), 'neutral'],
                            [
                              'P&L',
                              formatSignedNumber(group.pnl),
                              group.pnl > 0
                                ? 'success'
                                : group.pnl < 0
                                  ? 'error'
                                  : 'neutral',
                            ],
                            [
                              'Avg Profit',
                              formatSignedNumber(group.avgPnl),
                              (group.avgPnl ?? 0) > 0
                                ? 'success'
                                : (group.avgPnl ?? 0) < 0
                                  ? 'error'
                                  : 'neutral',
                            ],
                          ].map(([label, value, level]) => (
                            <Flex
                              key={label}
                              justify="space-between"
                              align="baseline"
                              gap={3}
                            >
                              <Text fontSize="xs" color="gray.500">
                                {label}
                              </Text>
                              <Text
                                fontSize="sm"
                                color={getMetricColor(level as ThresholdLevel)}
                                fontFamily="mono"
                                fontWeight="semibold"
                                textAlign="right"
                              >
                                {value}
                              </Text>
                            </Flex>
                          ))}
                        </SimpleGrid>
                      </Box>
                    );
                  })}
                </SimpleGrid>
              </Box>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
