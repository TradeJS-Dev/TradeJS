'use client';

import { useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useFilters, useTickers, useTestList } from '@store';
import { Filters } from '@shared/Filters';
import { MainChart } from '@app/components/Dashboard/MainChart';
import { Interval, OnChangeFilters, Items } from '@types';

const Dashboard = () => {
  const { symbol, interval } = useParams();
  const { filters, setFilters } = useFilters();
  const { tickers } = useTickers();
  const { tests } = useTestList({ symbol: filters.symbol });

  useEffect(() => {
    if (typeof symbol === 'string' && typeof interval === 'string') {
      setFilters({
        symbol,
        interval: interval as Interval,
      });
    }
  }, [symbol, interval]);

  const onChangeFilters: OnChangeFilters = useCallback(
    (newFilters) => {
      setFilters(newFilters);

      const search = window.location.search;

      window.history.replaceState(
        null,
        '',
        `/routes/dashboard/${newFilters.symbol || filters.symbol}/${newFilters.interval || filters.interval}${search}`,
      );
    },
    [filters.symbol, filters.interval],
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
