'use client';

import {
  Box,
  CloseButton,
  Drawer,
  Flex,
  Portal,
  SimpleGrid,
  Text,
} from '@chakra-ui/react';
import type { StrategyChartSnapshot } from '@tradejs/types';
import {
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
} from '#components/Shared/OrdersDrawer';
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
  buildStrategySnapshotCardViewModel,
  getMetricColor,
  getPnlBarColor,
  type AiDiagnosticGroup,
  type AiDiagnosticMetric,
  type SymbolPnlRank,
} from './StrategySnapshotCard.presenter';

type StrategySnapshotCardViewModel = ReturnType<
  typeof buildStrategySnapshotCardViewModel
>;

const AiDiagnosticCard = ({ metric }: { metric: AiDiagnosticMetric }) => (
  <Box
    p={3}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="blackAlpha.200"
    minW="0"
  >
    <Text
      fontSize="2xs"
      color="gray.500"
      fontWeight="bold"
      textTransform="uppercase"
      lineHeight="1.2"
    >
      {metric.label}
    </Text>
    <Text
      mt={2}
      fontSize="lg"
      color={getMetricColor(metric.tone)}
      fontWeight="bold"
      fontFamily="mono"
      lineHeight="1.15"
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      {metric.value}
    </Text>
    {metric.detail ? (
      <Text
        mt={2}
        fontSize="xs"
        color="gray.500"
        lineHeight="1.25"
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {metric.detail}
      </Text>
    ) : null}
  </Box>
);

const AiDiagnosticGroupBlock = ({ group }: { group: AiDiagnosticGroup }) => (
  <Box>
    <Flex justify="space-between" align="baseline" gap={3} mb={3}>
      <Text color="gray.300" fontSize="sm" fontWeight="semibold">
        {group.title}
      </Text>
      <Text color="gray.600" fontSize="xs" textAlign="right">
        {group.description}
      </Text>
    </Flex>
    <SimpleGrid
      columns={{ base: 1, md: Math.min(group.columns, 3), xl: group.columns }}
      gap={3}
    >
      {group.metrics.map((metric) => (
        <AiDiagnosticCard key={metric.id} metric={metric} />
      ))}
    </SimpleGrid>
  </Box>
);

const AiDiagnosticsPanel = ({ groups }: { groups: AiDiagnosticGroup[] }) => {
  if (!groups.length) {
    return null;
  }

  return (
    <Box
      p={4}
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="md"
      bg="gray.900"
    >
      <Flex justify="space-between" align="baseline" gap={4}>
        <Text fontSize="md" fontWeight="semibold" color="gray.100">
          AI diagnostics
        </Text>
        <Text color="gray.600" fontSize="xs" textAlign="right">
          classifier-only details
        </Text>
      </Flex>
      <Flex direction="column" gap={5} mt={4}>
        {groups.map((group) => (
          <AiDiagnosticGroupBlock key={group.id} group={group} />
        ))}
      </Flex>
    </Box>
  );
};

