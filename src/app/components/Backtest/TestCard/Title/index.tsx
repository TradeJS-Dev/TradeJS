'use client';

import { PropsWithChildren } from 'react';
import { Text, Flex } from '@chakra-ui/react';
import { useTestContext } from '../context';

export const TestCardTitle = ({ children }: PropsWithChildren<{}>) => {
  const {
    testResult: { stat, test },
  } = useTestContext();

  return (
    <Flex gap="4" p={4} mb={3}>
      <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
        {test.symbol}
      </Text>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          score:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'teal.500'}>
          {stat.score}
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
