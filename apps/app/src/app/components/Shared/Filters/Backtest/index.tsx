'use client';

import _ from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { Select } from '#ui';
import { useFiltersContext } from '../context';

export const SelectBacktest = () => {
  const { filters, backtestFiles, onChangeFilters, ensureBacktestsLoaded } =
    useFiltersContext();
  const STORAGE_KEY = 'backtest-strategy';

  const tests = useMemo(
    () => backtestFiles.filter((file) => file.value.startsWith(filters.symbol)),
    [backtestFiles, filters.symbol],
  );

  const strategyItems = useMemo(() => {
    const names = new Set<string>();
    for (const test of tests) {
      const strategyName = test.data?.strategyName;
      if (typeof strategyName === 'string' && strategyName) {
        names.add(strategyName);
      }
    }

    return Array.from(names)
      .sort()
      .map((strategyName) => ({
        label: strategyName,
        value: strategyName,
      }));
  }, [tests]);

  const [selectedStrategy, setSelectedStrategy] = useState<string>('');

  useEffect(() => {
    if (_.isEmpty(strategyItems)) {
      setSelectedStrategy('');
      return;
    }

    if (
      filters.backtestStrategy &&
      strategyItems.some((item) => item.value === filters.backtestStrategy) &&
      selectedStrategy !== filters.backtestStrategy
    ) {
      setSelectedStrategy(filters.backtestStrategy);
      return;
    }

    if (
      selectedStrategy &&
      strategyItems.some((item) => item.value === selectedStrategy)
    ) {
      return;
    }

    const saved =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;

    const defaultStrategy =
      saved && strategyItems.some((item) => item.value === saved)
        ? saved
        : strategyItems[0]?.value || '';

    if (defaultStrategy) {
      setSelectedStrategy(defaultStrategy);
    }
  }, [strategyItems, filters.backtestStrategy, selectedStrategy]);

  useEffect(() => {
    if (!filters.backtestId) return;

    const selectedTest = tests.find(
      (test) => test.value === filters.backtestId,
    );
    const strategyName = selectedTest?.data?.strategyName;

    if (
      typeof strategyName === 'string' &&
      strategyName &&
      selectedStrategy !== strategyName
    ) {
      setSelectedStrategy(strategyName);
    }
  }, [filters.backtestId, tests, selectedStrategy]);

  useEffect(() => {
    if (selectedStrategy && typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, selectedStrategy);
    }
  }, [selectedStrategy]);

  const onChange = (value: string[]) => {
    onChangeFilters?.({
      backtestId: value[0] || null,
    });
  };

  const onChangeStrategy = (value: string[]) => {
    const nextStrategy = value[0] || '';
    setSelectedStrategy(nextStrategy);
    if (nextStrategy && typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, nextStrategy);
    }

    const hasSelectedTest =
      filters.backtestId &&
      tests.some(
        (test) =>
          test.value === filters.backtestId &&
          test.data?.strategyName === nextStrategy,
      );

    if (!hasSelectedTest) {
      onChangeFilters?.({
        backtestId: null,
        backtestStrategy: nextStrategy || null,
      });
      return;
    }

    if (filters.backtestStrategy !== nextStrategy) {
      onChangeFilters?.({ backtestStrategy: nextStrategy || null });
    }
  };

  const strategyTests = tests.filter(
    (test) => test.data?.strategyName === selectedStrategy,
  );
  const hasStrategyItems = !_.isEmpty(strategyItems);

  return (
    <>
      <Select
        placeholder={hasStrategyItems ? 'Strategy' : 'No strategies'}
        emptyState="No strategies for this symbol"
        defaultValue={[selectedStrategy]}
        value={[selectedStrategy]}
        onChange={onChangeStrategy}
        onOpenChange={(open) => {
          if (open) {
            void ensureBacktestsLoaded?.();
          }
        }}
        items={strategyItems}
        disabled={!hasStrategyItems}
        width="220px"
      />
      <Select
        placeholder="Backtest"
        defaultValue={[filters.backtestId || '']}
        value={[filters.backtestId || '']}
        onChange={onChange}
        onOpenChange={(open) => {
          if (open) {
            void ensureBacktestsLoaded?.();
          }
        }}
        items={[
          {
            label: 'Not selected',
            value: '',
          },
          ...strategyTests,
        ]}
        width="240px"
      />
    </>
  );
};
