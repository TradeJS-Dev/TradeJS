'use client';

import React from 'react';
import { Box, ClientOnly } from '@chakra-ui/react';
import { useParams } from 'next/navigation';
import { TestCard } from '@components/Backtest/TestCard';

const BacktestReport = () => {
  const { test: testName } = useParams();

  if (typeof testName !== 'string') {
    return null;
  }

  return (
    <ClientOnly>
      <Box minH="100vh" bg="gray.900">
        <Box
          minW="1200px"
          pl={4}
          pt={4}
        >
          <TestCard.Root testName={testName} noWrapper={true}>
            <TestCard.Title>
              <TestCard.ConfigDrawer />
            </TestCard.Title>
            <TestCard.Chart height="500px" />
            <TestCard.Stat />
          </TestCard.Root>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default BacktestReport;
