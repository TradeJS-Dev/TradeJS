'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box, ClientOnly, Flex } from '@chakra-ui/react';
import { deleteBacktest } from '#actions/backtest';
import { useBacktestMutations, useTestList } from '#store';
import { Select, toaster } from '#ui';
import { CompareList } from '#components/Backtest/CompareList';
import { TestList } from '#components/Backtest/TestList';
import {
  BulkDeleteToolbar,
  useBulkSelection,
} from '#components/Shared/BulkSelection';
import { parseTestName } from '@tradejs/core/backtest';

const ALL_STRATEGIES = '__all__';
const ALL_SUITES = '__all__';
const ALL_CONFIGS = '__all__';

interface PendingBacktestDelete {
  value: string;
  strategyName?: string;
}

const Backtest = () => {
  const { tests, loadding, fulFilled } = useTestList();
  const { removeBacktestTest } = useBacktestMutations();
  const [isDeleteSelectedOpen, setIsDeleteSelectedOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [pendingDeleteTests, setPendingDeleteTests] = useState<
    PendingBacktestDelete[]
  >([]);
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
  const configItems = useMemo(() => {
    const names = new Set<string>();
    for (const test of tests) {
      if (
        selectedStrategy !== ALL_STRATEGIES &&
        test.data?.strategyName !== selectedStrategy
      ) {
        continue;
      }

      if (selectedSuite !== ALL_SUITES) {
        const { testSuiteId } = parseTestName(test.value);
        if (testSuiteId !== selectedSuite) {
          continue;
        }
      }

      const configId =
        typeof test.data?.configId === 'string' ? test.data.configId : '';
      if (configId) {
        names.add(configId);
      }
    }

    return [
      { label: 'All configs', value: ALL_CONFIGS },
      ...Array.from(names)
        .sort()
        .map((configId) => ({
          label: configId,
          value: configId,
        })),
    ];
  }, [tests, selectedStrategy, selectedSuite]);
  const [selectedConfigId, setSelectedConfigId] = useState(ALL_CONFIGS);

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

  useEffect(() => {
    if (!configItems.some((item) => item.value === selectedConfigId)) {
      setSelectedConfigId(configItems[0]?.value || ALL_CONFIGS);
    }
  }, [configItems, selectedConfigId]);

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
        if (testSuiteId !== selectedSuite) {
          return false;
        }
      }

      if (selectedConfigId !== ALL_CONFIGS) {
        return test.data?.configId === selectedConfigId;
      }

      return true;
    });
  }, [tests, selectedStrategy, selectedSuite, selectedConfigId]);

  const filteredTestNames = useMemo(
    () => filteredTests.map((test) => test.value),
    [filteredTests],
  );
  const allTestNames = useMemo(() => tests.map((test) => test.value), [tests]);
  const {
    selectedIds: selectedTestNames,
    selectedScopedCount: selectedFilteredCount,
    hasScopedSelection: hasSelectedInFilter,
    checkboxState: selectionCheckboxState,
    toggleSelection: handleToggleSelection,
    setScopeSelected: handleSelectAllFiltered,
    removeSelection: removeDeletedSelection,
  } = useBulkSelection({
    scopeIds: filteredTestNames,
    validIds: allTestNames,
  });

  const noData = fulFilled && !loadding && filteredTests.length === 0;

  const handleOpenDeleteSelected = () => {
    const selectedSet = new Set(selectedTestNames);
    const targets = filteredTests.filter((test) => selectedSet.has(test.value));

    if (targets.length === 0) {
      setIsDeleteSelectedOpen(false);
      setPendingDeleteTests([]);
      return;
    }

    setPendingDeleteTests(
      targets.map((test) => ({
        value: test.value,
        strategyName:
          typeof test.data?.strategyName === 'string'
            ? test.data.strategyName
            : undefined,
      })),
    );
    setIsDeleteSelectedOpen(true);
  };

  const handleDeleteSelected = async () => {
    const targets = pendingDeleteTests;

    if (targets.length === 0 || isDeletingSelected) {
      setIsDeleteSelectedOpen(false);
      setPendingDeleteTests([]);
      return;
    }

    setIsDeletingSelected(true);

    try {
      const results = await Promise.allSettled(
        targets.map(async (test) => {
          const strategyName = test.strategyName;
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
        const deletedIds = results
          .filter((item) => item.status === 'fulfilled')
          .map((item) => item.value);
        removeDeletedSelection(deletedIds);
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
      setPendingDeleteTests([]);
    }
  };

  const handleBulkDeleteDialogOpenChange = (open: boolean) => {
    setIsDeleteSelectedOpen(open);

    if (!open && !isDeletingSelected) {
      setPendingDeleteTests([]);
    }
  };

  const deleteSelectedTestCount = isDeleteSelectedOpen
    ? pendingDeleteTests.length
    : selectedFilteredCount;

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
              <Select
                placeholder="ConfigId"
                value={[selectedConfigId]}
                defaultValue={[selectedConfigId]}
                onChange={(value) =>
                  setSelectedConfigId(value[0] || ALL_CONFIGS)
                }
                items={configItems}
                width="180px"
              />
            </Flex>
            <CompareList />
          </Flex>
          <BulkDeleteToolbar
            selectedCount={selectedFilteredCount}
            checkboxState={selectionCheckboxState}
            hasSelection={hasSelectedInFilter}
            isDeleting={isDeletingSelected}
            dialogOpen={isDeleteSelectedOpen}
            deleteTitle="Delete selected tests"
            deleteDescription={`Delete selected tests (${deleteSelectedTestCount})?`}
            onDialogOpenChange={handleBulkDeleteDialogOpenChange}
            onToggleAll={handleSelectAllFiltered}
            onRequestDelete={handleOpenDeleteSelected}
            onConfirmDelete={handleDeleteSelected}
          />
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
