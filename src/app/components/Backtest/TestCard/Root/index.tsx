'use client';

import { PropsWithChildren, useEffect, useState } from 'react';
import _, { isNull } from 'lodash';
import { Box, SkeletonText, Skeleton, Stack } from '@chakra-ui/react';
import { TestResultContext } from '../context';
import { getBacktest } from '@src/actions/backtest';
import { TestResult } from '@types';
import { TestCompareList, OnChangeCompare } from '../types';

interface TestRootProps {
  id: string;
  compareList: TestCompareList;
  onChangeCompare: OnChangeCompare;
}

export const TestCardRoot = ({
  id,
  children,
  compareList,
  onChangeCompare,
}: PropsWithChildren<TestRootProps>) => {
  const [result, setResult] = useState<TestResult | null>(null);

  const loadData = async () => {
    if (!_.isEmpty(result)) {
      return;
    }

    const testResult = await getBacktest(id);

    if (!testResult) {
      return;
    }

    setResult(testResult);
  };

  useEffect(() => {
    loadData();
  }, [id]);

  if (_.isEmpty(result)) {
    return (
      <Box
        p={2}
        mb={4}
        width="1400px"
        height="628px"
        bg="gray.900"
        borderRadius="md"
        shadow="sm"
        borderWidth="1px"
        overflowX="auto"
      >
        <Stack gap="6">
          <SkeletonText noOfLines={2} gap="6" />
          <Skeleton height="400px" />
          <SkeletonText noOfLines={3} gap="6" />
        </Stack>
      </Box>
    );
  }

  return (
    <TestResultContext.Provider
      value={{ id, testResult: result, compareList, onChangeCompare }}
    >
      <Box
        p={2}
        mb={4}
        maxW="1400px"
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
