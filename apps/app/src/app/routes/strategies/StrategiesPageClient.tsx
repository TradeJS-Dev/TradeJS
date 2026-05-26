'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
import { StrategySnapshotCard } from '#components/Strategies/StrategySnapshotCard';
import type { RuntimeStrategiesResponse } from '#app/lib/runtimeStrategies';
import { EmptyState, Segment, Select, toaster } from '#ui';

const ALL_STRATEGIES = '__all__';
type StrategyMode = 'runtime' | 'replay' | 'ai';

const MODE_ITEMS = [
  { label: 'Runtime', value: 'runtime' },
  { label: 'Replay', value: 'replay' },
  { label: 'AI', value: 'ai' },
];
const HOURS_OPTIONS = [
  { label: 'Last 24h', value: '24' },
  { label: 'Last 7d', value: '168' },
  { label: 'Last 30d', value: '720' },
  { label: 'Last 90d', value: '2160' },
];

const normalizeMode = (value: string | null | undefined): StrategyMode =>
  value === 'replay' || value === 'ai' ? value : 'runtime';

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
  const [selectedSnapshotCardIds, setSelectedSnapshotCardIds] = useState<
    string[]
  >([]);
  const [isDeleteSelectedOpen, setIsDeleteSelectedOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fulfilled, setFulfilled] = useState(false);
  const [error, setError] = useState('');
  const [runtimeData, setRuntimeData] =
    useState<RuntimeStrategiesResponse | null>(null);
  const [snapshotData, setSnapshotData] =
    useState<StrategyChartsSnapshotResponse | null>(null);

  useEffect(() => {
    setMode(routeMode);
  }, [routeMode]);

  useEffect(() => {
    const handlePopState = () => {
      setMode(modeFromPathname(window.location.pathname));
      setSelectedStrategy(ALL_STRATEGIES);
      setSelectedSnapshotCardIds([]);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const updateMode = useCallback((value: string | null) => {
    const nextMode = normalizeMode(value);

    setMode(nextMode);
    setSelectedStrategy(ALL_STRATEGIES);
    setSelectedSnapshotCardIds([]);

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
      } else if (mode === 'replay') {
        const response = await getReplayStrategies();
        setSnapshotData(response);
        setRuntimeData(null);
      } else {
        const response = await getAiStrategies();
        setSnapshotData(response);
        setRuntimeData(null);
      }
      setFulfilled(true);
    } catch (err) {
      setError(
        (err as Error)?.message ||
          `Failed to load ${mode === 'runtime' ? 'runtime strategies' : `${mode} strategy charts`}`,
      );
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

    if (selectedStrategy === ALL_STRATEGIES) {
      return strategies;
    }

    return strategies.filter(
      (strategy) => strategy.strategyName === selectedStrategy,
    );
  }, [runtimeData?.strategies, selectedStrategy]);

  const filteredSnapshotStrategies = useMemo(() => {
    const strategies = snapshotData?.strategies ?? [];

    if (selectedStrategy === ALL_STRATEGIES) {
      return strategies;
    }

    return strategies.filter(
      (strategy) => strategy.strategyName === selectedStrategy,
    );
  }, [snapshotData?.strategies, selectedStrategy]);

  const handleSnapshotDeleted = useCallback((cardId: string) => {
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
    setSelectedSnapshotCardIds((prev) => prev.filter((id) => id !== cardId));
  }, []);

  const filteredSnapshotCardIds = useMemo(
    () => filteredSnapshotStrategies.map((strategy) => strategy.cardId),
    [filteredSnapshotStrategies],
  );

  const selectedFilteredCount = useMemo(() => {
    const filteredSet = new Set(filteredSnapshotCardIds);
    return selectedSnapshotCardIds.filter((cardId) => filteredSet.has(cardId))
      .length;
  }, [filteredSnapshotCardIds, selectedSnapshotCardIds]);

  const allFilteredSelected =
    mode === 'ai' &&
    filteredSnapshotStrategies.length > 0 &&
    selectedFilteredCount === filteredSnapshotStrategies.length;
  const hasSelectedInFilter = mode === 'ai' && selectedFilteredCount > 0;

  useEffect(() => {
    if (mode !== 'ai') {
      setSelectedSnapshotCardIds([]);
      return;
    }

    const actual = new Set(snapshotData?.strategies.map((item) => item.cardId));
    setSelectedSnapshotCardIds((prev) => {
      const next = prev.filter((cardId) => actual.has(cardId));

      if (
        next.length === prev.length &&
        next.every((cardId, index) => cardId === prev[index])
      ) {
        return prev;
      }

      return next;
    });
  }, [mode, snapshotData?.strategies]);

  const handleToggleSnapshotSelection = (cardId: string, checked: boolean) => {
    setSelectedSnapshotCardIds((prev) => {
      if (checked) {
        if (prev.includes(cardId)) {
          return prev;
        }
        return [...prev, cardId];
      }

      return prev.filter((id) => id !== cardId);
    });
  };

  const handleSelectAllFilteredSnapshots = (checked: boolean) => {
    setSelectedSnapshotCardIds((prev) => {
      const filteredSet = new Set(filteredSnapshotCardIds);

      if (!checked) {
        return prev.filter((cardId) => !filteredSet.has(cardId));
      }

      const next = new Set(prev);
      for (const cardId of filteredSnapshotCardIds) {
        next.add(cardId);
      }
      return Array.from(next);
    });
  };

  const handleDeleteSelectedSnapshots = async () => {
    const selectedSet = new Set(selectedSnapshotCardIds);
    const targets = filteredSnapshotStrategies.filter((strategy) =>
      selectedSet.has(strategy.cardId),
    );

    if (mode !== 'ai' || targets.length === 0 || isDeletingSelected) {
      setIsDeleteSelectedOpen(false);
      return;
    }

    setIsDeletingSelected(true);

    try {
      const results = await Promise.allSettled(
        targets.map(async (strategy) => {
          const deleted = await deleteStrategyCard('ai', strategy.cardId);
          if (!deleted) {
            throw new Error(`Delete failed for ${strategy.cardId}`);
          }

          return strategy.cardId;
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
        setSelectedSnapshotCardIds((prev) =>
          prev.filter((cardId) => !deletedSet.has(cardId)),
        );
      }

      if (failedCount === 0) {
        toaster.success({
          title: 'AI cards deleted',
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
        description: 'Failed to delete selected AI cards.',
      });
    } finally {
      setIsDeletingSelected(false);
      setIsDeleteSelectedOpen(false);
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
              <Segment
                defaultValue="runtime"
                value={mode}
                onChange={updateMode}
                items={MODE_ITEMS}
              />
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
            </Flex>
          </Flex>

          {mode === 'ai' ? (
            <Flex
              mb={4}
              pl={2}
              gap={4}
              alignItems="center"
              w="full"
              minH="32px"
            >
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
                  handleSelectAllFilteredSnapshots(details.checked === true)
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control bg="gray.800" borderColor="gray.500" />
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
                        <Dialog.Title>Delete selected AI cards</Dialog.Title>
                        <Dialog.CloseTrigger asChild>
                          <CloseButton position="absolute" right="3" top="3" />
                        </Dialog.CloseTrigger>
                      </Dialog.Header>
                      <Dialog.Body>
                        <Text fontSize="sm" color="gray.200">
                          Delete selected AI cards ({selectedFilteredCount})?
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
                          onClick={handleDeleteSelectedSnapshots}
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
          ) : null}

          {error ? (
            <Box
              ml={2}
              mb={4}
              p={4}
              borderRadius="md"
              borderWidth="1px"
              borderColor="red.900"
              bg="red.950"
            >
              <Text color="red.200">{error}</Text>
            </Box>
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
                  key={strategy.strategyName}
                  strategy={strategy}
                  provider={runtimeData?.provider || 'bybit'}
                />
              ))}

            {!loading &&
              mode !== 'runtime' &&
              filteredSnapshotStrategies.map((strategy) => (
                <StrategySnapshotCard
                  key={strategy.cardId}
                  snapshot={strategy}
                  mode={mode}
                  onDeleted={handleSnapshotDeleted}
                  selected={selectedSnapshotCardIds.includes(strategy.cardId)}
                  onToggleSelection={
                    mode === 'ai' ? handleToggleSnapshotSelection : undefined
                  }
                  emptyText={
                    mode === 'replay'
                      ? 'No replay trades for the selected run.'
                      : 'No approved trades for this quality bucket.'
                  }
                />
              ))}
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
