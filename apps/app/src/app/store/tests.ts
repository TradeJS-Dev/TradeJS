import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import _ from 'lodash';
import { del, get, set } from 'idb-keyval';
import { getBacktest, getBacktestFiles, getOrderLog } from '#actions/backtest';
import {
  TestResult,
  TestCompareList,
  OrderLogData,
  OnChangeCompare,
} from '@tradejs/types';
import type { Items } from '#app/types/ui';
import { delay } from '@tradejs/core/async';
import { parseTestName } from '@tradejs/core/backtest';

const COMPARE_LOCAL_STORAGE_KEY = 'compare';
const FAVORITE_LOCAL_STORAGE_KEY = 'favorite';
let cacheSession: string | null = null;
let cacheGeneration = 0;
const scopedCacheKey = (kind: string, id = '', strategy = '') =>
  JSON.stringify(['backtest-cache-v3', cacheSession, kind, strategy, id]);
const cacheIdentity = (id: string, strategy?: string) =>
  JSON.stringify([strategy ?? '', id]);
const cacheName = (key: string) => {
  try {
    return JSON.parse(key)[1] as string;
  } catch {
    return key;
  }
};
const filesCacheKey = () => scopedCacheKey('files');
const BACKTEST_FILES_CACHE_TTL_MS = 5 * 60 * 1000;
const testLoadRequests = new Map<string, Promise<void>>();

const COLORS = [
  'purple',
  'orange',
  'red',
  'pink',
  'cyan',
  'yellow',
  'blue',
  'green',
];

type BacktestFilesCacheRecord = {
  savedAt: number;
  items: Items;
};

const isFresh = (savedAt: number) =>
  Date.now() - savedAt < BACKTEST_FILES_CACHE_TTL_MS;

interface BacktestState {
  backtests: Map<string, OrderLogData | null>;
  setBacktest: (id: string, backtest: OrderLogData) => void;
  removeBacktest: (id: string) => void;
}

const useDataStore = create<BacktestState>((set) => ({
  backtests: new Map<string, OrderLogData | null>(),
  setBacktest: (id, backtest) =>
    set(({ backtests }) => {
      const next = new Map(backtests);
      next.set(id, backtest);

      return {
        backtests: next,
      };
    }),
  removeBacktest: (id) =>
    set(({ backtests }) => {
      const next = new Map(backtests);
      for (const key of next.keys())
        if (cacheName(key) === id) next.delete(key);

      return {
        backtests: next,
      };
    }),
}));

interface FavotiteTestsState {
  tests: {
    testName: string;
    netProfit: number;
  }[];
  toggleFavorite: (testName: string, netProfit: number) => void;
  removeFavorite: (testName: string) => void;
}

const useFavoriteTetstsStore = create<FavotiteTestsState>()(
  persist(
    (set) => ({
      tests: [],
      toggleFavorite: (testName, netProfit) =>
        set(({ tests }) => {
          if (tests.some((t) => t.testName === testName)) {
            return {
              tests: tests.filter((t) => t.testName !== testName),
            };
          }

          return {
            tests: [
              ...tests,
              {
                testName,
                netProfit,
              },
            ],
          };
        }),
      removeFavorite: (testName) =>
        set(({ tests }) => ({
          tests: tests.filter((t) => t.testName !== testName),
        })),
    }),
    {
      name: `${FAVORITE_LOCAL_STORAGE_KEY}:v3:anonymous`,
      skipHydration: true,
    },
  ),
);

interface TestListState {
  tests: Items;
  loadedAt: number;
  inFlight?: Promise<Items>;
  setTest: (tests: Items, loadedAt?: number) => void;
  setInFlight: (request?: Promise<Items>) => void;
  removeTest: (testName: string) => void;
}

const useTestListStore = create<TestListState>((set) => ({
  tests: [],
  loadedAt: 0,
  inFlight: undefined,
  setTest: (tests, loadedAt = Date.now()) =>
    set(() => ({
      tests,
      loadedAt,
      inFlight: undefined,
    })),
  setInFlight: (request) =>
    set(() => ({
      inFlight: request,
    })),
  removeTest: (testName) =>
    set(({ tests }) => ({
      tests: tests.filter((t) => t.value !== testName),
    })),
}));

