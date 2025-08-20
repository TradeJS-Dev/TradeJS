'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useFilters, useTickers } from '@store';
import { getBacktestFiles } from '@src/actions/backtest';
import { Filters } from '@app/components/Shared/Filters';
import { MainChart } from '@app/components/Dashboard/MainChart';
import { AiDrawer } from '@app/components/Dashboard/AiDrawer';
import { Interval, OnChangeFilters, Items } from '@types';

const Dashboard = () => {
  const { symbol, interval } = useParams();
  const { filters, setFilters } = useFilters();
  const { tickers } = useTickers();
  const [backtestFiles, setBacktestFiles] = useState<Items>([]);

  useEffect(() => {
    if (typeof symbol === 'string' && typeof interval === 'string') {
      setFilters({
        symbol,
        interval: interval as Interval,
      });
    }
  }, [symbol, interval]);

  useEffect(() => {
    getBacktestFiles({ symbol: filters.symbol }).then((files) => {
      setBacktestFiles(files);
    });
  }, [filters.symbol]);

  const onChangeFilters: OnChangeFilters = (newFilters) => {
    setFilters(newFilters);

    window.history.replaceState(
      null,
      '',
      `/routes/dashboard/${newFilters.symbol}/${newFilters.interval}`,
    );
  };

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
          backtestFiles={backtestFiles}
          onChangeFilters={onChangeFilters}
        >
          <Flex mb={2} gap={4} flexDirection="row">
            <Filters.SelectSymbol />
            <Filters.FavoriteButton />
            <Filters.SelectInterval />
            <Filters.SelectIndicator />
            <AiDrawer />
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
