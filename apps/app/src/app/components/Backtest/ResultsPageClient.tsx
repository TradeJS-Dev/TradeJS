'use client';

import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, ClientOnly, Flex, Stack } from '@chakra-ui/react';
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
import { PageHeader, PageLayout } from '#shared/PageLayout';
import { updateUrlSearchParams } from '#app/lib/updateUrlSearchParams';

const ALL_STRATEGIES = '__all__';
const ALL_SUITES = '__all__';
const ALL_CONFIGS = '__all__';

interface BacktestResultsPageClientProps {
  toolbarPrefix?: React.ReactNode;
}

interface PendingBacktestDelete {
  value: string;
  strategyName?: string;
}

export const BacktestResultsPageClient = ({
  toolbarPrefix,
}: BacktestResultsPageClientProps) => {
  const searchParams = useSearchParams();
  const selectedStrategy = searchParams.get('strategy') || ALL_STRATEGIES;
  const selectedSuite = searchParams.get('suite') || ALL_SUITES;
  const selectedConfigId = searchParams.get('config') || ALL_CONFIGS;
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

  const updateBacktestFilters = (strategy: string, suite: string) => {
    const strategyTests = tests.filter(
      (test) =>
        strategy === ALL_STRATEGIES || test.data?.strategyName === strategy,
    );
    const nextSuite = strategyTests.some(
      (test) => parseTestName(test.value).testSuiteId === suite,
    )
      ? suite
      : ALL_SUITES;
    const hasConfig = strategyTests.some(
      (test) =>
        test.data?.configId === selectedConfigId &&
        (nextSuite === ALL_SUITES ||
          parseTestName(test.value).testSuiteId === nextSuite),
    );

    updateUrlSearchParams({
      strategy: strategy === ALL_STRATEGIES ? null : strategy,
      suite: nextSuite === ALL_SUITES ? null : nextSuite,
      config:
        hasConfig && selectedConfigId !== ALL_CONFIGS ? selectedConfigId : null,
    });
  };

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
      <PageLayout display="flex" h="100dvh" flexDirection="column">
        <Stack flex={1} minH={0} gap={4}>
          <PageHeader title="Backtest results" />
          <Flex gap={4} alignItems="center" wrap="wrap">
            <Flex gap={3} alignItems="center" wrap="wrap">
              {toolbarPrefix}
              <Select
                placeholder="Strategy"
                value={[selectedStrategy]}
                defaultValue={[selectedStrategy]}
                onChange={([value]) =>
                  updateBacktestFilters(value || ALL_STRATEGIES, selectedSuite)
                }
                items={strategyItems}
                width="220px"
              />
              <Select
                placeholder="Test suite"
                value={[selectedSuite]}
                defaultValue={[selectedSuite]}
                onChange={([value]) =>
                  updateBacktestFilters(selectedStrategy, value || ALL_SUITES)
                }
                items={suiteItems}
                width="180px"
              />
              <Select
                placeholder="Configuration"
                value={[selectedConfigId]}
                defaultValue={[selectedConfigId]}
                onChange={([value]) =>
                  updateUrlSearchParams({
                    config: value === ALL_CONFIGS ? null : value,
                  })
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
          <Box flex={1} minH={0} w="full">
            <TestList
              tests={filteredTests}
              loadding={loadding}
              fulFilled={fulFilled}
              noData={noData}
              selectedTestNames={selectedTestNames}
              onToggleSelection={handleToggleSelection}
            />
          </Box>
        </Stack>
      </PageLayout>
    </ClientOnly>
  );
};

export default BacktestResultsPageClient;
