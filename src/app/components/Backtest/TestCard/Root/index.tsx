'use client';

import { PropsWithChildren } from 'react';
import _ from 'lodash';
import { Box } from '@chakra-ui/react';
import { TestResultContext } from '../context';
import { TestCardSkeleton } from '../Skeleton';
import { useTest, useFavoriteTests } from '@store';

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

  if (_.isEmpty(testResult)) {
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
  }

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
