'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, ClientOnly, Flex } from '@chakra-ui/react';
import { usePathname } from 'next/navigation';
import { FiFolder } from 'react-icons/fi';
import type { StrategyChartsSnapshotResponse } from '@tradejs/types';
import {
  deleteStrategyCard,
  getAiStrategies,
  getReplayStrategies,
  getRuntimeStrategies,
} from '#actions/strategies';
import { RuntimeStrategyCard } from '#components/Strategies/RuntimeStrategyCard';
import { RuntimeStrategyCardSkeleton } from '#components/Strategies/RuntimeStrategyCardSkeleton';
import { RuntimeStrategyConfigDrawer } from '#components/Strategies/RuntimeStrategyConfigDrawer';
import { StrategySnapshotList } from '#components/Strategies/StrategySnapshotList';
import { BacktestResultsPageClient } from '#components/Backtest/ResultsPageClient';
import {
  BulkDeleteToolbar,
  useBulkSelection,
} from '#components/Shared/BulkSelection';
import type { RuntimeStrategiesResponse } from '#app/lib/runtimeStrategies';
import { EmptyState, Segment, Select, toaster } from '#ui';

const ALL_STRATEGIES = '__all__';
const ALL_RUNTIME_SCOPES = '__all_runtime_scopes__';
type StrategyMode = 'runtime' | 'replay' | 'ai' | 'backtest';
type RuntimeStatusFilter = 'all' | 'enabled' | 'disabled';

const MODE_ITEMS = [
  { label: 'Runtime', value: 'runtime' },
  { label: 'Replay', value: 'replay' },
  { label: 'AI', value: 'ai' },
  { label: 'Backtest', value: 'backtest' },
];
const RUNTIME_STATUS_ITEMS = [
  { label: 'All', value: 'all' },
  { label: 'Enabled', value: 'enabled' },
  { label: 'Disabled', value: 'disabled' },
];
const HOURS_OPTIONS = [
  { label: 'Last 24h', value: '24' },
  { label: 'Last 7d', value: '168' },
  { label: 'Last 30d', value: '720' },
  { label: 'Last 60d', value: '1440' },
  { label: 'Last 90d', value: '2160' },
];

const normalizeMode = (value: string | null | undefined): StrategyMode =>
  value === 'replay' || value === 'ai' || value === 'backtest'
    ? value
    : 'runtime';

interface PendingSnapshotDelete {
  mode: 'replay' | 'ai';
  label: string;
  labelLower: string;
  cardIds: string[];
}

const modeFromPathname = (pathname: string | null) => {
  const segment = pathname?.split('/').filter(Boolean).at(-1);
  return normalizeMode(segment);
};

