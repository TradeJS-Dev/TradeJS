'use client';

import { Text, Flex } from '@chakra-ui/react';
import { useTestResult } from '../context';

export const TestCardTitle = () => {
  const { testResult } = useTestResult();

  return (
    <Flex gap="4" p={4}>
      <Text fontSize="lg" fontWeight="bold" color={'gray.200'} mb={4}>
        {testResult.test.symbol}
      </Text>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          score:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'teal.500'} mb={4}>
          {testResult.stat.score}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          strategy:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'} mb={4}>
          {testResult.test.strategyName}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          connector:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'} mb={4}>
          {testResult.test.connectorName}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          suite Id:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'} mb={4}>
          {testResult.test.testSuiteId}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          test Id:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'} mb={4}>
          {testResult.test.testId}
        </Text>
      </Flex>
    </Flex>
  );
};
