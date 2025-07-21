'use client';

import React, { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Box, Flex } from '@chakra-ui/react';
import { useSetRecoilState } from 'recoil';
import { filtersState, tickersState, backtestState } from '@atoms';
import { scanner } from '@src/actions/scanner';
import { getBacktestFiles } from '@src/actions/backtest';
import {
  SelectSymbol,
  SelectInterval,
  SelectBacktest,
  SelectIndicator,
} from '@app/components/Dashboard/Filters';
import { MainChart } from '@app/components/Dashboard/MainChart';
import { AiDrawer } from '@app/components/Dashboard/AiDrawer';
import { useIsClient } from '@app/hooks/isClient';
import { Interval } from '@types';
import { getTimestamp } from '@utils/timestamp';

const Dashboard = () => {
  const isClient = useIsClient();
  const { symbol, interval } = useParams();
  const setFilters = useSetRecoilState(filtersState);
  const setTickers = useSetRecoilState(tickersState);
  const setBacktest = useSetRecoilState(backtestState);

  useEffect(() => {
    if (typeof symbol === 'string' && typeof interval === 'string') {
      setFilters((state) => ({
        ...state,
        symbol,
        interval: interval as Interval,
        end: getTimestamp(),
      }));
    }
  }, [symbol, interval]);

  useEffect(() => {
    (async () => {
      const tickers = await scanner();

      setTickers((state) => ({
        ...state,
        scanner: tickers,
      }));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const files = await getBacktestFiles(symbol as string);

      setBacktest((state) => ({
        ...state,
        files,
      }));
    })();
  }, [symbol]);

  if (!isClient) {
    return null;
  }

  return (
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
      <Flex p={2} gap={8} flexDirection="row">
        <SelectSymbol />
        <SelectInterval />
        <SelectIndicator />
        <AiDrawer />
      </Flex>
      <Flex p={2} gap={8} flexDirection="row">
        <SelectBacktest />
      </Flex>
      <Box position="relative" flex="1" w="full">
        <MainChart />
      </Box>
    </Box>
  );
};

export default Dashboard;