interface TestsCompareState {
  compareList: {
    testName: string;
    color: string;
  }[];
  onChangeCompare: OnChangeCompare;
  removeFromCompare: (testName: string) => void;
}

const useTestsCompareStore = create<TestsCompareState>()(
  persist(
    (set) => ({
      compareList: [],
      onChangeCompare: (testName) =>
        set(({ compareList }) => {
          if (!compareList.some((t) => t.testName === testName)) {
            const newState = [
              ...compareList,
              { testName, color: COLORS[compareList.length] },
            ];
            if (newState.length > COLORS.length) {
              newState.shift();
            }
            return { compareList: newState };
          }
          return {
            compareList: compareList.filter((t) => t.testName !== testName),
          };
        }),
      removeFromCompare: (testName) =>
        set(({ compareList }) => ({
          compareList: compareList.filter((t) => t.testName !== testName),
        })),
    }),
    {
      name: `${COMPARE_LOCAL_STORAGE_KEY}:v3:anonymous`,
      skipHydration: true,
    },
  ),
);

interface TestsState {
  tests: Map<string, TestResult | null>;
  setTest: (test: TestResult, identity?: string) => void;
  setTestUnavailable: (testName: string) => void;
  removeTest: (testName: string) => void;
}

const useTestsStore = create<TestsState>((set) => ({
  tests: new Map<string, TestResult | null>(),
  setTest: (testResult, identity = testResult.test.name) =>
    set(({ tests }) => {
      const next = new Map(tests);
      next.set(identity, testResult);

      return {
        tests: next,
      };
    }),
  setTestUnavailable: (testName) =>
    set(({ tests }) => {
      const next = new Map(tests);
      next.set(testName, null);

      return {
        tests: next,
      };
    }),
  removeTest: (testName) =>
    set(({ tests }) => {
      const next = new Map(tests);
      for (const key of next.keys())
        if (cacheName(key) === testName) next.delete(key);

      return {
        tests: next,
      };
    }),
}));

const loadBacktestFilesList = async () => {
  const { tests, loadedAt, inFlight, setInFlight, setTest } =
    useTestListStore.getState();

  if (loadedAt > 0 && isFresh(loadedAt)) {
    return tests;
  }

  if (inFlight) {
    return inFlight;
  }

  const generation = cacheGeneration;
  const pending = (async () => {
    const cached = (await get(
      filesCacheKey(),
    )) as BacktestFilesCacheRecord | null;

    if (generation !== cacheGeneration) return [];
    if (cached?.savedAt && isFresh(cached.savedAt)) {
      setTest(cached.items, cached.savedAt);
      return cached.items;
    }

    const newTests = await getBacktestFiles();
    if (generation !== cacheGeneration) return [];
    const savedAt = Date.now();
    setTest(newTests, savedAt);
    await set(filesCacheKey(), {
      savedAt,
      items: newTests,
    } satisfies BacktestFilesCacheRecord);
    return newTests;
  })().finally(() => {
    if (generation !== cacheGeneration) return;
    useTestListStore.getState().setInFlight(undefined);
  });

  setInFlight(pending);
  return pending;
};

export const useFavoriteTests = () => {
  const favotites = useFavoriteTetstsStore((s) => s.tests);
  const toggleFavorite = useFavoriteTetstsStore((s) => s.toggleFavorite);
  const removeFavorite = useFavoriteTetstsStore((s) => s.removeFavorite);
  const checkIsFavorite = (testName: string) =>
    favotites.some((t) => t.testName === testName);

  const favoriteItems: Items = favotites.map((t) => {
    const { symbol, testId } = parseTestName(t.testName);

    return {
      value: t.testName,
      label: `${symbol}_${testId}`,
      description: `${t.netProfit}$`,
      data: {
        netProfit: t.netProfit || 0,
      },
    };
  });

  return {
    favotites,
    favoriteItems,
    toggleFavorite,
    removeFavorite,
    checkIsFavorite,
  };
};

