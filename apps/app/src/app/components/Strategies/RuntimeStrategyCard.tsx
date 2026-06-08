'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { getFormatted } from '@tradejs/core/backtest';
import type { TestThresholdsKey, ThresholdLevel } from '@tradejs/types';
import {
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatFee,
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
  OrdersDrawerPanel,
  type OrdersDrawerOrder,
  type OrdersDrawerSummaryItem,
} from '#components/Shared/OrdersDrawer';
import type { RuntimeStrategyView } from '#app/lib/runtimeStrategies';
import { RuntimeStrategyChart } from './RuntimeStrategyChart';

type RuntimeOrderView = RuntimeStrategyView['orders'][number];
const RUNTIME_ORDER_ROW_HEIGHT = 306;

const getColorByLevel = (level: ThresholdLevel) => {
  switch (level) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
    case 'neutral':
      return 'gray.300';
    case 'error':
    default:
      return 'fg.error';
  }
};

const StatItem = ({
  stat,
  id,
  title,
}: {
  stat: RuntimeStrategyView['stat'];
  id: TestThresholdsKey;
  title: string;
}) => {
  const { formatted, level } = getFormatted(stat, id);

  return (
    <Stat.Root size="md">
      <Stat.Label>{title}</Stat.Label>
      <Stat.ValueText color={getColorByLevel(level)}>
        {formatted}
      </Stat.ValueText>
    </Stat.Root>
  );
};

const getOrderAccentColor = (order: RuntimeOrderView) => {
  if (order.status === 'active') {
    return 'orange.300';
  }

  if (typeof order.pnl !== 'number' || !Number.isFinite(order.pnl)) {
    return 'gray.600';
  }

  return order.pnl >= 0 ? 'teal.300' : 'red.300';
};

const formatExitType = (order: RuntimeOrderView) => {
  if (order.status === 'active') {
    return 'active';
  }

  return order.exitType ? order.exitType.toUpperCase() : 'closed';
};

const formatOrderReference = (orderId: string) => {
  const normalized = orderId.trim();
  const separatorIndex = normalized.indexOf('--');
  const suffix =
    separatorIndex >= 0 ? normalized.slice(separatorIndex + 2) : normalized;

  return suffix.length > 12 ? suffix.slice(-12) : suffix || 'n/a';
};

const RiskLevelsDetail = ({ order }: { order: RuntimeOrderView }) => (
  <Box>
    <Text>
      TP {formatCompactNumber(order.takeProfitPrice)} (
      {formatPercent(order.takeProfitPercent, { signed: true })})
    </Text>
    <Text>
      SL {formatCompactNumber(order.stopLossPrice)} (
      {formatPercent(order.stopLossPercent)})
    </Text>
  </Box>
);

const FeesDetail = ({ order }: { order: RuntimeOrderView }) => (
  <Box>
    <Text>open {formatFee(order.openFee)}</Text>
    <Text>close {formatFee(order.closeFee)}</Text>
    <Text>funding {formatFee(order.fundingFee)}</Text>
  </Box>
);

const getOrdersSummary = (orders: RuntimeOrderView[]) => {
  const closedOrders = orders.filter((order) => order.status === 'closed');
  const winningOrders = closedOrders.filter(
    (order) =>
      typeof order.pnl === 'number' &&
      Number.isFinite(order.pnl) &&
      order.pnl > 0,
  );

  const sumPnl = (direction: RuntimeOrderView['direction']) =>
    closedOrders.reduce((total, order) => {
      if (
        order.direction !== direction ||
        typeof order.pnl !== 'number' ||
        !Number.isFinite(order.pnl)
      ) {
        return total;
      }

      return total + order.pnl;
    }, 0);

  return {
    closedOrders: closedOrders.length,
    winRate:
      closedOrders.length > 0
        ? (winningOrders.length / closedOrders.length) * 100
        : 0,
    longPnl: sumPnl('LONG'),
    shortPnl: sumPnl('SHORT'),
  };
};

const getRuntimeOrdersSummaryItems = (
  orders: RuntimeOrderView[],
): OrdersDrawerSummaryItem[] => {
  const summary = getOrdersSummary(orders);

  return [
    {
      title: 'Total Closed Orders',
      value: formatInteger(summary.closedOrders),
    },
    {
      title: 'Win Rate',
      value: formatPercent(summary.winRate, { signed: false }),
    },
    {
      title: 'P&L of Closed Long Orders (USDT)',
      value: formatSignedNumber(summary.longPnl),
      color: getPnlColor(summary.longPnl),
    },
    {
      title: 'P&L of Closed Short Orders (USDT)',
      value: formatSignedNumber(summary.shortPnl),
      color: getPnlColor(summary.shortPnl),
    },
  ];
};

