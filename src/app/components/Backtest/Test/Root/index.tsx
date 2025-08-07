'use client';

import { PropsWithChildren, useEffect, useState } from 'react';
import _ from 'lodash';
import { Box } from '@chakra-ui/react';
import { TestContext } from '../context';
import { getBacktest } from '@src/actions/backtest';
import { BacktestHistory } from '@types';

interface TestRootProps {
  id: string;
}

export const TestRoot = ({
  id,
  children,
}: PropsWithChildren<TestRootProps>) => {
  const [history, setHistory] = useState<BacktestHistory | null>(null);

  useEffect(() => {
    getBacktest(id).then(setHistory);
  }, [id]);

  if (_.isEmpty(history)) {
    return null;
  }

  return (
    <TestContext.Provider value={{ id, test: history }}>
      <Box
        p={6}
        mb={4}
        borderRadius="md"
        shadow="sm"
        borderWidth="1px"
        overflowX="auto"
      >
        {children}
      </Box>
    </TestContext.Provider>
  );
};