interface TestListProps {
  symbol?: string;
  enabled?: boolean;
}

export const useTestList = (filters: TestListProps = {}) => {
  const { enabled = true } = filters;
  const [loadding, setLoading] = useState(false);
  const [fulFilled, setFulfilled] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tests = useTestListStore((s) => s.tests);
  const { favoriteItems } = useFavoriteTests();
  const unavailableTests = useTestsStore(
    useShallow((state) => {
      const names = new Set<string>();
      for (const [name, result] of state.tests) {
        if (result === null) names.add(cacheName(name));
      }
      return names;
    }),
  );

  const testStrategyMap = new Map(
    tests
      .filter((item) => typeof item.data?.strategyName === 'string')
      .map((item) => [item.value, item.data?.strategyName as string]),
  );

  const testItems: Items = _.chain([...favoriteItems, ...tests])
    .map((item) => {
      if (item.data?.strategyName) {
        return item;
      }

      const strategyName = testStrategyMap.get(item.value);
      if (!strategyName) {
        return item;
      }

      return {
        ...item,
        data: {
          ...(item.data || {}),
          strategyName,
        },
      };
    })
    .filter((t) => {
      if (unavailableTests.has(t.value)) return false;

      const { symbol } = parseTestName(t.value);

      if (filters.symbol && filters.symbol !== symbol) {
        return false;
      }

      return true;
    })
    .sortBy((t) => -t.data?.netProfit! || 0)
    .unionBy((t) => t.value)
    .value();

  const noData = _.isEmpty(testItems);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        await delay();
        await loadBacktestFilesList();
        setLoading(false);
        setFulfilled(true);
      } catch (err) {
        setError(err);
      }
    };

    void loadData();
  }, [enabled]);

  return {
    loadding,
    fulFilled,
    error,
    noData,
    tests: testItems,
    ensureLoaded: loadBacktestFilesList,
  };
};

export const useTest = (testName: string) => {
  const setTest = useTestsStore((s) => s.setTest);
  const setTestUnavailable = useTestsStore((s) => s.setTestUnavailable);
  const tests = useTestListStore((s) => s.tests);
  const loadedAt = useTestListStore((s) => s.loadedAt);
  const setTestList = useTestListStore((s) => s.setTest);
  const testItem = tests.find((item) => item.value === testName);
  const strategyName = testItem?.data?.strategyName as string | undefined;

  const identity = cacheIdentity(testName, strategyName);
  const testResult = useTestsStore((s) => s.tests.get(identity));
  const hasTestResult = useTestsStore((s) => s.tests.has(identity));
  useEffect(() => {
    if (!strategyName && !loadedAt) {
      void loadBacktestFilesList().catch(() => undefined);
      return;
    }
    if (hasTestResult) {
      return;
    }

    const generation = cacheGeneration;
    const loadData = async () => {
      const key = scopedCacheKey('test', testName, strategyName);

      try {
        const cachedResult = (await get(key)) as TestResult | null;

        if (generation !== cacheGeneration) return;
        if (!_.isEmpty(cachedResult)) {
          setTest(cachedResult, identity);

          return;
        }

        let resolvedStrategy = strategyName;
        if (!resolvedStrategy) {
          const newTests = await loadBacktestFilesList();
          if (generation !== cacheGeneration) return;
          setTestList(newTests);
          resolvedStrategy = newTests.find((item) => item.value === testName)
            ?.data?.strategyName as string | undefined;
        }

        const test = await getBacktest(testName, resolvedStrategy);

        if (generation !== cacheGeneration) return;
        if (!test) {
          setTestUnavailable(identity);
          return;
        }

        setTest(test, identity);

        await set(key, test);
      } catch {
        if (generation !== cacheGeneration) return;
        setTestUnavailable(identity);
      }
    };

    let request = testLoadRequests.get(identity);

    if (!request) {
      request = loadData();
      testLoadRequests.set(identity, request);
      void request.finally(() => {
        if (testLoadRequests.get(identity) === request) {
          testLoadRequests.delete(identity);
        }
      });
    }
  }, [
    identity,
    loadedAt,
    hasTestResult,
    setTest,
    setTestList,
    setTestUnavailable,
    strategyName,
    testName,
  ]);

  return testResult;
};