const RuntimeStrategiesContent = () => {
  const pathname = usePathname();
  const routeMode = modeFromPathname(pathname);
  const [mode, setMode] = useState<StrategyMode>(routeMode);
  const [hours, setHours] = useState('168');
  const [selectedStrategy, setSelectedStrategy] = useState(ALL_STRATEGIES);
  const [runtimeStatusFilter, setRuntimeStatusFilter] =
    useState<RuntimeStatusFilter>('all');
  const [runtimeUniverse, setRuntimeUniverse] = useState(ALL_RUNTIME_SCOPES);
  const [isDeleteSelectedOpen, setIsDeleteSelectedOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [pendingSnapshotDelete, setPendingSnapshotDelete] =
    useState<PendingSnapshotDelete | null>(null);
  const [loading, setLoading] = useState(false);
  const [fulfilled, setFulfilled] = useState(false);
  const [error, setError] = useState('');
  const [runtimeData, setRuntimeData] =
    useState<RuntimeStrategiesResponse | null>(null);
  const [createRuntimeConfigOpen, setCreateRuntimeConfigOpen] = useState(false);
  const [snapshotData, setSnapshotData] =
    useState<StrategyChartsSnapshotResponse | null>(null);
  const isSnapshotMode = mode === 'replay' || mode === 'ai';
  const snapshotModeLabel = mode === 'replay' ? 'Replay' : 'AI';
  const snapshotModeLabelLower = snapshotModeLabel.toLowerCase();

  useEffect(() => {
    setMode(routeMode);
  }, [routeMode]);

  useEffect(() => {
    const handlePopState = () => {
      setMode(modeFromPathname(window.location.pathname));
      setSelectedStrategy(ALL_STRATEGIES);
      setRuntimeStatusFilter('all');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const updateMode = useCallback((value: string | null) => {
    const nextMode = normalizeMode(value);

    setMode(nextMode);
    setSelectedStrategy(ALL_STRATEGIES);
    setRuntimeStatusFilter('all');

    window.history.pushState(null, '', `/routes/strategies/${nextMode}`);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      if (mode === 'runtime') {
        const response = await getRuntimeStrategies({ hours: Number(hours) });
        setRuntimeData(response);
        setSnapshotData(null);

        const exchangeErrors = response.dataSources?.exchangeErrors ?? [];
        if (exchangeErrors.length > 0) {
          toaster.error({
            title: 'Exchange fallback unavailable',
            description: exchangeErrors.slice(0, 2).join('; '),
          });
        }
      } else if (mode === 'replay') {
        const response = await getReplayStrategies();
        setSnapshotData(response);
        setRuntimeData(null);
      } else if (mode === 'ai') {
        const response = await getAiStrategies();
        setSnapshotData(response);
        setRuntimeData(null);
      } else {
        setRuntimeData(null);
        setSnapshotData(null);
      }
      setFulfilled(true);
    } catch (err) {
      const message =
        (err as Error)?.message ||
        `Failed to load ${mode === 'runtime' ? 'runtime strategies' : `${mode} strategy charts`}`;
      setError(message);
      toaster.error({
        title: 'Failed to load strategies',
        description: message,
      });
      setFulfilled(true);
    } finally {
      setLoading(false);
    }
  }, [hours, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const strategyItems = useMemo(() => {
    const names = [
      ...new Set(
        mode === 'runtime'
          ? runtimeData?.strategies.map((strategy) => strategy.strategyName) ??
            []
          : snapshotData?.strategies.map((strategy) => strategy.strategyName) ??
            [],
      ),
    ].sort((left, right) => left.localeCompare(right));

    return [
      { label: 'All strategies', value: ALL_STRATEGIES },
      ...names.map((name) => ({ label: name, value: name })),
    ];
  }, [mode, runtimeData?.strategies, snapshotData?.strategies]);

  useEffect(() => {
    if (!strategyItems.some((item) => item.value === selectedStrategy)) {
      setSelectedStrategy(ALL_STRATEGIES);
    }
  }, [selectedStrategy, strategyItems]);

  const filteredRuntimeStrategies = useMemo(() => {
    const strategies = runtimeData?.strategies ?? [];

    return strategies.filter((strategy) => {
      if (
        selectedStrategy !== ALL_STRATEGIES &&
        strategy.strategyName !== selectedStrategy
      ) {
        return false;
      }
      if (
        runtimeUniverse !== ALL_RUNTIME_SCOPES &&
        strategy.universe !== runtimeUniverse
      ) {
        return false;
      }
      if (runtimeStatusFilter === 'enabled') {
        return strategy.enabled;
      }

      if (runtimeStatusFilter === 'disabled') {
        return !strategy.enabled;
      }

      return true;
    });
  }, [
    runtimeData?.strategies,
    runtimeStatusFilter,
    runtimeUniverse,
    selectedStrategy,
  ]);

  const runtimeUniverseItems = useMemo(() => {
    const strategies = runtimeData?.strategies ?? [];
    return [
      { label: 'All universes', value: ALL_RUNTIME_SCOPES },
      ...[...new Set(strategies.map(({ universe }) => universe))]
        .sort()
        .map((value) => ({ label: value, value })),
    ];
  }, [runtimeData?.strategies]);

  const filteredSnapshotStrategies = useMemo(() => {
    const strategies = snapshotData?.strategies ?? [];

    if (selectedStrategy === ALL_STRATEGIES) {
      return strategies;
    }

    return strategies.filter(
      (strategy) => strategy.strategyName === selectedStrategy,
    );
  }, [snapshotData?.strategies, selectedStrategy]);

  const filteredSnapshotCardIds = useMemo(
    () => filteredSnapshotStrategies.map((strategy) => strategy.cardId),
    [filteredSnapshotStrategies],
  );
  const allSnapshotCardIds = useMemo(
    () => snapshotData?.strategies.map((strategy) => strategy.cardId) ?? [],
    [snapshotData?.strategies],
  );
  const {
    selectedIdSet: selectedSnapshotCardIdSet,
    selectedScopedIds: selectedFilteredSnapshotCardIds,
    selectedScopedCount: selectedFilteredCount,
    hasScopedSelection: hasSelectedInFilter,
    checkboxState: selectionCheckboxState,
    toggleSelection: handleToggleSnapshotSelection,
    setScopeSelected: handleSelectAllFilteredSnapshots,
    removeSelection: removeDeletedSnapshotSelection,
    clearSelection: clearSnapshotSelection,
  } = useBulkSelection({
    scopeIds: filteredSnapshotCardIds,
    validIds: allSnapshotCardIds,
    enabled: isSnapshotMode,
  });

  useEffect(() => {
    clearSnapshotSelection();
    setPendingSnapshotDelete(null);
    setIsDeleteSelectedOpen(false);
  }, [clearSnapshotSelection, mode]);

  const handleSnapshotDeleted = useCallback(
    (cardId: string) => {
      setSnapshotData((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          strategies: prev.strategies.filter(
            (strategy) => strategy.cardId !== cardId,
          ),
        };
      });
      removeDeletedSnapshotSelection([cardId]);
    },
    [removeDeletedSnapshotSelection],
  );

  const handleOpenDeleteSelectedSnapshots = () => {
    if (!isSnapshotMode || selectedFilteredSnapshotCardIds.length === 0) {
      setIsDeleteSelectedOpen(false);
      setPendingSnapshotDelete(null);
      return;
    }

    setPendingSnapshotDelete({
      mode,
      label: snapshotModeLabel,
      labelLower: snapshotModeLabelLower,
      cardIds: selectedFilteredSnapshotCardIds,
    });
    setIsDeleteSelectedOpen(true);
  };

  const handleDeleteSelectedSnapshots = async () => {
    const pendingDelete = pendingSnapshotDelete;

    if (
      !pendingDelete ||
      pendingDelete.cardIds.length === 0 ||
      isDeletingSelected
    ) {
      setIsDeleteSelectedOpen(false);
      setPendingSnapshotDelete(null);
      return;
    }

    setIsDeletingSelected(true);

    try {
      const results = await Promise.allSettled(
        pendingDelete.cardIds.map(async (cardId) => {
          const deleted = await deleteStrategyCard(pendingDelete.mode, cardId);
          if (!deleted) {
            throw new Error(`Delete failed for ${cardId}`);
          }

          return cardId;
        }),
      );

      const deletedIds = results
        .filter((item) => item.status === 'fulfilled')
        .map((item) => item.value);
      const successCount = deletedIds.length;
      const failedCount = results.length - successCount;

      if (successCount > 0) {
        const deletedSet = new Set(deletedIds);
        setSnapshotData((prev) =>
          prev
            ? {
                ...prev,
                strategies: prev.strategies.filter(
                  (strategy) => !deletedSet.has(strategy.cardId),
                ),
              }
            : prev,
        );
        removeDeletedSnapshotSelection(deletedIds);
      }

      if (failedCount === 0) {
        toaster.success({
          title: `${pendingDelete.label} cards deleted`,
          description: `Deleted: ${successCount}`,
        });
      } else {
        toaster.error({
          title: 'Bulk delete finished with errors',
          description: `Deleted: ${successCount} of ${pendingDelete.cardIds.length}`,
        });
      }
    } catch {
      toaster.error({
        title: 'Delete failed',
        description: `Failed to delete selected ${pendingDelete.labelLower} cards.`,
      });
    } finally {
      setIsDeletingSelected(false);
      setIsDeleteSelectedOpen(false);
      setPendingSnapshotDelete(null);
    }
  };

  const handleBulkDeleteDialogOpenChange = (open: boolean) => {
    setIsDeleteSelectedOpen(open);

    if (!open && !isDeletingSelected) {
      setPendingSnapshotDelete(null);
    }
  };

  const noData =
    fulfilled &&
    !loading &&
    !error &&
    (mode === 'runtime'
      ? filteredRuntimeStrategies.length === 0
      : filteredSnapshotStrategies.length === 0);

  const emptyTitle =
    mode === 'runtime'
      ? 'No runtime strategies found'
      : mode === 'replay'
        ? 'No replay charts found'
        : 'No AI charts found';

  const emptyDescription =
    mode === 'runtime'
      ? 'No connected strategies or runtime trades were found for the selected window.'
      : mode === 'replay'
        ? 'Run `yarn replay --chart` to save replay strategy cards for this page.'
        : 'Run `yarn ai-train --chart` to save strategy-wide AI cards for this page.';

  const deleteSelectedSnapshotCount =
    pendingSnapshotDelete?.cardIds.length ?? selectedFilteredCount;
  const deleteSnapshotLabel = pendingSnapshotDelete?.label ?? snapshotModeLabel;
  const snapshotEmptyText =
    mode === 'replay'
      ? 'No replay trades for the selected run.'
      : 'No approved trades for this quality bucket.';
  const modeSegment = (
    <Segment
      defaultValue="runtime"
      value={mode}
      onChange={updateMode}
      items={MODE_ITEMS}
    />
  );

  if (mode === 'backtest') {
    return <BacktestResultsPageClient toolbarPrefix={modeSegment} />;
  }

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
            width="full"
            pr={4}
          >
            <Flex gap={3} alignItems="center">
              {modeSegment}
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
              {mode === 'runtime' ? (
                <Select
                  placeholder="Window"
                  value={[hours]}
                  defaultValue={[hours]}
                  onChange={(value) => setHours(value[0] || '168')}
                  items={HOURS_OPTIONS}
                  width="180px"
                />
              ) : null}
              {mode === 'runtime' ? (
                <Segment
                  defaultValue="all"
                  value={runtimeStatusFilter}
                  onChange={(value) =>
                    setRuntimeStatusFilter(
                      value === 'enabled' || value === 'disabled'
                        ? value
                        : 'all',
                    )
                  }
                  items={RUNTIME_STATUS_ITEMS}
                />
              ) : null}
              {mode === 'runtime' ? (
                <Select
                  value={[runtimeUniverse]}
                  defaultValue={[runtimeUniverse]}
                  onChange={(value) =>
                    setRuntimeUniverse(value[0] || ALL_RUNTIME_SCOPES)
                  }
                  items={runtimeUniverseItems}
                  width="160px"
                />
              ) : null}
            </Flex>
            {mode === 'runtime' ? (
              <Button
                ml="auto"
                colorPalette="teal"
                onClick={() => setCreateRuntimeConfigOpen(true)}
              >
                Create
              </Button>
            ) : null}
          </Flex>

          <RuntimeStrategyConfigDrawer
            open={createRuntimeConfigOpen}
            onOpenChange={setCreateRuntimeConfigOpen}
            onSaved={load}
          />

          {isSnapshotMode ? (
            <BulkDeleteToolbar
              selectedCount={selectedFilteredCount}
              checkboxState={selectionCheckboxState}
              hasSelection={hasSelectedInFilter}
              isDeleting={isDeletingSelected}
              dialogOpen={isDeleteSelectedOpen}
              deleteTitle={`Delete selected ${deleteSnapshotLabel} cards`}
              deleteDescription={`Delete selected ${deleteSnapshotLabel} cards (${deleteSelectedSnapshotCount})?`}
              onDialogOpenChange={handleBulkDeleteDialogOpenChange}
              onToggleAll={handleSelectAllFilteredSnapshots}
              onRequestDelete={handleOpenDeleteSelectedSnapshots}
              onConfirmDelete={handleDeleteSelectedSnapshots}
            />
          ) : null}

          <Box flex="1" h="full" w="full">
            {loading ? (
              <>
                <RuntimeStrategyCardSkeleton />
                <RuntimeStrategyCardSkeleton />
              </>
            ) : null}

            {noData ? (
              <EmptyState
                icon={FiFolder}
                title={emptyTitle}
                description={emptyDescription}
              />
            ) : null}

            {!loading &&
              mode === 'runtime' &&
              filteredRuntimeStrategies.map((strategy) => (
                <RuntimeStrategyCard
                  key={strategy.runtimeKey}
                  strategy={strategy}
                  provider={runtimeData?.provider || 'bybit'}
                  onUpdated={load}
                />
              ))}

            {!loading && mode !== 'runtime' ? (
              <StrategySnapshotList
                strategies={filteredSnapshotStrategies}
                mode={mode}
                selectedCardIds={selectedSnapshotCardIdSet}
                onDeleted={handleSnapshotDeleted}
                onToggleSelection={handleToggleSnapshotSelection}
                emptyText={snapshotEmptyText}
              />
            ) : null}
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

const RuntimeStrategiesPage = () => (
  <Suspense fallback={null}>
    <RuntimeStrategiesContent />
  </Suspense>
);

export default RuntimeStrategiesPage;
