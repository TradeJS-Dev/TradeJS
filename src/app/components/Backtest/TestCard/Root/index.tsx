'use client';

import { PropsWithChildren } from 'react';
import _ from 'lodash';
import { Box } from '@chakra-ui/react';
import { TestResultContext } from '../context';
import { TestCardSkeleton } from '../Skeleton';
import { useTest } from '@store';

interface TestRootProps {
  testName: string;
}

export const TestCardRoot = ({
  testName,
  children,
}: PropsWithChildren<TestRootProps>) => {
  const testResult = useTest(testName);

  if (_.isEmpty(testResult)) {
    return <TestCardSkeleton />;
  }

  return (
    <TestResultContext.Provider value={{ testResult: testResult }}>
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