const mapRuntimeOrder = (order: RuntimeOrderView): OrdersDrawerOrder => {
  const orderDate = order.exitTimestamp ?? order.entryTimestamp;
  const displayEntryPrice = order.actualEntryPrice ?? order.entryPrice;
  const displayExitPrice =
    order.status === 'active'
      ? order.currentPrice
      : order.actualExitPrice ?? order.exitPrice;

  return {
    id: order.orderId,
    title: order.symbol,
    subtitle: `opened ${formatDateTime(order.entryTimestamp)}`,
    direction: order.direction,
    statusLabel: order.status === 'active' ? 'ACTIVE' : undefined,
    statusColor: order.status === 'active' ? 'orange' : undefined,
    pnl: order.pnl,
    accentColor: getOrderAccentColor(order),
    metrics: [
      {
        title: 'Entry',
        value: formatCompactNumber(displayEntryPrice),
        detail:
          order.actualEntryPrice == null
            ? 'actual n/a'
            : `plan ${formatCompactNumber(order.entryPrice)} / slip ${formatPercent(order.entrySlippagePercent, { signed: true })}`,
      },
      {
        title: order.status === 'active' ? 'Current' : 'Exit',
        value: formatCompactNumber(displayExitPrice),
        detail:
          order.status === 'active' ? (
            <RiskLevelsDetail order={order} />
          ) : (
            `slip ${formatPercent(order.exitSlippagePercent, { signed: true })}`
          ),
      },
      {
        title: 'Duration',
        value: formatDuration(order.durationHours),
        detail: formatDateTime(orderDate),
      },
      {
        title: 'Fees',
        value: formatFee(order.totalFee),
        detail: <FeesDetail order={order} />,
      },
      {
        title: 'Reason',
        value: formatExitType(order),
        color: order.status === 'active' ? 'orange.300' : 'gray.300',
      },
      {
        title: 'Qty',
        value: formatCompactNumber(order.qty),
        detail: `ref ${formatOrderReference(order.orderId)}`,
      },
    ],
  };
};

export const RuntimeStrategyCard = ({
  strategy,
  provider,
}: {
  strategy: RuntimeStrategyView;
  provider: string;
}) => {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const lastTrade = strategy.recentTrades[0];
  const symbolsLabel =
    strategy.symbols.length > 3
      ? `${strategy.symbols.slice(0, 3).join(', ')} +${strategy.symbols.length - 3}`
      : strategy.symbols.join(', ') || 'n/a';

  return (
    <Box
      p={2}
      mb={4}
      maxW="1400px"
      borderRadius="md"
      shadow="sm"
      borderWidth="1px"
      borderColor={strategy.connected ? 'gray.800' : 'orange.900'}
      overflowX="auto"
    >
      <Flex gap="4" p={4} mb={3} alignItems="center" wrap="wrap">
        <Text fontSize="lg" fontWeight="bold" color="gray.200">
          {strategy.strategyName}
        </Text>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            connector:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {provider}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            symbols:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {symbolsLabel}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            trades:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {strategy.summary.totalTrades}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            active:
          </Text>
          <Text
            fontSize="lg"
            fontWeight="bold"
            color={
              strategy.summary.activeTrades > 0 ? 'orange.300' : 'gray.200'
            }
          >
            {strategy.summary.activeTrades}
          </Text>
        </Flex>

        <Flex ml="auto" gap={3} alignItems="center">
          <Text fontSize="sm" color="gray.500">
            {lastTrade
              ? `last trade: ${lastTrade.symbol} ${formatDateTime(lastTrade.entryTimestamp)}`
              : strategy.connected
                ? 'connected, no runtime trades yet'
                : 'runtime trades only'}
          </Text>

          <Menu.Root positioning={{ placement: 'bottom-end' }}>
            <Menu.Trigger asChild>
              <Button size="sm" variant="outline">
                Actions
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="160px">
                  <Menu.Item value="orders" onClick={() => setOrdersOpen(true)}>
                    Orders
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>
      </Flex>

      <OrdersDrawerPanel
        title={`${strategy.strategyName} orders`}
        open={ordersOpen}
        orders={strategy.orders.map(mapRuntimeOrder)}
        summaryItems={getRuntimeOrdersSummaryItems(strategy.orders)}
        rowHeight={RUNTIME_ORDER_ROW_HEIGHT}
        onOpenChange={setOrdersOpen}
      />

      <RuntimeStrategyChart orderLog={strategy.orderLog} stat={strategy.stat} />

      <SimpleGrid columns={{ base: 4, md: 8 }} p={4}>
        <StatItem stat={strategy.stat} id="netProfit" title="P&L" />
        <StatItem stat={strategy.stat} id="minAmount" title="Min Amount" />
        <StatItem stat={strategy.stat} id="maxDrawdown" title="Drawdown" />
        <StatItem stat={strategy.stat} id="orders" title="Orders" />
        <StatItem stat={strategy.stat} id="winRate" title="Win Rate" />
        <StatItem
          stat={strategy.stat}
          id="riskRewardRatio"
          title="Risk Ratio"
        />
        <StatItem stat={strategy.stat} id="sharpeRatio" title="Sharpe" />
        <StatItem stat={strategy.stat} id="exposure" title="Exposure" />
      </SimpleGrid>
    </Box>
  );
};
