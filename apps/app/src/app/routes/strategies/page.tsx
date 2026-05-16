'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Spinner,
  Table,
  Text,
} from '@chakra-ui/react';
import { getRuntimeStrategies } from '@actions/strategies';
import { RuntimeStrategyMarketChart } from '@components/Strategies/RuntimeStrategyMarketChart';
import type {
  RuntimeStrategiesResponse,
  RuntimeStrategyTradeView,
  RuntimeStrategyView,
} from '@app/lib/runtimeStrategies';

const HOURS_OPTIONS = [
  { label: '24h', value: 24 },
  { label: '72h', value: 72 },
  { label: '7d', value: 168 },
  { label: '30d', value: 720 },
];

const formatPnl = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
};

const formatPrice = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
};

const formatDateTime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return new Date(value).toLocaleString('ru-RU');
};

const StatCell = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) => (
  <Box
    border="1px solid"
    borderColor="whiteAlpha.200"
    borderRadius="14px"
    bg="whiteAlpha.50"
    p={3}
  >
    <Text fontSize="xs" color="gray.400" mb={1}>
      {label}
    </Text>
    <Text
      fontSize="lg"
      fontWeight="600"
      color={
        tone === 'positive'
          ? 'green.300'
          : tone === 'negative'
            ? 'red.300'
            : 'white'
      }
    >
      {value}
    </Text>
  </Box>
);

