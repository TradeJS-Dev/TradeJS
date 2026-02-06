'use client';

import _ from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { Select } from '@UI';
import { useFiltersContext } from '../context';

export const SelectBacktest = () => {
  const { filters, backtestFiles, onChangeFilters } = useFiltersContext();
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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || _.isEmpty(strategyItems)) return;
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
    } else if (strategyItems[0]) {
      setSelectedStrategy(strategyItems[0].value);
    }
    setHydrated(true);
  }, [hydrated, strategyItems]);

  useEffect(() => {
    if (!hydrated) return;
    if (
      selectedStrategy &&
      !strategyItems.some((item) => item.value === selectedStrategy)
    ) {
      setSelectedStrategy(strategyItems[0]?.value || '');
      return;
    }
    if (selectedStrategy && typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, selectedStrategy);
    }
    if (selectedStrategy && filters.backtestStrategy !== selectedStrategy) {
      onChangeFilters?.({
        ...filters,
        backtestStrategy: selectedStrategy,
      });
    }
  }, [hydrated, selectedStrategy, strategyItems, filters, onChangeFilters]);

  const onChange = (value: string[]) => {
    const newFilters = {
      ...filters,
      backtestId: value[0],
    };

    onChangeFilters?.(newFilters);
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
        ...filters,
        backtestId: null,
        backtestStrategy: nextStrategy || null,
      });
      return;
    }

    if (filters.backtestStrategy !== nextStrategy) {
      onChangeFilters?.({
        ...filters,
        backtestStrategy: nextStrategy || null,
      });
    }
  };

  if (_.isEmpty(tests) || _.isEmpty(strategyItems) || !selectedStrategy) {
    return null;
  }

  const strategyTests = tests.filter(
    (test) => test.data?.strategyName === selectedStrategy,
  );

  return (
    <>
      <Select
        placeholder="Strategy"
        defaultValue={[selectedStrategy]}
        onChange={onChangeStrategy}
        items={strategyItems}
        width="220px"
      />
      <Select
        placeholder="Backtest"
        defaultValue={[filters.backtestId || '']}
        onChange={onChange}
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
