'use client';

import { type ReactNode, useCallback, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import {
  Badge,
  Box,
  Button,
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
  reference?: ReactNode;
  subtitle?: ReactNode;
  period?: {
    start: number | null | undefined;
    end?: number | null;
    durationHours?: number | null;
  };
  direction?: 'LONG' | 'SHORT' | null;
  status?: 'active' | 'closed';
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
  emptyText?: string;
  rowHeight?: number;
  showStatusFilter?: boolean;
  statusFilterOptions?: readonly {
    label: string;
    value: OrderStatusFilter;
  }[];
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_ROW_HEIGHT = 278;
const ORDER_LIST_OVERSCAN = 4;
type OrderStatusFilter = 'all' | 'closed' | 'active';
type OrderDirectionFilter = 'all' | 'LONG' | 'SHORT';

const orderStatusFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Closed', value: 'closed' },
  { label: 'Active', value: 'active' },
] as const;

const orderDirectionFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Long', value: 'LONG' },
  { label: 'Short', value: 'SHORT' },
] as const;

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

export const formatUsdt = (
  value: number | null | undefined,
  {
    signed = false,
    maximumFractionDigits = 2,
    minimumFractionDigits = 2,
  }: Intl.NumberFormatOptions & { signed?: boolean } = {},
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('ru-RU', {
    maximumFractionDigits,
    minimumFractionDigits,
  })} USDT`;
};

export const formatPriceUsdt = (value: number | null | undefined) =>
  formatUsdt(value, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  });

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

export const formatOrderPeriod = ({
  start,
  end,
  durationHours,
}: NonNullable<OrdersDrawerOrder['period']>) => {
  const startLabel = formatDateTime(start);
  if (typeof end !== 'number' || !Number.isFinite(end)) {
    return startLabel;
  }

  const durationLabel =
    typeof durationHours === 'number' && Number.isFinite(durationHours)
      ? ` (${formatDuration(durationHours)})`
      : '';

  return `${startLabel} - ${formatDateTime(end)}${durationLabel}`;
};

export const formatFee = (value: number | null | undefined) => {
  return formatUsdt(value, {
    signed: true,
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  });
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

const filterOrders = ({
  orders,
  statusFilter,
  directionFilter,
}: {
  orders: OrdersDrawerOrder[];
  statusFilter: OrderStatusFilter;
  directionFilter: OrderDirectionFilter;
}) =>
  orders.filter((order) => {
    if (statusFilter !== 'all' && order.status !== statusFilter) {
      return false;
    }

    if (directionFilter !== 'all' && order.direction !== directionFilter) {
      return false;
    }

    return true;
  });

interface OrdersFilterGroupProps<TValue extends string> {
  label: string;
  options: readonly { label: string; value: TValue }[];
  value: TValue;
  onChange: (value: TValue) => void;
}

const OrdersFilterGroup = <TValue extends string>({
  label,
  options,
  value,
  onChange,
}: OrdersFilterGroupProps<TValue>) => (
  <Flex alignItems="center" gap={2} minW="0">
    <Text
      color="gray.500"
      fontSize="2xs"
      fontWeight="bold"
      textTransform="uppercase"
      whiteSpace="nowrap"
    >
      {label}
    </Text>
    <Flex
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="md"
      overflow="hidden"
      flex="0 0 auto"
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Button
            key={option.value}
            size="xs"
            variant={selected ? 'solid' : 'ghost'}
            colorPalette={selected ? 'teal' : 'gray'}
            borderRadius="0"
            minW="54px"
            h="8"
            px={3}
            fontFamily="mono"
            letterSpacing="0"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </Flex>
  </Flex>
);

const OrdersFilters = ({
  statusFilter,
  directionFilter,
  showStatusFilter,
  statusFilterOptions,
  onStatusFilterChange,
  onDirectionFilterChange,
}: {
  statusFilter: OrderStatusFilter;
  directionFilter: OrderDirectionFilter;
  showStatusFilter: boolean;
  statusFilterOptions: readonly {
    label: string;
    value: OrderStatusFilter;
  }[];
  onStatusFilterChange: (value: OrderStatusFilter) => void;
  onDirectionFilterChange: (value: OrderDirectionFilter) => void;
}) => (
  <Flex
    px={1}
    pb={4}
    gap={3}
    alignItems="center"
    justifyContent="space-between"
    wrap="wrap"
    flex="0 0 auto"
  >
    {showStatusFilter ? (
      <OrdersFilterGroup
        label="Status"
        options={statusFilterOptions}
        value={statusFilter}
        onChange={onStatusFilterChange}
      />
    ) : null}
    <OrdersFilterGroup
      label="Type"
      options={orderDirectionFilterOptions}
      value={directionFilter}
      onChange={onDirectionFilterChange}
    />
  </Flex>
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
  const subtitle = order.period
    ? formatOrderPeriod(order.period)
    : order.subtitle;

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
            {order.reference ? (
              <Text color="gray.500" fontSize="xs" fontFamily="mono">
                ref {order.reference}
              </Text>
            ) : null}
          </Flex>
          {subtitle ? (
            <Box mt={1} color="gray.500" fontSize="xs" lineHeight="1.2">
              {subtitle}
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
          <Text
            fontSize="xs"
            color="gray.500"
            textTransform="uppercase"
            lineHeight="1"
          >
            P&amp;L
          </Text>
          <Text
            color={getPnlColor(order.pnl)}
            fontWeight="bold"
            fontSize="xl"
            fontFamily="mono"
            lineHeight="1"
            whiteSpace="nowrap"
          >
            {formatUsdt(order.pnl, { signed: true })}
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
  emptyText = 'No orders for the selected period.',
  rowHeight = DEFAULT_ROW_HEIGHT,
  showStatusFilter = true,
  statusFilterOptions = orderStatusFilterOptions,
  onOpenChange,
}: OrdersDrawerPanelProps) => {
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all');
  const [directionFilter, setDirectionFilter] =
    useState<OrderDirectionFilter>('all');
  const filteredOrders = useMemo(
    () =>
      filterOrders({
        orders,
        statusFilter: showStatusFilter ? statusFilter : 'all',
        directionFilter,
      }),
    [directionFilter, orders, showStatusFilter, statusFilter],
  );

  return (
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
              <OrdersFilters
                statusFilter={statusFilter}
                directionFilter={directionFilter}
                showStatusFilter={showStatusFilter}
                statusFilterOptions={statusFilterOptions}
                onStatusFilterChange={setStatusFilter}
                onDirectionFilterChange={setDirectionFilter}
              />
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
              ) : filteredOrders.length === 0 ? (
                <Box
                  p={4}
                  borderWidth="1px"
                  borderColor="gray.800"
                  borderRadius="md"
                >
                  <Text fontSize="sm" color="gray.400">
                    No orders match the selected filters.
                  </Text>
                </Box>
              ) : (
                <OrdersList orders={filteredOrders} rowHeight={rowHeight} />
              )}
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
