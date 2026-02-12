'use client';

import { useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useFilters, useTickers, useTestList } from '@store';
import { Filters } from '@shared/Filters';
import { MainChart } from '@app/components/Dashboard/MainChart';
import { Interval, OnChangeFilters, Provider } from '@types';

const Dashboard = () => {
  const { provider, symbol, interval } = useParams();
  const { filters, setFilters } = useFilters();
  const { tickers } = useTickers((provider as string) || 'bybit');
  const { tests } = useTestList({ symbol: filters.symbol });

  useEffect(() => {
    if (
      typeof provider === 'string' &&
      typeof symbol === 'string' &&
      typeof interval === 'string'
    ) {
      setFilters({
        provider: provider as Provider,
        symbol,
        interval: interval as Interval,
      });
    }
  }, [provider, symbol, interval]);

  const onChangeFilters: OnChangeFilters = useCallback(
    (newFilters) => {
      setFilters(newFilters);

      const search = window.location.search;
      const nextProvider = newFilters.provider || filters.provider || 'bybit';
      const nextSymbol = newFilters.symbol || filters.symbol;
      const nextInterval = newFilters.interval || filters.interval;

      window.history.replaceState(
        null,
        '',
        `/routes/dashboard/${nextProvider}/${nextSymbol}/${nextInterval}${search}`,
      );
    },
    [filters.provider, filters.symbol, filters.interval],
  );

  return (
    <ClientOnly>
      <Box
        as="main"
        minH="100vh"
        p={4}
        bg="gray.900"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        alignItems="flex-start"
      >
        <Filters.Root
          filters={filters}
          tickers={tickers}
          backtestFiles={tests}
          onChangeFilters={onChangeFilters}
        >
          <Flex mb={2} gap={4} alignItems="center" flexDirection="row">
            <Filters.SelectProvider />
            <Filters.SelectSymbol />
            <Filters.FavoriteIndicator />
            <Filters.SelectInterval />
            <Filters.SelectIndicator />
          </Flex>
          <Flex mb={4} gap={4} flexDirection="row">
            <Filters.SelectBacktest />
          </Flex>
        </Filters.Root>
        <Box position="relative" flex="1" w="full">
          <MainChart />
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default Dashboard;