export const useTestsCompare = () => {
  const tests = useTestsStore((s) => s.tests);
  const files = useTestListStore((s) => s.tests);
  const identityOf = useCallback(
    (name: string) =>
      cacheIdentity(
        name,
        files.find((item) => item.value === name)?.data?.strategyName as
          | string
          | undefined,
      ),
    [files],
  );
  const setTest = useTestsStore((s) => s.setTest);
  const compareList = useTestsCompareStore((s) => s.compareList);
  const onChangeCompare = useTestsCompareStore((s) => s.onChangeCompare);
  const removeFromCompare = useTestsCompareStore((s) => s.removeFromCompare);

  useEffect(() => {
    const generation = cacheGeneration;
    const loadData = async () => {
      for (const { testName } of compareList) {
        if (tests.has(identityOf(testName))) {
          continue;
        }

        const key = scopedCacheKey(
          'test',
          testName,
          files.find((item) => item.value === testName)?.data?.strategyName as
            | string
            | undefined,
        );
        const cachedResult = (await get(key)) as TestResult | null;

        if (generation !== cacheGeneration) return;
        if (!_.isEmpty(cachedResult)) {
          setTest(cachedResult, identityOf(testName));
        }
      }
    };

    void loadData();
  }, [compareList, setTest, tests, files, identityOf]);

  const checkIsCompared = (testName: string) =>
    compareList.some((s) => s.testName === testName);

  return {
    compareList: compareList
      .map(({ testName, color }) => {
        const testResult = tests.get(identityOf(testName));
        return {
          testResult,
          color,
        };
      })
      .filter((c) => !!c.testResult) as TestCompareList,
    checkIsCompared,
    onChangeCompare,
    removeFromCompare,
  };
};

export const useBacktestMutations = () => {
  const removeTestFromList = useTestListStore((s) => s.removeTest);
  const removeTestResult = useTestsStore((s) => s.removeTest);
  const removeBacktest = useDataStore((s) => s.removeBacktest);
  const removeFavorite = useFavoriteTetstsStore((s) => s.removeFavorite);
  const removeFromCompare = useTestsCompareStore((s) => s.removeFromCompare);

  const removeBacktestTest = async (testName: string) => {
    const generation = cacheGeneration;
    const session = cacheSession;
    const filesKey = filesCacheKey();
    removeTestFromList(testName);
    removeTestResult(testName);
    removeBacktest(testName);
    removeFavorite(testName);
    removeFromCompare(testName);

    const cache = (await get(filesKey)) as BacktestFilesCacheRecord | null;
    if (generation !== cacheGeneration) return;
    if (cache?.items) {
      await set(filesKey, {
        ...cache,
        items: cache.items.filter((item) => item.value !== testName),
      } satisfies BacktestFilesCacheRecord);
    }

    const { keys } = await import('idb-keyval');
    for (const key of await keys()) {
      if (typeof key !== 'string') continue;
      try {
        const parts = JSON.parse(key);
        if (generation !== cacheGeneration) return;
        if (
          parts[0] === 'backtest-cache-v3' &&
          parts[1] === session &&
          parts[4] === testName
        )
          await del(key);
      } catch {
        /* Legacy cache entries are never read. */
      }
    }
  };

  return {
    removeBacktestTest,
  };
};

const emptyOrderLog: OrderLogData = [];

