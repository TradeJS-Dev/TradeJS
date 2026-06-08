'use client';

import { type ReactNode, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Drawer,
  Flex,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { getFormatted } from '@tradejs/core/backtest';
import type { TestThresholdsKey } from '@tradejs/types';
import type { RuntimeStrategyView } from '#app/lib/runtimeStrategies';
import { RuntimeStrategyChart } from './RuntimeStrategyChart';

const getColorByLevel = (level: 'success' | 'warning' | 'error') => {
  switch (level) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
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

const formatDateTime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return new Date(value).toLocaleString('ru-RU');
};

const formatSignedNumber = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${value > 0 ? '+' : ''}${value.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
};

const formatCompactNumber = (
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return value.toLocaleString('ru-RU', {
    maximumFractionDigits: 8,
    ...options,
  });
};

const formatDuration = (hours: number | null | undefined) => {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) {
    return 'n/a';
  }

  if (hours < 24) {
    return `${formatCompactNumber(hours, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    })}h`;
  }

  const days = Math.floor(hours / 24);
  const remainderHours = Math.round(hours % 24);
  return `${days}d ${remainderHours}h`;
};

const formatFee = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatCompactNumber(value, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  })} USDT`;
};

const formatPercent = (
  value: number | null | undefined,
  { signed = false }: { signed?: boolean } = {},
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}%`;
};

const getPnlColor = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    return 'gray.300';
  }

  return value > 0 ? 'teal.300' : 'red.300';
};

const getOrderAccentColor = (order: RuntimeStrategyView['orders'][number]) => {
  if (order.status === 'active') {
    return 'orange.300';
  }

  if (typeof order.pnl !== 'number' || !Number.isFinite(order.pnl)) {
    return 'gray.600';
  }

  return order.pnl >= 0 ? 'teal.300' : 'red.300';
};

const getDirectionPalette = (
  direction: RuntimeStrategyView['orders'][number]['direction'],
) => (direction === 'LONG' ? 'teal' : 'red');

const formatExitType = (order: RuntimeStrategyView['orders'][number]) => {
  if (order.status === 'active') {
    return 'active';
  }

  return order.exitType ? order.exitType.toUpperCase() : 'closed';
};

