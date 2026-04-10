'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  ClientOnly,
  CloseButton,
  Dialog,
  Flex,
  Portal,
  Text,
} from '@chakra-ui/react';
import { deleteBacktest } from '@actions/backtest';
import { useBacktestMutations, useTestList } from '@store';
import { Select, toaster } from '@UI';
import { CompareList } from '@components/Backtest/CompareList';
import { TestList } from '@components/Backtest/TestList';
import { parseTestName } from '@tradejs/core/backtest';

const ALL_STRATEGIES = '__all__';
const ALL_SUITES = '__all__';

const Backtest = () => {
  const { tests, loadding, fulFilled } = useTestList();
  const { removeBacktestTest } = useBacktestMutations();
  const [selectedTestNames, setSelectedTestNames] = useState<string[]>([]);
  const [isDeleteSelectedOpen, setIsDeleteSelectedOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
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

  const filteredTestNames = useMemo(
    () => filteredTests.map((test) => test.value),
    [filteredTests],
  );

  const selectedFilteredCount = useMemo(() => {
    const filteredSet = new Set(filteredTestNames);
    return selectedTestNames.filter((testName) => filteredSet.has(testName))
      .length;
  }, [filteredTestNames, selectedTestNames]);

  const allFilteredSelected =
    filteredTests.length > 0 && selectedFilteredCount === filteredTests.length;
  const hasSelectedInFilter = selectedFilteredCount > 0;

  const noData = fulFilled && !loadding && filteredTests.length === 0;

  useEffect(() => {
    const actual = new Set(tests.map((test) => test.value));
    setSelectedTestNames((prev) => {
      const next = prev.filter((testName) => actual.has(testName));

      if (
        next.length === prev.length &&
        next.every((name, i) => name === prev[i])
      ) {
        return prev;
      }

      return next;
    });
  }, [tests]);

  const handleToggleSelection = (testName: string, checked: boolean) => {
    setSelectedTestNames((prev) => {
      if (checked) {
        if (prev.includes(testName)) {
          return prev;
        }
        return [...prev, testName];
      }

      return prev.filter((name) => name !== testName);
    });
  };

  const handleSelectAllFiltered = (checked: boolean) => {
    setSelectedTestNames((prev) => {
      if (!checked) {
        const filteredSet = new Set(filteredTestNames);
        return prev.filter((name) => !filteredSet.has(name));
      }

      const next = new Set(prev);
      for (const name of filteredTestNames) {
        next.add(name);
      }
      return Array.from(next);
    });
  };

  const handleDeleteSelected = async () => {
    const selectedSet = new Set(selectedTestNames);
    const targets = filteredTests.filter((test) => selectedSet.has(test.value));

    if (targets.length === 0 || isDeletingSelected) {
      setIsDeleteSelectedOpen(false);
      return;
    }

    setIsDeletingSelected(true);

    try {
      const results = await Promise.allSettled(
        targets.map(async (test) => {
          const strategyName = test.data?.strategyName as string | undefined;
          if (!strategyName) {
            throw new Error(`Missing strategy for ${test.value}`);
          }

          const deleted = await deleteBacktest(test.value, strategyName);
          if (!deleted) {
            throw new Error(`Delete failed for ${test.value}`);
          }

          await removeBacktestTest(test.value);
          return test.value;
        }),
      );

      const successCount = results.filter(
        (item) => item.status === 'fulfilled',
      ).length;
      const failedCount = results.length - successCount;

      if (successCount > 0) {
        const deletedSet = new Set(
          results
            .filter((item) => item.status === 'fulfilled')
            .map((item) => item.value),
        );
        setSelectedTestNames((prev) =>
          prev.filter((testName) => !deletedSet.has(testName)),
        );
      }

      if (failedCount === 0) {
        toaster.success({
          title: 'Tests deleted',
          description: `Deleted: ${successCount}`,
        });
      } else {
        toaster.error({
          title: 'Bulk delete finished with errors',
          description: `Deleted: ${successCount} of ${targets.length}`,
        });
      }
    } catch {
      toaster.error({
        title: 'Delete failed',
        description: 'Failed to delete selected tests.',
      });
    } finally {
      setIsDeletingSelected(false);
      setIsDeleteSelectedOpen(false);
    }
  };

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
            mb={2}
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
          <Flex mb={4} pl={2} gap={4} alignItems="center" w="full" minH="32px">
            <Checkbox.Root
              size="sm"
              colorPalette="teal"
              checked={
                allFilteredSelected
                  ? true
                  : hasSelectedInFilter
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={(details) =>
                handleSelectAllFiltered(details.checked === true)
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
            </Checkbox.Root>
            <Text color="gray.200" fontWeight="semibold">
              Selected: {selectedFilteredCount}
            </Text>

            <Dialog.Root
              open={isDeleteSelectedOpen}
              onOpenChange={(e) => setIsDeleteSelectedOpen(e.open)}
            >
              <Dialog.Trigger asChild>
                <Button
                  size="sm"
                  colorPalette="red"
                  variant="outline"
                  disabled={!hasSelectedInFilter || isDeletingSelected}
                >
                  Delete
                </Button>
              </Dialog.Trigger>
              <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                  <Dialog.Content>
                    <Dialog.Header>
                      <Dialog.Title>Delete selected tests</Dialog.Title>
                      <Dialog.CloseTrigger asChild>
                        <CloseButton position="absolute" right="3" top="3" />
                      </Dialog.CloseTrigger>
                    </Dialog.Header>
                    <Dialog.Body>
                      <Text fontSize="sm" color="gray.200">
                        Delete selected tests ({selectedFilteredCount})?
                      </Text>
                      <Text fontSize="sm" color="gray.400" mt={2}>
                        This action cannot be undone.
                      </Text>
                    </Dialog.Body>
                    <Dialog.Footer>
                      <Dialog.ActionTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isDeletingSelected}
                        >
                          Cancel
                        </Button>
                      </Dialog.ActionTrigger>
                      <Button
                        colorPalette="red"
                        size="sm"
                        onClick={handleDeleteSelected}
                        loading={isDeletingSelected}
                      >
                        Delete
                      </Button>
                    </Dialog.Footer>
                  </Dialog.Content>
                </Dialog.Positioner>
              </Portal>
            </Dialog.Root>
          </Flex>
          <Box flex="1" h="full" w="full">
            <TestList
              tests={filteredTests}
              loadding={loadding}
              fulFilled={fulFilled}
              noData={noData}
              selectedTestNames={selectedTestNames}
              onToggleSelection={handleToggleSelection}
            />
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default Backtest;
