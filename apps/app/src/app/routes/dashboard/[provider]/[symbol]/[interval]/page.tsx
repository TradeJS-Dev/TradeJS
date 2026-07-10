'use client';

import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useFilters, useTickers, useTestList } from '#store';
import { Filters } from '#shared/Filters';
import { MainChart } from '#app/components/Dashboard/MainChart';
import {
  Interval,
  isMarketUniverse,
  MarketUniverse,
  OnChangeFilters,
  Provider,
} from '@tradejs/types';

const Dashboard = () => {
  const searchParams = useSearchParams();
  const { filters, setFilters } = useFilters();
  const { tickers, ensureLoaded: ensureTickersLoaded } = useTickers(
    filters.provider || 'bybit',
    filters.universe ?? 'crypto',
    { enabled: false },
  );
  const { tests, ensureLoaded: ensureBacktestsLoaded } = useTestList({
    symbol: filters.symbol,
    enabled: false,
  });
  const hasBacktestId = searchParams.has('backtestId');
  const hasBacktestStrategy = searchParams.has('backtestStrategy');
  const backtestId = searchParams.get('backtestId');
  const backtestStrategy = searchParams.get('backtestStrategy');
  const isScreenshotMode = searchParams.get('screenshot') === '1';

  const parseDashboardPath = useCallback(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const hasUniverseSegment = isMarketUniverse(parts[3]);
    return {
      provider: (parts[2] || filters.provider || 'bybit') as Provider,
      universe: (hasUniverseSegment ? parts[3] : 'crypto') as MarketUniverse,
      symbol: (parts[hasUniverseSegment ? 4 : 3] || filters.symbol) as string,
      interval: (parts[hasUniverseSegment ? 5 : 4] ||
        filters.interval) as Interval,
    };
  }, [filters.interval, filters.provider, filters.symbol]);

  useEffect(() => {
    const parsed = parseDashboardPath();
    setFilters({
      provider: parsed.provider,
      universe: parsed.universe,
      symbol: parsed.symbol,
      interval: parsed.interval,
      ...(hasBacktestId ? { backtestId } : {}),
      ...(hasBacktestStrategy ? { backtestStrategy } : {}),
    });
  }, [
    backtestId,
    backtestStrategy,
    hasBacktestId,
    hasBacktestStrategy,
    parseDashboardPath,
    setFilters,
  ]);

  const onChangeFilters: OnChangeFilters = useCallback(
    (newFilters) => {
      const parsed = parseDashboardPath();
      const nextFilters = {
        ...filters,
        ...newFilters,
        provider: (newFilters.provider || parsed.provider) as Provider,
        universe: (newFilters.universe || parsed.universe) as MarketUniverse,
        symbol: (newFilters.symbol || parsed.symbol) as string,
        interval: (newFilters.interval || parsed.interval) as Interval,
      };
      setFilters(nextFilters);
      const nextProvider = nextFilters.provider || 'bybit';
      const nextUniverse = nextFilters.universe || 'crypto';
      const nextSymbol = nextFilters.symbol;
      const nextInterval = nextFilters.interval;
      const params = new URLSearchParams(window.location.search);

      if (nextFilters.backtestId) {
        params.set('backtestId', nextFilters.backtestId);
      } else {
        params.delete('backtestId');
      }

      if (nextFilters.backtestStrategy) {
        params.set('backtestStrategy', nextFilters.backtestStrategy);
      } else {
        params.delete('backtestStrategy');
      }

      const search = params.toString();

      window.history.replaceState(
        null,
        '',
        `/routes/dashboard/${nextProvider}/${nextUniverse}/${nextSymbol}/${nextInterval}${search ? `?${search}` : ''}`,
      );
    },
    [filters, parseDashboardPath, setFilters],
  );

  return (
    <ClientOnly>
      <Box
        as="main"
        minH="100vh"
        p={isScreenshotMode ? 0 : 4}
        bg="gray.900"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        alignItems="flex-start"
      >
        {!isScreenshotMode && (
          <Filters.Root
            filters={filters}
            tickers={tickers}
            backtestFiles={tests}
            onChangeFilters={onChangeFilters}
            ensureTickersLoaded={ensureTickersLoaded}
            ensureBacktestsLoaded={ensureBacktestsLoaded}
          >
            <Flex mb={2} gap={4} alignItems="center" flexDirection="row">
              <Filters.SelectProvider />
              {Filters.SelectUniverse ? <Filters.SelectUniverse /> : null}
              <Filters.SelectSymbol />
              <Filters.FavoriteIndicator />
              <Filters.SelectInterval />
              <Filters.SelectIndicator />
            </Flex>
            <Flex mb={4} gap={4} flexDirection="row">
              <Filters.SelectBacktest />
            </Flex>
          </Filters.Root>
        )}
        <Box position="relative" flex="1" w="full">
          <MainChart screenshotMode={isScreenshotMode} />
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default Dashboard;
