'use client';

import { PropsWithChildren, useEffect, useState } from 'react';
import _ from 'lodash';
import { Box } from '@chakra-ui/react';
import { TestResultContext } from '../context';
import { getBacktest } from '@src/actions/backtest';
import { TestResult } from '@types';

interface TestRootProps {
  id: string;
}

export const TestCardRoot = ({
  id,
  children,
}: PropsWithChildren<TestRootProps>) => {
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    getBacktest(id).then(setResult);
  }, [id]);

  if (_.isEmpty(result)) {
    return null;
  }

  return (
    <TestResultContext.Provider value={{ id, testResult: result }}>
      <Box
        p={2}
        mb={4}
        borderRadius="md"
        shadow="sm"
        borderWidth="1px"
        overflowX="auto"
      >
        {children}
      </Box>
    </TestResultContext.Provider>
  );
};
