'use client';

import { PropsWithChildren } from 'react';
import _ from 'lodash';
import { Box, SkeletonText, Skeleton, Stack } from '@chakra-ui/react';
import { TestResultContext } from '../context';
import { useTest } from '@store';

interface TestRootProps {
  id: string;
}

export const TestCardRoot = ({
  id,
  children,
}: PropsWithChildren<TestRootProps>) => {
  const testResult = useTest(id);

  if (_.isEmpty(testResult)) {
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
    <TestResultContext.Provider value={{ id, testResult: testResult }}>
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
