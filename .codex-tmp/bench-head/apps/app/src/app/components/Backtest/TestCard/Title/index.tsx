'use client';

import { PropsWithChildren, ReactNode } from 'react';
import { Text, Flex } from '@chakra-ui/react';
import { getBacktestScore } from '@tradejs/core/backtest';
import { useTestContext } from '../context';

interface TestCardTitleProps {
  leftSlot?: ReactNode;
}

export const TestCardTitle = ({
  children,
  leftSlot,
}: PropsWithChildren<TestCardTitleProps>) => {
  const {
    testResult: { stat, test },
  } = useTestContext();
  const score = getBacktestScore(stat);

  return (
    <Flex gap="4" p={4} mb={3}>
      {leftSlot ? <Flex alignItems="center">{leftSlot}</Flex> : null}

      <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
        {test.symbol}
      </Text>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          score:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'teal.500'}>
          {score}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          strategy:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.strategyName}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          connector:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.connectorName}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          suite Id:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.testSuiteId}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          test Id:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.testId}
        </Text>
      </Flex>

      <Flex gap="2" ml={'auto'} mt={-1}>
        {children}
      </Flex>
    </Flex>
  );
};
