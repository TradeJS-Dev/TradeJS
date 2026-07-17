'use client';

import { PropsWithChildren } from 'react';
import { Box, Text } from '@chakra-ui/react';
import { TestResultContext } from '../context';
import { TestCardSkeleton } from '../Skeleton';
import { useTest, useFavoriteTests } from '#store';

interface TestRootProps {
  testName: string;
  noWrapper?: boolean;
}

export const TestCardRoot = ({
  testName,
  noWrapper,
  children,
}: PropsWithChildren<TestRootProps>) => {
  const testResult = useTest(testName);
  const { checkIsFavorite } = useFavoriteTests();

  if (testResult === null) {
    return (
      <Box
        p={4}
        mb={4}
        borderRadius="md"
        borderWidth="1px"
        borderColor="gray.700"
        color="gray.400"
      >
        <Text>Backtest data is no longer available.</Text>
      </Box>
    );
  }

  if (!testResult) {
    return <TestCardSkeleton />;
  }

  const isFavorite = checkIsFavorite(testResult.test.name);

  const getBorderColor = () => {
    if (noWrapper) {
      return 'transparent';
    }
    if (isFavorite) {
      return 'yellow.800';
    }
    return 'gray.800';
  };

  return (
    <TestResultContext.Provider value={{ testResult: testResult }}>
      <Box
        p={2}
        mb={4}
        maxW="1400px"
        borderRadius="md"
        shadow={noWrapper ? undefined : 'sm'}
        borderWidth="1px"
        borderColor={getBorderColor()}
        overflowX="auto"
      >
        {children}
      </Box>
    </TestResultContext.Provider>
  );
};