export const useBacktest = (id: string | undefined, strategyHint?: string) => {
  const setBacktest = useDataStore((s) => s.setBacktest);
  const [request, setRequest] = useState<{
    id: string;
    unavailable: boolean;
  }>();
  const tests = useTestListStore((s) => s.tests);
  const setTestList = useTestListStore((s) => s.setTest);
  const testItem = tests.find((item) => item.value === id);
  const strategyName =
    strategyHint ?? (testItem?.data?.strategyName as string | undefined);

  const identity = cacheIdentity(id ?? 'empty', strategyName);
  const backtest = useDataStore((s) => s.backtests.get(identity));
  useEffect(() => {
    let active = true;
    const generation = cacheGeneration;
    const updateBacktest = async () => {
      if (!id) {
        return;
      }

      const key = scopedCacheKey('log', id, strategyName);

      let unavailable = false;
      try {
        const cachedResult = (await get(key).catch(
          () => null,
        )) as OrderLogData | null;

        if (!active || generation !== cacheGeneration) return;
        if (cachedResult) {
          setBacktest(identity, cachedResult);
          return;
        }

        let resolvedStrategy = strategyName;
        if (!resolvedStrategy) {
          const newTests = await loadBacktestFilesList();
          if (!active || generation !== cacheGeneration) return;
          setTestList(newTests);
          resolvedStrategy = newTests.find((item) => item.value === id)?.data
            ?.strategyName as string | undefined;
        }

        const backtestData = await getOrderLog(id, resolvedStrategy);

        if (!active || generation !== cacheGeneration) return;
        unavailable = backtestData === null;
        if (backtestData) {
          setBacktest(identity, backtestData);
          await set(key, backtestData).catch(() => undefined);
        }
      } catch {
        unavailable = true;
      } finally {
        if (active && generation === cacheGeneration)
          setRequest({ id, unavailable });
      }
    };

    void updateBacktest();
    return () => {
      active = false;
    };
  }, [id, identity, setBacktest, setTestList, strategyName]);

  return {
    backtest: backtest ?? emptyOrderLog,
    loading: Boolean(id && !backtest && request?.id !== id),
    unavailable: Boolean(
      id && !backtest && request?.id === id && request.unavailable,
    ),
  };
};

const resetBacktestCacheMemory = () => {
  testLoadRequests.clear();
  useDataStore.setState({
    backtests: new Map<string, OrderLogData | null>(),
  });
  useTestListStore.setState({
    tests: [],
    loadedAt: 0,
    inFlight: undefined,
  });
  useTestsStore.setState({
    tests: new Map<string, TestResult | null>(),
  });
};

export const resetTestsStoreForTests = resetBacktestCacheMemory;
const readPreference = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const restorePreference = (key: string, value: string | null) => {
  try {
    if (value !== null) localStorage.setItem(key, value);
  } catch {
    /* Storage can be disabled by the browser. */
  }
};
let scopeChange = Promise.resolve();
export const setBacktestCacheSession = (session: string | null) => {
  if (cacheSession === session) return scopeChange;
  cacheSession = session;
  cacheGeneration++;
  resetBacktestCacheMemory();
  const generation = cacheGeneration;
  scopeChange = scopeChange
    .catch(() => undefined)
    .then(async () => {
      if (generation !== cacheGeneration) return;
      const clearPreferences = () => {
        try {
          useFavoriteTetstsStore.setState({ tests: [] });
        } catch {
          /* Memory is reset before persisting. */
        }
        try {
          useTestsCompareStore.setState({ compareList: [] });
        } catch {
          /* Storage may be disabled. */
        }
      };
      if (!useFavoriteTetstsStore.persist || !useTestsCompareStore.persist) {
        clearPreferences();
        return;
      }
      try {
        const favoriteName = `${FAVORITE_LOCAL_STORAGE_KEY}:v3:${session ?? 'anonymous'}`;
        const compareName = `${COMPARE_LOCAL_STORAGE_KEY}:v3:${session ?? 'anonymous'}`;
        const savedFavorites = readPreference(favoriteName);
        const savedCompare = readPreference(compareName);
        useFavoriteTetstsStore.persist.setOptions({ name: favoriteName });
        useTestsCompareStore.persist.setOptions({ name: compareName });
        clearPreferences();
        restorePreference(favoriteName, savedFavorites);
        restorePreference(compareName, savedCompare);
        await useFavoriteTetstsStore.persist.rehydrate();
        await useTestsCompareStore.persist.rehydrate();
      } catch {
        clearPreferences();
      }
    });
  return scopeChange;
};