const OrderMetric = ({
  title,
  value,
  detail,
  color = 'gray.300',
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  color?: string;
}) => (
  <Box minW="0">
    <Text
      fontSize="2xs"
      color="gray.500"
      textTransform="uppercase"
      fontWeight="bold"
    >
      {title}
    </Text>
    <Text
      mt={1}
      color={color}
      fontSize="sm"
      fontWeight="semibold"
      fontFamily="mono"
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      {value}
    </Text>
    {detail ? (
      <Text
        mt={1}
        color="gray.500"
        fontSize="xs"
        lineHeight="1.3"
        wordBreak="break-word"
      >
        {detail}
      </Text>
    ) : null}
  </Box>
);

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

      <Drawer.Root
        size="xl"
        open={ordersOpen}
        onOpenChange={(e) => setOrdersOpen(e.open)}
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
                <Drawer.Title>{strategy.strategyName} orders</Drawer.Title>
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
              </Drawer.Header>

              <Drawer.Body overflowY="auto">
                {strategy.orders.length === 0 ? (
                  <Box
                    p={4}
                    borderWidth="1px"
                    borderColor="gray.800"
                    borderRadius="md"
                  >
                    <Text fontSize="sm" color="gray.400">
                      No orders for the selected period.
                    </Text>
                  </Box>
                ) : (
                  <Box display="flex" flexDirection="column" gap={3}>
                    {strategy.orders.map((order) => {
                      const orderDate =
                        order.exitTimestamp ?? order.entryTimestamp;
                      const accentColor = getOrderAccentColor(order);
                      const displayEntryPrice =
                        order.actualEntryPrice ?? order.entryPrice;
                      const displayExitPrice =
                        order.status === 'active'
                          ? order.currentPrice
                          : order.actualExitPrice ?? order.exitPrice;

                      return (
                        <Box
                          key={order.orderId}
                          p={0}
                          borderWidth="1px"
                          borderColor="gray.800"
                          borderLeftWidth="4px"
                          borderLeftColor={accentColor}
                          borderRadius="md"
                          bg="gray.950"
                          overflow="hidden"
                        >
                          <Flex
                            px={4}
                            py={3}
                            alignItems="center"
                            justifyContent="space-between"
                            gap={4}
                            borderBottomWidth="1px"
                            borderBottomColor="gray.800"
                          >
                            <Box minW="0" flex="1">
                              <Flex alignItems="center" gap={2} wrap="wrap">
                                <Text
                                  fontSize="md"
                                  fontWeight="bold"
                                  color="gray.100"
                                  lineHeight="1.2"
                                >
                                  {order.symbol}
                                </Text>
                                <Badge
                                  colorPalette={getDirectionPalette(
                                    order.direction,
                                  )}
                                  variant="subtle"
                                  fontFamily="mono"
                                  letterSpacing="0"
                                >
                                  {order.direction}
                                </Badge>
                                {order.status === 'active' ? (
                                  <Badge
                                    colorPalette="orange"
                                    variant="subtle"
                                    fontFamily="mono"
                                    letterSpacing="0"
                                  >
                                    ACTIVE
                                  </Badge>
                                ) : null}
                              </Flex>
                              <Text
                                mt={1}
                                color="gray.500"
                                fontSize="xs"
                                lineHeight="1.2"
                              >
                                opened {formatDateTime(order.entryTimestamp)}
                              </Text>
                            </Box>

                            <Flex
                              justifyContent="flex-end"
                              alignItems="baseline"
                              gap={2}
                              flex="0 0 auto"
                              minW="max-content"
                              whiteSpace="nowrap"
                            >
                              <Text
                                fontSize="xs"
                                color="gray.500"
                                textTransform="uppercase"
                              >
                                P&amp;L
                              </Text>
                              <Text
                                color={getPnlColor(order.pnl)}
                                fontWeight="bold"
                                fontSize="xl"
                                fontFamily="mono"
                                lineHeight="1.2"
                                whiteSpace="nowrap"
                              >
                                {formatSignedNumber(order.pnl)}
                              </Text>
                            </Flex>
                          </Flex>

                          <SimpleGrid
                            px={4}
                            py={4}
                            columns={{ base: 2, md: 3 }}
                            columnGap={6}
                            rowGap={4}
                          >
                            <OrderMetric
                              title="Entry"
                              value={formatCompactNumber(displayEntryPrice)}
                              detail={
                                order.actualEntryPrice == null
                                  ? 'actual n/a'
                                  : `plan ${formatCompactNumber(order.entryPrice)} / slip ${formatPercent(order.entrySlippagePercent, { signed: true })}`
                              }
                            />
                            <OrderMetric
                              title={
                                order.status === 'active' ? 'Current' : 'Exit'
                              }
                              value={formatCompactNumber(displayExitPrice)}
                              detail={
                                order.status === 'active'
                                  ? `TP ${formatPercent(order.takeProfitPercent, { signed: true })} / SL ${formatPercent(order.stopLossPercent)}`
                                  : `slip ${formatPercent(order.exitSlippagePercent, { signed: true })}`
                              }
                            />
                            <OrderMetric
                              title="Duration"
                              value={formatDuration(order.durationHours)}
                              detail={formatDateTime(orderDate)}
                            />
                            <OrderMetric
                              title="Fees"
                              value={formatFee(order.totalFee)}
                              detail={`open ${formatFee(order.openFee)} / close ${formatFee(order.closeFee)} / funding ${formatFee(order.fundingFee)}`}
                            />
                            <OrderMetric
                              title="Reason"
                              value={formatExitType(order)}
                              color={
                                order.status === 'active'
                                  ? 'orange.300'
                                  : 'gray.300'
                              }
                            />
                            <OrderMetric
                              title="Qty"
                              value={formatCompactNumber(order.qty)}
                              detail={`id ${order.orderId.slice(0, 12)}`}
                            />
                          </SimpleGrid>
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>

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
