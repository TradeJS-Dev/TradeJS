import { useState } from 'react';
import { Box, Button, Flex, NativeSelect, Text } from '@chakra-ui/react';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';
import type { BacktestRun, ChartTrade, TradeDifference } from './trades';

export type TradeSelection = { run: BacktestRun; id: number };

type TradeRow = TradeSelection & {
  trade: ChartTrade;
  difference?: TradeDifference;
};

const orderLabels = {
  OPEN_LONG: 'Open long',
  OPEN_SHORT: 'Open short',
  CLOSE_LONG: 'Close long',
  CLOSE_SHORT: 'Close short',
  STOP_LOSS_LONG: 'Stop loss',
  STOP_LOSS_SHORT: 'Stop loss',
  TAKE_PROFIT_LONG: 'Take profit',
  TAKE_PROFIT_SHORT: 'Take profit',
};

export const TradeReview = ({
  rows,
  selected,
  selectTrade,
  comparing,
  loading,
  unavailable,
  comparisonUnavailable,
  replaying,
}: {
  rows: TradeRow[];
  selected: TradeSelection | null;
  selectTrade: (selection: TradeSelection) => void;
  comparing: boolean;
  loading: boolean;
  unavailable?: boolean;
  comparisonUnavailable?: boolean;
  replaying: boolean;
}) => {
  const [filter, setFilter] = useState('all');
  const visible = rows.filter(({ trade, difference }) => {
    if (filter === 'losing') return trade.remaining <= 1e-8 && trade.profit < 0;
    if (filter === 'winning')
      return trade.remaining <= 1e-8 && trade.profit > 0;
    if (filter === 'differences' && comparing) return difference !== 'Matched';
    return true;
  });
  const index = visible.findIndex(
    (row) => row.id === selected?.id && row.run === selected.run,
  );
  const active = rows.find(
    ({ id, run }) => id === selected?.id && run === selected.run,
  );

  return (
    <Box as="section" aria-label="Backtest trades" minW={0}>
      <Flex align="baseline" gap={2} mb={3} wrap="wrap">
        <Text as="h2" fontSize="sm" fontWeight="semibold">
          Backtest trades
        </Text>
        <Text fontSize="xs" color="fg.muted" role="status">
          {loading
            ? 'Loading trades…'
            : unavailable
              ? 'Order log unavailable'
              : `${visible.length} of ${rows.length} trades`}
          {replaying && ' · Up to the replay candle'}
        </Text>
        {comparisonUnavailable && (
          <Text fontSize="xs" color="fg.error">
            Comparison order log unavailable
          </Text>
        )}
      </Flex>
      <Flex gap={2} wrap="wrap" align="end">
        <NativeSelect.Root size="sm" w="full">
          <NativeSelect.Field
            aria-label="Filter trades"
            value={filter === 'differences' && !comparing ? 'all' : filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All trades</option>
            <option value="losing">Losing trades</option>
            <option value="winning">Winning trades</option>
            {comparing && <option value="differences">Differences only</option>}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <NativeSelect.Root size="sm" w="full" disabled={!visible.length}>
          <NativeSelect.Field
            aria-label="Select trade"
            value={index < 0 ? '' : String(index)}
            onChange={(event) => {
              if (event.target.value !== '')
                selectTrade(visible[Number(event.target.value)]);
            }}
          >
            <option value="" disabled>
              {loading
                ? 'Loading trades…'
                : unavailable
                  ? 'Order log unavailable'
                  : visible.length
                    ? 'Select trade'
                    : rows.length
                      ? 'No matching trades'
                      : 'No recorded trades'}
            </option>
            {visible.map(({ run, id, trade, difference }, rowIndex) => (
              <option key={`${run}:${id}`} value={rowIndex}>
                {comparing ? `${run} · ` : ''}
                {formatTimeSeriesTooltipTimestamp(trade.entry.timestamp)} ·{' '}
                {trade.entry.direction} · {trade.profit.toFixed(2)}
                {difference ? ` · ${difference}` : ''}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Button
          size="sm"
          variant="outline"
          flex="1"
          disabled={index <= 0}
          onClick={() => selectTrade(visible[index - 1])}
        >
          Previous trade
        </Button>
        <Button
          size="sm"
          variant="outline"
          flex="1"
          disabled={index + 1 >= visible.length}
          onClick={() => selectTrade(visible[index + 1])}
        >
          {index < 0 ? 'First trade' : 'Next trade'}
        </Button>
      </Flex>
      {active && (
        <Box
          mt={3}
          p={3}
          borderWidth="1px"
          borderColor="border"
          bg="bg.subtle"
          rounded="lg"
        >
          <Flex align="baseline" justify="space-between" gap={2} mb={2}>
            <Text fontSize="xs" fontWeight="semibold">
              {active.trade.entry.direction} ·{' '}
              {active.trade.remaining > 1e-8 ? 'Open position' : 'Closed'}
            </Text>
            <Text
              fontSize="xs"
              color={active.trade.profit < 0 ? 'fg.error' : 'teal.fg'}
              fontFamily="mono"
              overflowWrap="anywhere"
            >
              Net P&amp;L {active.trade.profit.toFixed(2)}
            </Text>
          </Flex>
          {active.trade.fee !== null && (
            <Text mb={2} fontSize="xs" color="fg.muted">
              Fees {active.trade.fee.toFixed(2)}
            </Text>
          )}
          <Box as="ol" listStyleType="none" maxH="12rem" overflowY="auto">
            {active.trade.events.map((event) => (
              <Box
                as="li"
                key={event.index}
                borderTopWidth="1px"
                borderColor="border"
                py={2}
                fontSize="xs"
              >
                <Text fontWeight="semibold" overflowWrap="anywhere">
                  {orderLabels[event.type]} · {event.qty} @ {event.price}
                </Text>
                <Text color="fg.muted">
                  {formatTimeSeriesTooltipTimestamp(event.timestamp)}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};
