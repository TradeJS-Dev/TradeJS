'use client';

import { type ReactNode, useCallback } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import {
  Badge,
  Box,
  CloseButton,
  Drawer,
  Flex,
  Portal,
  SimpleGrid,
  Text,
} from '@chakra-ui/react';

export interface OrdersDrawerSummaryItem {
  title: string;
  value: ReactNode;
  color?: string;
}

export interface OrdersDrawerMetric {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  color?: string;
}

export interface OrdersDrawerOrder {
  id: string;
  title: string;
  subtitle?: ReactNode;
  direction?: 'LONG' | 'SHORT' | null;
  statusLabel?: string;
  statusColor?: string;
  pnl?: number | null;
  accentColor?: string;
  metrics: OrdersDrawerMetric[];
}

interface OrdersDrawerPanelProps {
  title: string;
  open: boolean;
  orders: OrdersDrawerOrder[];
  summaryItems?: OrdersDrawerSummaryItem[];
  emptyText?: string;
  rowHeight?: number;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_ROW_HEIGHT = 278;
const ORDER_LIST_OVERSCAN = 4;

export const formatDateTime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return new Date(value).toLocaleString('ru-RU');
};

export const formatSignedNumber = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${value > 0 ? '+' : ''}${value.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
};

export const formatCompactNumber = (
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

export const formatInteger = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return value.toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  });
};

export const formatDuration = (hours: number | null | undefined) => {
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

export const formatFee = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatCompactNumber(value, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  })} USDT`;
};

export const formatPercent = (
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

export const getPnlColor = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    return 'gray.300';
  }

  return value > 0 ? 'teal.300' : 'red.300';
};

const getDirectionPalette = (direction: OrdersDrawerOrder['direction']) =>
  direction === 'LONG' ? 'teal' : 'red';

const OrdersSummaryItem = ({
  title,
  value,
  color = 'gray.100',
}: OrdersDrawerSummaryItem) => (
  <Box minW="0">
    <Text color="gray.500" fontSize="sm" lineHeight="1.25">
      {title}
    </Text>
    <Text
      mt={1}
      color={color}
      fontSize="2xl"
      fontWeight="bold"
      fontFamily="mono"
      lineHeight="1"
      whiteSpace="nowrap"
    >
      {value}
    </Text>
  </Box>
);

const OrdersSummary = ({ items }: { items: OrdersDrawerSummaryItem[] }) => (
  <SimpleGrid
    columns={2}
    columnGap={8}
    rowGap={4}
    px={1}
    pb={4}
    flex="0 0 auto"
  >
    {items.map((item) => (
      <OrdersSummaryItem key={item.title} {...item} />
    ))}
  </SimpleGrid>
);

const OrderMetric = ({
  title,
  value,
  detail,
  color = 'gray.300',
}: OrdersDrawerMetric) => (
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
      <Box
        mt={1}
        color="gray.500"
        fontSize="xs"
        lineHeight="1.3"
        wordBreak="break-word"
      >
        {detail}
      </Box>
    ) : null}
  </Box>
);

const OrderCard = ({ order }: { order: OrdersDrawerOrder }) => {
  const accentColor = order.accentColor ?? getPnlColor(order.pnl);

  return (
    <Box
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
              {order.title}
            </Text>
            {order.direction ? (
              <Badge
                colorPalette={getDirectionPalette(order.direction)}
                variant="subtle"
                fontFamily="mono"
                letterSpacing="0"
              >
                {order.direction}
              </Badge>
            ) : null}
            {order.statusLabel ? (
              <Badge
                colorPalette={order.statusColor ?? 'gray'}
                variant="subtle"
                fontFamily="mono"
                letterSpacing="0"
              >
                {order.statusLabel}
              </Badge>
            ) : null}
          </Flex>
          {order.subtitle ? (
            <Box mt={1} color="gray.500" fontSize="xs" lineHeight="1.2">
              {order.subtitle}
            </Box>
          ) : null}
        </Box>

        <Flex
          justifyContent="flex-end"
          alignItems="baseline"
          gap={2}
          flex="0 0 auto"
          minW="max-content"
          whiteSpace="nowrap"
        >
          <Text fontSize="xs" color="gray.500" textTransform="uppercase">
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

      <SimpleGrid px={4} py={4} columns={3} columnGap={6} rowGap={4}>
        {order.metrics.map((metric) => (
          <OrderMetric key={metric.title} {...metric} />
        ))}
      </SimpleGrid>
    </Box>
  );
};

const OrdersList = ({
  orders,
  rowHeight,
}: {
  orders: OrdersDrawerOrder[];
  rowHeight: number;
}) => {
  const itemKey = useCallback(
    (index: number) => orders[index]?.id ?? String(index),
    [orders],
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const order = orders[index];

      if (!order) {
        return null;
      }

      return (
        <Box style={style} pb={3}>
          <OrderCard order={order} />
        </Box>
      );
    },
    [orders],
  );

  return (
    <Box flex="1" h="full" minH="0" w="full">
      <AutoSizer>
        {({ height, width }) => (
          <FixedSizeList
            height={height}
            width={width}
            itemCount={orders.length}
            itemSize={rowHeight}
            overscanCount={ORDER_LIST_OVERSCAN}
            itemKey={itemKey}
          >
            {Row}
          </FixedSizeList>
        )}
      </AutoSizer>
    </Box>
  );
};

export const OrdersDrawerPanel = ({
  title,
  open,
  orders,
  summaryItems,
  emptyText = 'No orders for the selected period.',
  rowHeight = DEFAULT_ROW_HEIGHT,
  onOpenChange,
}: OrdersDrawerPanelProps) => (
  <Drawer.Root
    size="xl"
    open={open}
    onOpenChange={(event) => onOpenChange(event.open)}
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
            <Drawer.Title>{title}</Drawer.Title>
            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Drawer.CloseTrigger>
          </Drawer.Header>

          <Drawer.Body
            display="flex"
            flexDirection="column"
            flex="1"
            minH="0"
            overflow="hidden"
            w="full"
          >
            {orders.length === 0 ? (
              <Box
                p={4}
                borderWidth="1px"
                borderColor="gray.800"
                borderRadius="md"
              >
                <Text fontSize="sm" color="gray.400">
                  {emptyText}
                </Text>
              </Box>
            ) : (
              <>
                {summaryItems?.length ? (
                  <OrdersSummary items={summaryItems} />
                ) : null}
                <OrdersList orders={orders} rowHeight={rowHeight} />
              </>
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Positioner>
    </Portal>
  </Drawer.Root>
);
