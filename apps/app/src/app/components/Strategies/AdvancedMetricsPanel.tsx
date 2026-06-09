'use client';

import { Box, Flex, Grid, SimpleGrid, Text } from '@chakra-ui/react';
import type { AdvancedTradeMetrics } from '@tradejs/core/backtest';
import {
  formatCompactNumber,
  formatFee,
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
} from '#components/Shared/OrdersDrawer';

type MetricTone = 'amount' | 'positive' | 'negative' | 'warning' | 'neutral';
type MetricVariant = 'default' | 'primary';

interface MetricItem {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: MetricTone;
  numericValue?: number | null;
  variant?: MetricVariant;
}

interface MetricGroup {
  id: string;
  title: string;
  description?: string;
  metrics: MetricItem[];
}

interface MetricSection {
  id: string;
  title: string;
  subtitle: string;
  groups: MetricGroup[];
  quarterlyPnl?: AdvancedTradeMetrics['stability']['quarterlyPnl'];
}

const getAmountLabel = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${formatSignedNumber(value)} USDT`
    : 'n/a';

const getPlainAmountLabel = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${formatCompactNumber(value, { maximumFractionDigits: 2 })} USDT`
    : 'n/a';

const getRatioLabel = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${formatCompactNumber(value, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })}x`
    : 'n/a';

const getNumberLabel = (value: number | null | undefined) =>
  formatCompactNumber(value, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

const getMetricColor = (item: MetricItem) => {
  if (item.tone === 'amount') {
    return getPnlColor(item.numericValue);
  }

  if (item.tone === 'positive') {
    return 'teal.300';
  }

  if (item.tone === 'negative') {
    return 'red.300';
  }

  if (item.tone === 'warning') {
    return 'orange.300';
  }

  return item.variant === 'primary' ? 'gray.100' : 'gray.200';
};

const amountMetric = (
  id: string,
  label: string,
  value: number | null | undefined,
  options: Partial<MetricItem> = {},
): MetricItem => ({
  id,
  label,
  value: getAmountLabel(value),
  tone: 'amount',
  numericValue: value,
  ...options,
});

const plainAmountMetric = (
  id: string,
  label: string,
  value: number | null | undefined,
  options: Partial<MetricItem> = {},
): MetricItem => ({
  id,
  label,
  value: getPlainAmountLabel(value),
  numericValue: value,
  ...options,
});

const MetricCard = ({ item }: { item: MetricItem }) => {
  const isPrimary = item.variant === 'primary';

  return (
    <Box
      borderWidth="1px"
      borderColor={isPrimary ? 'teal.900' : 'gray.800'}
      borderRadius="md"
      bg={isPrimary ? 'teal.950' : 'blackAlpha.200'}
      minW="0"
      px={4}
      py={3}
    >
      <Text
        color="gray.500"
        fontSize="2xs"
        fontWeight="bold"
        textTransform="uppercase"
        lineHeight="1.2"
      >
        {item.label}
      </Text>
      <Text
        mt={2}
        color={getMetricColor(item)}
        fontSize={isPrimary ? 'xl' : 'lg'}
        fontWeight="bold"
        fontFamily="mono"
        lineHeight="1"
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {item.value}
      </Text>
      {item.detail ? (
        <Text
          mt={2}
          color="gray.500"
          fontSize="xs"
          lineHeight="1.25"
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {item.detail}
        </Text>
      ) : null}
    </Box>
  );
};

const MetricGroupBlock = ({ group }: { group: MetricGroup }) => (
  <Box minW="0">
    <Flex justify="space-between" align="baseline" gap={3} mb={3}>
      <Text color="gray.300" fontSize="sm" fontWeight="semibold">
        {group.title}
      </Text>
      {group.description ? (
        <Text color="gray.600" fontSize="xs" textAlign="right">
          {group.description}
        </Text>
      ) : null}
    </Flex>
    <SimpleGrid columns={{ base: 2, xl: 3 }} gap={3}>
      {group.metrics.map((item) => (
        <MetricCard key={item.id} item={item} />
      ))}
    </SimpleGrid>
  </Box>
);

const QuarterlyPnlGrid = ({
  quarterlyPnl,
}: {
  quarterlyPnl: AdvancedTradeMetrics['stability']['quarterlyPnl'];
}) => {
  if (!quarterlyPnl.length) {
    return null;
  }

  return (
    <Box mt={4}>
      <Flex justify="space-between" align="baseline" gap={3} mb={3}>
        <Text color="gray.300" fontSize="sm" fontWeight="semibold">
          Quarterly P&L
        </Text>
        <Text color="gray.600" fontSize="xs" textAlign="right">
          grouped by calendar quarter
        </Text>
      </Flex>
      <Grid templateColumns={{ base: '1fr 1fr', xl: 'repeat(3, 1fr)' }} gap={2}>
        {quarterlyPnl.map((quarter) => (
          <Flex
            key={quarter.quarter}
            align="center"
            justify="space-between"
            gap={2}
            borderWidth="1px"
            borderColor="gray.800"
            borderRadius="md"
            bg="blackAlpha.200"
            minW="0"
            px={3}
            py={2}
          >
            <Text color="gray.400" fontSize="xs" fontWeight="semibold">
              {quarter.quarter}
            </Text>
            <Text
              color={getPnlColor(quarter.pnl)}
              fontSize="sm"
              fontWeight="bold"
              fontFamily="mono"
              whiteSpace="nowrap"
            >
              {getAmountLabel(quarter.pnl)}
            </Text>
          </Flex>
        ))}
      </Grid>
    </Box>
  );
};

const MetricsSection = ({ section }: { section: MetricSection }) => (
  <Box
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
    p={4}
  >
    <Flex justify="space-between" align="baseline" gap={4}>
      <Text fontSize="md" fontWeight="semibold" color="gray.100">
        {section.title}
      </Text>
      <Text color="gray.600" fontSize="xs" textAlign="right">
        {section.subtitle}
      </Text>
    </Flex>
    <Flex direction="column" gap={5} mt={4}>
      {section.groups.map((group) => (
        <MetricGroupBlock key={group.id} group={group} />
      ))}
    </Flex>
    <QuarterlyPnlGrid quarterlyPnl={section.quarterlyPnl ?? []} />
  </Box>
);

const buildMetricSections = (
  metrics: AdvancedTradeMetrics,
): MetricSection[] => [
  {
    id: 'overview',
    title: 'Overview',
    subtitle: 'result, quality and trade frequency',
    groups: [
      {
        id: 'result',
        title: 'Result',
        description: 'net outcome of approved trades',
        metrics: [
          amountMetric('totalPnl', 'Total P&L', metrics.core.totalPnl, {
            variant: 'primary',
          }),
          {
            id: 'winrate',
            label: 'Winrate',
            value: formatPercent(metrics.core.winRate),
            variant: 'primary',
          },
          amountMetric('avgTrade', 'Avg trade', metrics.core.avgTrade),
          amountMetric('expectancy', 'Expectancy', metrics.core.expectancy),
        ],
      },
      {
        id: 'edge',
        title: 'Edge quality',
        description: 'profitability per winner vs loser',
        metrics: [
          {
            id: 'profitFactor',
            label: 'Profit factor',
            value: getRatioLabel(metrics.core.profitFactor),
            detail: 'gross profit / gross loss',
          },
          {
            id: 'payoffRatio',
            label: 'Payoff ratio',
            value: getRatioLabel(metrics.core.payoffRatio),
            detail: 'avg win / avg loss',
          },
          plainAmountMetric(
            'grossProfit',
            'Gross profit',
            metrics.core.grossProfit,
            {
              tone: 'positive',
            },
          ),
          plainAmountMetric('grossLoss', 'Gross loss', metrics.core.grossLoss, {
            tone: 'negative',
          }),
        ],
      },
      {
        id: 'cadence',
        title: 'Cadence',
        description: 'how often strategy trades',
        metrics: [
          {
            id: 'trades',
            label: 'Trades',
            value: formatInteger(metrics.core.trades),
          },
          {
            id: 'tradesPerDay',
            label: 'Trades/day',
            value: getNumberLabel(metrics.core.tradesPerDay),
          },
          {
            id: 'tradesPerWeek',
            label: 'Trades/week',
            value: getNumberLabel(metrics.core.tradesPerWeek),
          },
          {
            id: 'winsLosses',
            label: 'Wins / Losses',
            value: `${formatInteger(metrics.core.wins)} / ${formatInteger(metrics.core.losses)}`,
          },
        ],
      },
    ],
  },
  {
    id: 'risk',
    title: 'Risk',
    subtitle: 'drawdown depth, recovery and worst periods',
    groups: [
      {
        id: 'drawdown',
        title: 'Drawdown',
        description: 'peak-to-trough pressure',
        metrics: [
          plainAmountMetric('maxDrawdown', 'MaxDD', metrics.risk.maxDrawdown, {
            detail: formatPercent(metrics.risk.maxDrawdownPercent),
            tone: 'warning',
            variant: 'primary',
          }),
          {
            id: 'recoveryFactor',
            label: 'Recovery factor',
            value: getRatioLabel(metrics.risk.recoveryFactor),
            detail: 'total P&L / MaxDD',
          },
          {
            id: 'maxDrawdownToTotalProfit',
            label: 'MaxDD / Total profit',
            value: getRatioLabel(metrics.risk.maxDrawdownToTotalProfit),
          },
          {
            id: 'maxDrawdownToGrossProfit',
            label: 'MaxDD / Gross profit',
            value: getRatioLabel(metrics.risk.maxDrawdownToGrossProfit),
          },
        ],
      },
      {
        id: 'loss-pressure',
        title: 'Loss pressure',
        description: 'how losses cluster',
        metrics: [
          {
            id: 'maxLossStreak',
            label: 'Max loss streak',
            value: formatInteger(metrics.risk.maxLossStreak),
            tone: metrics.risk.maxLossStreak > 0 ? 'warning' : 'neutral',
          },
          {
            id: 'losingMonthsCount',
            label: 'Losing months',
            value: formatInteger(metrics.risk.losingMonthsCount),
            tone: metrics.risk.losingMonthsCount > 0 ? 'warning' : 'neutral',
          },
          amountMetric(
            'worstMonthPnl',
            'Worst month',
            metrics.risk.worstMonthPnl,
          ),
          amountMetric(
            'worstRolling30dPnl',
            'Worst rolling 30d',
            metrics.risk.worstRolling30dPnl,
          ),
          amountMetric(
            'worstRolling90dPnl',
            'Worst rolling 90d',
            metrics.risk.worstRolling90dPnl,
          ),
        ],
      },
    ],
  },
  {
    id: 'stability',
    title: 'Stability',
    subtitle: 'month-to-month consistency and concentration',
    quarterlyPnl: metrics.stability.quarterlyPnl,
    groups: [
      {
        id: 'calendar',
        title: 'Calendar stability',
        description: 'month and year behavior',
        metrics: [
          {
            id: 'monthlyWinRate',
            label: 'Monthly winrate',
            value: formatPercent(metrics.stability.monthlyWinRate),
          },
          {
            id: 'positiveMonthsPercent',
            label: 'Positive months',
            value: formatPercent(metrics.stability.positiveMonthsPercent),
          },
          amountMetric(
            'rolling365Pnl',
            'YoY rolling 365',
            metrics.stability.rolling365Pnl,
          ),
        ],
      },
      {
        id: 'monthly-spread',
        title: 'Monthly spread',
        description: 'typical month and dispersion',
        metrics: [
          amountMetric(
            'medianMonthlyPnl',
            'Median monthly P&L',
            metrics.stability.medianMonthlyPnl,
          ),
          plainAmountMetric(
            'iqrMonthlyPnl',
            'IQR monthly P&L',
            metrics.stability.iqrMonthlyPnl,
          ),
        ],
      },
      {
        id: 'profit-concentration',
        title: 'Profit concentration',
        description: 'dependency on biggest winners',
        metrics: [
          {
            id: 'top5ProfitShare',
            label: 'Top 5 profit share',
            value: formatPercent(metrics.stability.top5ProfitShare),
          },
          {
            id: 'top10ProfitShare',
            label: 'Top 10 profit share',
            value: formatPercent(metrics.stability.top10ProfitShare),
          },
        ],
      },
    ],
  },
  {
    id: 'distribution',
    title: 'Distribution',
    subtitle: 'shape of individual trade outcomes',
    groups: [
      {
        id: 'typical-trade',
        title: 'Typical trade',
        description: 'central result and quartiles',
        metrics: [
          amountMetric(
            'medianTrade',
            'Median trade',
            metrics.distribution.medianTrade,
            { variant: 'primary' },
          ),
          amountMetric('p25Trade', 'P25 trade', metrics.distribution.p25Trade),
          amountMetric('p75Trade', 'P75 trade', metrics.distribution.p75Trade),
        ],
      },
      {
        id: 'tails',
        title: 'Tails',
        description: 'outliers and asymmetry',
        metrics: [
          amountMetric('p10Trade', 'P10 trade', metrics.distribution.p10Trade),
          amountMetric('p90Trade', 'P90 trade', metrics.distribution.p90Trade),
          amountMetric(
            'largestWin',
            'Largest win',
            metrics.distribution.largestWin,
          ),
          amountMetric(
            'largestLoss',
            'Largest loss',
            metrics.distribution.largestLoss,
          ),
          {
            id: 'tailRatio',
            label: 'Tail ratio',
            value: getRatioLabel(metrics.distribution.tailRatio),
            detail: 'p95 win / abs(p5 loss)',
          },
          {
            id: 'skewness',
            label: 'Skewness',
            value: getNumberLabel(metrics.distribution.skewness),
          },
        ],
      },
    ],
  },
  {
    id: 'riskAdjusted',
    title: 'Risk-adjusted',
    subtitle: 'return normalized by volatility and drawdown',
    groups: [
      {
        id: 'daily-pnl',
        title: 'Daily approved P&L',
        description: 'daily series, not trade-level series',
        metrics: [
          {
            id: 'sharpeDaily',
            label: 'Sharpe',
            value: getNumberLabel(metrics.riskAdjusted.sharpeDaily),
          },
          {
            id: 'sortinoDaily',
            label: 'Sortino',
            value: getNumberLabel(metrics.riskAdjusted.sortinoDaily),
          },
        ],
      },
      {
        id: 'drawdown-adjusted',
        title: 'Drawdown-adjusted',
        description: 'annualized P&L / MaxDD',
        metrics: [
          {
            id: 'calmar',
            label: 'Calmar',
            value: getRatioLabel(metrics.riskAdjusted.calmar),
          },
          {
            id: 'mar',
            label: 'MAR',
            value: getRatioLabel(metrics.riskAdjusted.mar),
          },
        ],
      },
    ],
  },
  {
    id: 'operational',
    title: 'Operational',
    subtitle: 'execution quality, approvals and exposure split',
    groups: [
      {
        id: 'execution',
        title: 'Execution',
        description: 'slippage impact on net P&L',
        metrics: [
          {
            id: 'avgSlippageCost',
            label: 'Avg slippage cost',
            value: formatFee(metrics.operational.avgSlippageCost),
            tone: metrics.operational.avgSlippageCost ? 'warning' : 'neutral',
          },
          amountMetric(
            'pnlBeforeSlippage',
            'P&L before slippage',
            metrics.operational.pnlBeforeSlippage,
          ),
          amountMetric(
            'pnlAfterSlippage',
            'P&L after slippage',
            metrics.operational.pnlAfterSlippage,
          ),
        ],
      },
      {
        id: 'approval',
        title: 'Approval quality',
        description: 'gate decisions and misses',
        metrics: [
          {
            id: 'approvalRate',
            label: 'Approval rate',
            value: formatPercent(metrics.operational.approvalRate),
          },
          {
            id: 'blockedProfitableTrades',
            label: 'Blocked profitable',
            value: formatInteger(metrics.operational.blockedProfitableTrades),
          },
          {
            id: 'approvedLosingTrades',
            label: 'Approved losing',
            value: formatInteger(metrics.operational.approvedLosingTrades),
            tone:
              metrics.operational.approvedLosingTrades > 0
                ? 'warning'
                : 'neutral',
          },
        ],
      },
      {
        id: 'concentration',
        title: 'Concentration',
        description: 'where absolute P&L comes from',
        metrics: [
          {
            id: 'symbolConcentrationTop1',
            label: 'Symbol top 1',
            value: formatPercent(metrics.operational.symbolConcentrationTop1),
          },
          {
            id: 'symbolConcentrationTop5',
            label: 'Symbol top 5',
            value: formatPercent(metrics.operational.symbolConcentrationTop5),
          },
          {
            id: 'sessionConcentrationTop1',
            label: 'Session top 1',
            value: formatPercent(metrics.operational.sessionConcentrationTop1),
          },
        ],
      },
      {
        id: 'direction',
        title: 'Direction split',
        description: 'LONG / SHORT trade count and P&L',
        metrics: [
          {
            id: 'longTrades',
            label: 'LONG trades',
            value: formatInteger(metrics.operational.longTrades),
            detail: getAmountLabel(metrics.operational.longPnl),
            tone: 'positive',
          },
          {
            id: 'shortTrades',
            label: 'SHORT trades',
            value: formatInteger(metrics.operational.shortTrades),
            detail: getAmountLabel(metrics.operational.shortPnl),
            tone: 'negative',
          },
        ],
      },
    ],
  },
];

export const AdvancedMetricsPanel = ({
  metrics,
}: {
  metrics: AdvancedTradeMetrics;
}) => (
  <Flex direction="column" gap={4}>
    {buildMetricSections(metrics).map((section) => (
      <MetricsSection key={section.id} section={section} />
    ))}
  </Flex>
);
