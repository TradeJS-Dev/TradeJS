'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useTestList } from '@store';
import { Select } from '@UI';
import { CompareList } from '@components/Backtest/CompareList';
import { TestList } from '@components/Backtest/TestList';
import { parseTestName } from '@utils/tests';

const ALL_STRATEGIES = '__all__';
const ALL_SUITES = '__all__';

const Backtest = () => {
  const { tests, loadding, fulFilled } = useTestList();
  const strategyItems = useMemo(() => {
    const names = new Set<string>();
    for (const test of tests) {
      const strategyName = test.data?.strategyName;
      if (typeof strategyName === 'string' && strategyName) {
        names.add(strategyName);
      }
    }

    return [
      { label: 'All strategies', value: ALL_STRATEGIES },
      ...Array.from(names)
        .sort()
        .map((strategyName) => ({
          label: strategyName,
          value: strategyName,
        })),
    ];
  }, [tests]);
  const [selectedStrategy, setSelectedStrategy] = useState(ALL_STRATEGIES);
  const suiteItems = useMemo(() => {
    const names = new Set<string>();
    for (const test of tests) {
      if (
        selectedStrategy !== ALL_STRATEGIES &&
        test.data?.strategyName !== selectedStrategy
      ) {
        continue;
      }

      const { testSuiteId } = parseTestName(test.value);
      if (testSuiteId) {
        names.add(testSuiteId);
      }
    }

    return [
      { label: 'All suites', value: ALL_SUITES },
      ...Array.from(names)
        .sort()
        .map((testSuiteId) => ({
          label: testSuiteId,
          value: testSuiteId,
        })),
    ];
  }, [tests, selectedStrategy]);
  const [selectedSuite, setSelectedSuite] = useState(ALL_SUITES);

  useEffect(() => {
    if (!strategyItems.some((item) => item.value === selectedStrategy)) {
      setSelectedStrategy(strategyItems[0]?.value || ALL_STRATEGIES);
    }
  }, [strategyItems, selectedStrategy]);

  useEffect(() => {
    if (!suiteItems.some((item) => item.value === selectedSuite)) {
      setSelectedSuite(suiteItems[0]?.value || ALL_SUITES);
    }
  }, [suiteItems, selectedSuite]);

  const filteredTests = useMemo(() => {
    return tests.filter((test) => {
      if (
        selectedStrategy !== ALL_STRATEGIES &&
        test.data?.strategyName !== selectedStrategy
      ) {
        return false;
      }

      if (selectedSuite !== ALL_SUITES) {
        const { testSuiteId } = parseTestName(test.value);
        return testSuiteId === selectedSuite;
      }

      return true;
    });
  }, [tests, selectedStrategy, selectedSuite]);

  const noData = fulFilled && !loadding && filteredTests.length === 0;

  return (
    <ClientOnly>
      <Box minH="100vh" bg="gray.900">
        <Box
          as="main"
          minH="100vh"
          minW="1200px"
          pl={2}
          bg="gray.900"
          display="flex"
          flexDirection="column"
          alignItems="flex-start"
        >
          <Flex
            mb={4}
            mt={2}
            pl={2}
            gap={8}
            flexDirection="row"
            alignItems="center"
          >
            <Flex gap={3} alignItems="center">
              <Select
                placeholder="Strategy"
                value={[selectedStrategy]}
                defaultValue={[selectedStrategy]}
                onChange={(value) =>
                  setSelectedStrategy(value[0] || ALL_STRATEGIES)
                }
                items={strategyItems}
                width="220px"
              />
              <Select
                placeholder="TestSuite"
                value={[selectedSuite]}
                defaultValue={[selectedSuite]}
                onChange={(value) => setSelectedSuite(value[0] || ALL_SUITES)}
                items={suiteItems}
                width="180px"
              />
            </Flex>
            <CompareList />
          </Flex>
          <Box flex="1" h="full" w="full">
            <TestList
              tests={filteredTests}
              loadding={loadding}
              fulFilled={fulFilled}
              noData={noData}
            />
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default Backtest;