const TradeTable = ({ trades }: { trades: RuntimeStrategyTradeView[] }) => {
  if (!trades.length) {
    return <Text color="gray.400">Сделок за выбранное окно пока нет.</Text>;
  }

  return (
    <Box overflowX="auto">
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>symbol</Table.ColumnHeader>
            <Table.ColumnHeader>side</Table.ColumnHeader>
            <Table.ColumnHeader>status</Table.ColumnHeader>
            <Table.ColumnHeader>entry</Table.ColumnHeader>
            <Table.ColumnHeader>exit</Table.ColumnHeader>
            <Table.ColumnHeader>PnL</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {trades.map((trade) => (
            <Table.Row key={trade.orderId}>
              <Table.Cell>{trade.symbol}</Table.Cell>
              <Table.Cell>{trade.direction}</Table.Cell>
              <Table.Cell>{trade.status}</Table.Cell>
              <Table.Cell>
                {formatDateTime(trade.entryTimestamp)}
                <br />
                {formatPrice(trade.entryPrice)}
              </Table.Cell>
              <Table.Cell>
                {formatDateTime(trade.exitTimestamp)}
                <br />
                {formatPrice(trade.exitPrice)}
              </Table.Cell>
              <Table.Cell
                color={(trade.pnl ?? 0) >= 0 ? 'green.300' : 'red.300'}
              >
                {formatPnl(trade.pnl)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
};

const StrategyCard = ({ strategy }: { strategy: RuntimeStrategyView }) => {
  const totalPnlTone =
    strategy.stats.totalPnl > 0
      ? 'positive'
      : strategy.stats.totalPnl < 0
        ? 'negative'
        : undefined;

  return (
    <Box
      border="1px solid"
      borderColor="whiteAlpha.200"
      borderRadius="22px"
      bg="gray.900"
      p={5}
      boxShadow="0 18px 50px rgba(0, 0, 0, 0.28)"
    >
      <Flex
        justify="space-between"
        align={{ base: 'flex-start', lg: 'center' }}
        direction={{ base: 'column', lg: 'row' }}
        gap={4}
        mb={4}
      >
        <Box>
          <Heading size="md">{strategy.strategyName}</Heading>
          <Text color="gray.400" mt={1}>
            {strategy.connected
              ? 'Подключена в runtime config'
              : 'Есть runtime trades, но config не найден'}
          </Text>
        </Box>
        <HStack wrap="wrap" gap={2}>
          {(strategy.symbols.length ? strategy.symbols : ['no symbols']).map(
            (symbol) => (
              <Box
                key={symbol}
                px={3}
                py={1}
                borderRadius="999px"
                bg={
                  symbol === strategy.focusSymbol
                    ? 'teal.500'
                    : 'whiteAlpha.100'
                }
                color={symbol === strategy.focusSymbol ? 'black' : 'gray.200'}
                fontSize="sm"
                fontWeight="600"
              >
                {symbol}
              </Box>
            ),
          )}
        </HStack>
      </Flex>

      <Box
        display="grid"
        gridTemplateColumns={{
          base: 'repeat(2, minmax(0, 1fr))',
          xl: 'repeat(6, minmax(0, 1fr))',
        }}
        gap={3}
        mb={5}
      >
        <StatCell label="Trades" value={String(strategy.stats.trades)} />
        <StatCell label="Active" value={String(strategy.stats.activeTrades)} />
        <StatCell label="Closed" value={String(strategy.stats.closedTrades)} />
        <StatCell
          label="Win rate"
          value={`${strategy.stats.winRate.toFixed(1)}%`}
        />
        <StatCell
          label="Total PnL"
          value={formatPnl(strategy.stats.totalPnl)}
          tone={totalPnlTone}
        />
        <StatCell
          label="Avg closed"
          value={formatPnl(strategy.stats.avgClosedPnl)}
          tone={
            strategy.stats.avgClosedPnl > 0
              ? 'positive'
              : strategy.stats.avgClosedPnl < 0
                ? 'negative'
                : undefined
          }
        />
      </Box>

      <Text color="gray.300" fontSize="sm" mb={2}>
        {strategy.focusSymbol
          ? `Биржевой график ${strategy.focusSymbol} с маркерами входов/выходов`
          : 'Нет символа для графика'}
      </Text>
      <RuntimeStrategyMarketChart
        symbol={strategy.focusSymbol}
        chart={strategy.chart}
        markers={strategy.markers}
      />

      <Box mt={5}>
        <Text color="gray.300" fontSize="sm" mb={3}>
          Последние сделки
        </Text>
        <TradeTable trades={strategy.recentTrades} />
      </Box>
    </Box>
  );
};

const RuntimeStrategiesPage = () => {
  const [hours, setHours] = useState(168);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<RuntimeStrategiesResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getRuntimeStrategies({ hours });
      setData(response);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load runtime strategies');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const strategies = data?.strategies ?? [];

    return {
      strategies: strategies.length,
      activeTrades: strategies.reduce(
        (sum, strategy) => sum + strategy.stats.activeTrades,
        0,
      ),
      totalTrades: strategies.reduce(
        (sum, strategy) => sum + strategy.stats.trades,
        0,
      ),
      totalPnl: strategies.reduce(
        (sum, strategy) => sum + strategy.stats.totalPnl,
        0,
      ),
    };
  }, [data]);

  return (
    <Box minH="100vh" bg="gray.950" color="white" p={6}>
      <Flex
        justify="space-between"
        align={{ base: 'flex-start', md: 'center' }}
        direction={{ base: 'column', md: 'row' }}
        gap={4}
        mb={6}
      >
        <Box>
          <Heading size="lg" mb={2}>
            Connected Strategies
          </Heading>
          <Text color="gray.400">
            Runtime strategies, синхронизированные с биржей по `orderLinkId` и
            runtime trade records.
          </Text>
        </Box>

        <HStack>
          <select
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
            style={{
              width: '140px',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '10px',
              padding: '8px 10px',
              background: '#111827',
              color: '#f8fafc',
            }}
          >
            {HOURS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button onClick={load} colorPalette="teal">
            Refresh
          </Button>
        </HStack>
      </Flex>

      <Box
        border="1px solid"
        borderColor="whiteAlpha.200"
        borderRadius="18px"
        bg="whiteAlpha.50"
        p={4}
        mb={6}
      >
        <Text color="gray.300">
          Strategies: {totals.strategies} | Trades: {totals.totalTrades} |
          Active: {totals.activeTrades} | Total PnL:{' '}
          {formatPnl(totals.totalPnl)}
        </Text>
        {data?.generatedAt ? (
          <Text color="gray.500" fontSize="sm" mt={1}>
            Updated: {formatDateTime(data.generatedAt)}
          </Text>
        ) : null}
      </Box>

      {loading ? (
        <Flex justify="center" py={12}>
          <Spinner size="lg" />
        </Flex>
      ) : null}

      {error ? (
        <Box
          border="1px solid"
          borderColor="red.500"
          bg="red.950"
          borderRadius="16px"
          p={4}
          mb={6}
        >
          <Text color="red.200">{error}</Text>
        </Box>
      ) : null}

      {!loading && !error && !data?.strategies.length ? (
        <Box
          border="1px dashed"
          borderColor="whiteAlpha.300"
          borderRadius="18px"
          p={8}
        >
          <Text color="gray.400">
            Для этого пользователя пока нет подключенных стратегий или runtime
            trade records.
          </Text>
        </Box>
      ) : null}

      <Box display="grid" gap={5}>
        {(data?.strategies ?? []).map((strategy) => (
          <StrategyCard key={strategy.strategyName} strategy={strategy} />
        ))}
      </Box>
    </Box>
  );
};

export default RuntimeStrategiesPage;