export const StrategySnapshotCardDetailsDrawer = ({
  snapshot,
  mode,
  open,
  onOpenChange,
  viewModel,
}: {
  snapshot: StrategyChartSnapshot;
  mode: 'replay' | 'ai';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewModel: StrategySnapshotCardViewModel;
}) => {
  const {
    aiDiagnosticGroups,
    directionStatGroups,
    topSymbolPnlRanking,
    worstSymbolPnlRanking,
    symbolRankingMaxAbsPnl,
    drawerMetrics,
    advancedMetrics,
  } = viewModel;
  const {
    monthlyStats,
    tradePoints: snapshotTradePoints,
    drawdownPoints,
    rollingPerformancePoints,
    pnlDistributionBins,
    sessionPnlStats,
    hourlyPnlStats,
  } = viewModel.performance;

  const renderSymbolPnlRanking = ({
    title,
    subtitle,
    ranking,
  }: {
    title: string;
    subtitle: string;
    ranking: SymbolPnlRank[];
  }) => (
    <Box
      p={4}
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="md"
      bg="gray.900"
    >
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="sm" color="gray.300" fontWeight="semibold">
          {title}
        </Text>
        <Text fontSize="xs" color="gray.500">
          {subtitle}
        </Text>
      </Flex>

      {ranking.length ? (
        <>
          <Flex align="center" gap={4} mb={2}>
            <Text
              flex="0 0 220px"
              fontSize="xs"
              color="gray.500"
              fontWeight="semibold"
            >
              Contracts
            </Text>
            <Box flex="1" />
            <Text
              flex="0 0 96px"
              fontSize="xs"
              color="gray.500"
              fontWeight="semibold"
              textAlign="right"
            >
              P&L (USDT)
            </Text>
          </Flex>

          <Flex direction="column" gap={3}>
            {ranking.map((rank) => {
              const barWidth = Math.max(
                6,
                (Math.abs(rank.pnl) / symbolRankingMaxAbsPnl) * 100,
              );

              return (
                <Flex key={rank.symbol} align="center" gap={4} minH="34px">
                  <Box flex="0 0 220px" minW={0}>
                    <Text
                      fontSize="sm"
                      color="gray.100"
                      fontWeight="semibold"
                      lineHeight="1.2"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {rank.symbol}
                    </Text>
                    <Text
                      mt={1}
                      fontSize="xs"
                      color="gray.500"
                      fontFamily="mono"
                    >
                      {formatInteger(rank.orders)} orders · win{' '}
                      {formatPercent(rank.winRate)} · avg{' '}
                      {rank.avgPnl == null
                        ? 'n/a'
                        : formatSignedNumber(rank.avgPnl)}
                    </Text>
                  </Box>

                  <Box flex="1" h="12px" bg="gray.800">
                    <Box
                      h="full"
                      w={`${barWidth}%`}
                      bg={getPnlBarColor(rank.pnl)}
                    />
                  </Box>

                  <Text
                    flex="0 0 96px"
                    color={getPnlColor(rank.pnl)}
                    fontSize="lg"
                    fontFamily="mono"
                    fontWeight="bold"
                    textAlign="right"
                  >
                    {formatSignedNumber(rank.pnl)}
                  </Text>
                </Flex>
              );
            })}
          </Flex>
        </>
      ) : (
        <Box
          p={3}
          borderWidth="1px"
          borderColor="gray.800"
          borderRadius="md"
          bg="blackAlpha.300"
        >
          <Text fontSize="sm" color="gray.500">
            No symbol P&L data
          </Text>
        </Box>
      )}
    </Box>
  );

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
              <Drawer.Title>{snapshot.title}</Drawer.Title>
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
              <Box
                p={4}
                borderWidth="1px"
                borderColor="gray.800"
                borderRadius="md"
                bg="gray.900"
              >
                <Text fontSize="sm" color="gray.500" mb={3}>
                  {snapshot.subtitle || 'AI train details'}
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
                        color={getMetricColor(metric.tone)}
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

              {mode === 'ai' ? (
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
                    <RollingPerformanceChart
                      points={rollingPerformancePoints}
                    />
                  </ChartPanel>

                  <ChartPanel
                    title="Win / Loss Streak Timeline"
                    subtitle="trade sequence"
                  >
                    <WinLossStreakTimelineChart trades={snapshotTradePoints} />
                  </ChartPanel>

                  <ChartPanel
                    title="P&L Distribution"
                    subtitle="trade result buckets"
                  >
                    <PnlDistributionChart bins={pnlDistributionBins} />
                  </ChartPanel>

                  <ChartPanel
                    title="P&L by Time of Day / Session"
                    subtitle="UTC"
                  >
                    <TimeOfDaySessionChart
                      sessions={sessionPnlStats}
                      hours={hourlyPnlStats}
                    />
                  </ChartPanel>
                </Flex>
              ) : null}

              {mode === 'ai' ? (
                <Flex direction="column" gap={4}>
                  {renderSymbolPnlRanking({
                    title: 'P&L Ranking',
                    subtitle: 'Top 10 contracts',
                    ranking: topSymbolPnlRanking,
                  })}
                  {renderSymbolPnlRanking({
                    title: 'Worst Contracts',
                    subtitle: 'Worst 10 contracts',
                    ranking: worstSymbolPnlRanking,
                  })}
                </Flex>
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
                  {directionStatGroups.map((group) => (
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
                            group.direction === 'LONG' ? 'teal.400' : 'pink.300'
                          }
                          fontWeight="bold"
                        >
                          {group.direction}
                        </Text>
                        {!group.hasData ? (
                          <Text fontSize="xs" color="gray.500">
                            no data
                          </Text>
                        ) : null}
                      </Flex>

                      <SimpleGrid columns={1} gap={2}>
                        {group.metrics.map((metric) => (
                          <Flex
                            key={metric.id}
                            justify="space-between"
                            align="baseline"
                            gap={3}
                          >
                            <Text fontSize="xs" color="gray.500">
                              {metric.label}
                            </Text>
                            <Text
                              fontSize="sm"
                              color={getMetricColor(metric.tone)}
                              fontFamily="mono"
                              fontWeight="semibold"
                              textAlign="right"
                            >
                              {metric.value}
                            </Text>
                          </Flex>
                        ))}
                      </SimpleGrid>
                    </Box>
                  ))}
                </SimpleGrid>
              </Box>

              <AiDiagnosticsPanel groups={aiDiagnosticGroups} />
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
