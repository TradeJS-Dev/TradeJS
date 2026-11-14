'use client';

import { PageLayout } from '#shared/PageLayout';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Button,
  ClientOnly,
  Flex,
  Popover,
  Portal,
  Separator,
} from '@chakra-ui/react';
import { FiCopy, FiPlay, FiLayers } from 'react-icons/fi';
import { useFilters, useTickers, useTestList } from '#store';
import { Filters } from '#shared/Filters';
import { MainChart } from '#app/components/Dashboard/MainChart';
import { Interval, MarketUniverse, Provider } from '@tradejs/types';
import type { OnChangeFilters } from '#app/types/ui';
import {
  buildDashboardPath,
  parseDashboardPath as parseMarketDashboardPath,
} from '#app/lib/marketRoutes';

const DashboardRoute = () => {
  const searchParams = useSearchParams();
  const [contextCopied, setContextCopied] = useState(false);
  const { filters, setFilters } = useFilters();
  const { tickers, ensureLoaded: ensureTickersLoaded } = useTickers(
    filters.provider || 'bybit',
    filters.universe ?? 'crypto',
    { enabled: false },
  );
  const { tests, ensureLoaded: ensureBacktestsLoaded } = useTestList({
    symbol: filters.symbol,
    enabled: Boolean(filters.backtestId || filters.backtestStrategy),
  });
  const hasBacktestId = searchParams.has('backtestId');
  const hasBacktestStrategy = searchParams.has('backtestStrategy');
  const backtestId = searchParams.get('backtestId');
  const backtestStrategy = searchParams.get('backtestStrategy');
  const isScreenshotMode = searchParams.get('screenshot') === '1';

  const parseDashboardPath = useCallback(() => {
    return parseMarketDashboardPath(window.location.pathname, {
      provider: (filters.provider || 'bybit') as Provider,
      symbol: filters.symbol,
      interval: filters.interval as Interval,
    });
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
      params.delete('universe');

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

      window.history.replaceState(
        null,
        '',
        buildDashboardPath(
          {
            provider: nextProvider,
            universe: nextUniverse,
            symbol: nextSymbol,
            interval: nextInterval,
          },
          params,
        ),
      );
    },
    [filters, parseDashboardPath, setFilters],
  );

  return (
    <ClientOnly>
      <PageLayout
        minH="100vh"
        maxW="none"
        px={0}
        pt={0}
        pb={0}
        display="flex"
        flexDirection="column"
      >
        <Box
          position="relative"
          flex="1"
          w="full"
          minW={0}
          h={isScreenshotMode ? '100vh' : undefined}
        >
          <MainChart
            screenshotMode={isScreenshotMode}
            backtestFiles={tests}
            toolbar={
              isScreenshotMode ? undefined : (
                <Filters.Root
                  filters={filters}
                  tickers={tickers}
                  backtestFiles={tests}
                  onChangeFilters={onChangeFilters}
                  ensureTickersLoaded={ensureTickersLoaded}
                  ensureBacktestsLoaded={ensureBacktestsLoaded}
                >
                  <Flex
                    role="group"
                    aria-label="Chart filters"
                    minW={0}
                    gap={1}
                    align="center"
                    wrap="wrap"
                  >
                    <Filters.SelectSymbol />
                    <Filters.FavoriteIndicator />
                    <Filters.SelectProvider />
                    {Filters.SelectUniverse ? <Filters.SelectUniverse /> : null}
                    <Separator orientation="vertical" h={5} mx={1} />
                    <Filters.SelectInterval />
                    <Separator orientation="vertical" h={5} mx={1} />
                    <Filters.SelectIndicator />
                    <Popover.Root positioning={{ placement: 'bottom-start' }}>
                      <Popover.Trigger asChild>
                        <Button
                          size="xs"
                          variant={filters.backtestId ? 'subtle' : 'ghost'}
                          colorPalette={filters.backtestId ? 'teal' : 'gray'}
                          title={filters.backtestId ?? undefined}
                        >
                          <FiLayers />{' '}
                          {filters.backtestId ? 'Backtest active' : 'Backtest'}
                        </Button>
                      </Popover.Trigger>
                      <Portal>
                        <Popover.Positioner>
                          <Popover.Content w="min(18rem, calc(100vw - 1rem))">
                            <Popover.Body
                              display="flex"
                              flexDirection="column"
                              gap={2}
                            >
                              <Popover.Title>Backtest overlay</Popover.Title>
                              <Filters.SelectBacktest portalled={false} />
                            </Popover.Body>
                          </Popover.Content>
                        </Popover.Positioner>
                      </Portal>
                    </Popover.Root>
                    <Flex gap={1}>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={
                          contextCopied
                            ? 'Context copied'
                            : 'Copy context for AI'
                        }
                        title={
                          contextCopied
                            ? 'Context copied'
                            : 'Copy context for AI'
                        }
                        onClick={async () => {
                          const context = {
                            provider: filters.provider,
                            universe: filters.universe ?? 'crypto',
                            symbol: filters.symbol,
                            interval: filters.interval,
                            ...(filters.backtestId
                              ? {
                                  backtestId: filters.backtestId,
                                  backtestStrategy: filters.backtestStrategy,
                                }
                              : {}),
                          };
                          try {
                            await navigator.clipboard.writeText(
                              `TradeJS chart context: ${JSON.stringify(context)}. Use chart_get_context for market candles; for a saved backtest, inspect its recorded results. URL: ${window.location.href}`,
                            );
                            setContextCopied(true);
                          } catch {
                            setContextCopied(false);
                          }
                        }}
                      >
                        <FiCopy />
                      </Button>
                      <Button
                        asChild
                        size="xs"
                        variant="subtle"
                        colorPalette="teal"
                        title="Run backtest"
                      >
                        <Link href="/routes/backtest?new=1">
                          <FiPlay /> Run backtest
                        </Link>
                      </Button>
                    </Flex>
                  </Flex>
                </Filters.Root>
              )
            }
          />
        </Box>
      </PageLayout>
    </ClientOnly>
  );
};

export default DashboardRoute;
