import { Box, Flex, Text } from '@chakra-ui/react';
import type { Signal } from '@tradejs/types';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';

const priceFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 9,
});

export const SignalSummary = ({ signal }: { signal: Signal }) => {
  const levels = [
    { label: 'Entry', price: signal.prices.currentPrice, color: 'fg' },
    {
      label: 'Stop loss',
      price: signal.prices.stopLossPrice,
      color: 'fg.error',
    },
    {
      label: 'Take profit',
      price: signal.prices.takeProfitPrice,
      color: 'teal.fg',
    },
  ];

  return (
    <Box as="section" aria-label="Signal setup" minW={0}>
      <Flex align="start" justify="space-between" gap={2} mb={3}>
        <Box minW={0}>
          <Text
            as="h2"
            fontSize="sm"
            fontWeight="semibold"
            overflowWrap="anywhere"
          >
            {signal.strategy}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {formatTimeSeriesTooltipTimestamp(signal.timestamp)}
          </Text>
        </Box>
        <Text
          fontSize="xs"
          fontWeight="semibold"
          bg={signal.direction === 'LONG' ? 'teal.muted' : 'bg.error'}
          color={signal.direction === 'LONG' ? 'teal.fg' : 'fg.error'}
          rounded="md"
          px={2}
          py={1}
        >
          {signal.direction}
        </Text>
      </Flex>
      <Box
        as="dl"
        bg="bg.subtle"
        rounded="lg"
        borderWidth="1px"
        borderColor="border"
        p={3}
      >
        {levels.map(({ label, price, color }) => (
          <Flex
            key={label}
            justify="space-between"
            gap={2}
            py={1}
            fontSize="xs"
          >
            <Text as="dt" color="fg.muted">
              {label}
            </Text>
            <Text
              as="dd"
              color={color}
              fontFamily="mono"
              fontWeight="semibold"
              overflowWrap="anywhere"
            >
              {priceFormat.format(price)}
            </Text>
          </Flex>
        ))}
      </Box>
    </Box>
  );
};
