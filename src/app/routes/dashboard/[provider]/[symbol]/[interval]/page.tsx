'use client';

import { useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useFilters, useTickers, useTestList } from '@store';
import { Filters } from '@shared/Filters';
import { MainChart } from '@app/components/Dashboard/MainChart';
import { Interval, OnChangeFilters, Provider } from '@types';

const Dashboard = () => {
  const { provider, symbol, interval } = useParams();
  const searchParams = useSearchParams();
  const { filters, setFilters } = useFilters();
  const { tickers } = useTickers((provider as string) || 'bybit');
  const { tests } = useTestList({ symbol: filters.symbol });
  const hasBacktestId = searchParams.has('backtestId');
  const hasBacktestStrategy = searchParams.has('backtestStrategy');
  const backtestId = searchParams.get('backtestId');
  const backtestStrategy = searchParams.get('backtestStrategy');

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
        ...(hasBacktestId ? { backtestId } : {}),
        ...(hasBacktestStrategy ? { backtestStrategy } : {}),
      });
    }
  }, [
    provider,
    symbol,
    interval,
    hasBacktestId,
    hasBacktestStrategy,
    backtestId,
    backtestStrategy,
  ]);

  const onChangeFilters: OnChangeFilters = useCallback(
    (newFilters) => {
      setFilters(newFilters);
      const nextProvider = newFilters.provider || filters.provider || 'bybit';
      const nextSymbol = newFilters.symbol || filters.symbol;
      const nextInterval = newFilters.interval || filters.interval;
      const params = new URLSearchParams(window.location.search);

      const backtestIdChanged = Object.prototype.hasOwnProperty.call(
        newFilters,
        'backtestId',
      );
      const backtestStrategyChanged = Object.prototype.hasOwnProperty.call(
        newFilters,
        'backtestStrategy',
      );
      const nextBacktestId = backtestIdChanged
        ? newFilters.backtestId
        : filters.backtestId;
      const nextBacktestStrategy = backtestStrategyChanged
        ? newFilters.backtestStrategy
        : filters.backtestStrategy;

      if (nextBacktestId) {
        params.set('backtestId', nextBacktestId);
      } else {
        params.delete('backtestId');
      }

      if (nextBacktestStrategy) {
        params.set('backtestStrategy', nextBacktestStrategy);
      } else {
        params.delete('backtestStrategy');
      }

      const search = params.toString();

      window.history.replaceState(
        null,
        '',
        `/routes/dashboard/${nextProvider}/${nextSymbol}/${nextInterval}${search ? `?${search}` : ''}`,
      );
    },
    [
      filters.provider,
      filters.symbol,
      filters.interval,
      filters.backtestId,
      filters.backtestStrategy,
    ],
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
