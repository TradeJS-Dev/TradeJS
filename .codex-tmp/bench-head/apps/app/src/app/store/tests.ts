import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { del, get, set } from 'idb-keyval';
import { getBacktest, getBacktestFiles, getOrderLog } from '@actions/backtest';
import {
  TestResult,
  TestCompareList,
  OrderLogData,
  OnChangeCompare,
  Items,
} from '@tradejs/types';
import { delay } from '@tradejs/core/async';
import { parseTestName } from '@tradejs/core/backtest';

const COMPARE_LOCAL_STORAGE_KEY = 'compare';
const FAVORITE_LOCAL_STORAGE_KEY = 'favorite';

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
      next.delete(id);

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
      name: FAVORITE_LOCAL_STORAGE_KEY,
    },
  ),
);

interface TestListState {
  tests: Items;
  setTest: (tests: Items) => void;
  removeTest: (testName: string) => void;
}

const useTestListStore = create<TestListState>((set) => ({
  tests: [],
  setTest: (tests) =>
    set(() => ({
      tests,
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
      name: COMPARE_LOCAL_STORAGE_KEY,
    },
  ),
);

interface TestsState {
  tests: Map<string, TestResult | null>;
  setTest: (test: TestResult) => void;
  removeTest: (testName: string) => void;
}

const useTestsStore = create<TestsState>((set) => ({
  tests: new Map<string, TestResult | null>(),
  setTest: (testResult) =>
    set(({ tests }) => {
      const next = new Map(tests);
      next.set(testResult.test.name, testResult);

      return {
        tests: next,
      };
    }),
  removeTest: (testName) =>
    set(({ tests }) => {
      const next = new Map(tests);
      next.delete(testName);

      return {
        tests: next,
      };
    }),
}));

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
}

export const useTestList = (filters: TestListProps = {}) => {
  const [loadding, setLoading] = useState(false);
  const [fulFilled, setFulfilled] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tests = useTestListStore((s) => s.tests);
  const setTest = useTestListStore((s) => s.setTest);
  const { favoriteItems } = useFavoriteTests();

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
    const loadData = async () => {
      try {
        setLoading(true);
        await delay();
        const newTests = await getBacktestFiles();
        setLoading(false);
        setFulfilled(true);

        setTest(newTests);
      } catch (err) {
        setError(err);
      }
    };

    void loadData();
  }, [setTest]);

  return {
    loadding,
    fulFilled,
    error,
    noData,
    tests: testItems,
  };
};

export const useTest = (testName: string) => {
  const testResult = useTestsStore((s) => s.tests.get(testName));
  const setTest = useTestsStore((s) => s.setTest);
  const tests = useTestListStore((s) => s.tests);
  const setTestList = useTestListStore((s) => s.setTest);
  const testItem = tests.find((item) => item.value === testName);
  const strategyName = testItem?.data?.strategyName as string | undefined;

  useEffect(() => {
    const loadData = async () => {
      if (!_.isEmpty(testResult)) {
        return;
      }

      const key = `test-${testName}`;

      const cachedResult = (await get(key)) as TestResult | null;

      if (!_.isEmpty(cachedResult)) {
        setTest(cachedResult);

        return;
      }

      let resolvedStrategy = strategyName;
      if (!resolvedStrategy) {
        const newTests = await getBacktestFiles();
        setTestList(newTests);
        resolvedStrategy = newTests.find((item) => item.value === testName)
          ?.data?.strategyName as string | undefined;
      }

      const test = await getBacktest(testName, resolvedStrategy);

      if (!test) {
        return;
      }

      setTest(test);

      await set(key, test);
    };

    void loadData();
  }, [setTest, setTestList, strategyName, testName, testResult]);

  return testResult;
};

export const useTestsCompare = () => {
  const tests = useTestsStore((s) => s.tests);
  const setTest = useTestsStore((s) => s.setTest);
  const compareList = useTestsCompareStore((s) => s.compareList);
  const onChangeCompare = useTestsCompareStore((s) => s.onChangeCompare);
  const removeFromCompare = useTestsCompareStore((s) => s.removeFromCompare);

  useEffect(() => {
    const loadData = async () => {
      for (const { testName } of compareList) {
        if (tests.has(testName)) {
          continue;
        }

        const key = `test-${testName}`;
        const cachedResult = (await get(key)) as TestResult | null;

        if (!_.isEmpty(cachedResult)) {
          setTest(cachedResult);
        }
      }
    };

    void loadData();
  }, [compareList, setTest, tests]);

  const checkIsCompared = (testName: string) =>
    compareList.some((s) => s.testName === testName);

  return {
    compareList: compareList
      .map(({ testName, color }) => {
        const testResult = tests.get(testName);
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
    removeTestFromList(testName);
    removeTestResult(testName);
    removeBacktest(testName);
    removeFavorite(testName);
    removeFromCompare(testName);

    await Promise.all([del(`test-${testName}`), del(`backtest-${testName}`)]);
  };

  return {
    removeBacktestTest,
  };
};

export const useBacktest = (id: string | undefined) => {
  const backtest = useDataStore((s) => s.backtests.get(id || 'empty'));
  const setBacktest = useDataStore((s) => s.setBacktest);
  const [loading, setLoading] = useState(false);
  const tests = useTestListStore((s) => s.tests);
  const setTestList = useTestListStore((s) => s.setTest);
  const testItem = tests.find((item) => item.value === id);
  const strategyName = testItem?.data?.strategyName as string | undefined;

  useEffect(() => {
    const updateBacktest = async () => {
      if (!id) {
        return;
      }

      const key = `backtest-${id}`;

      setLoading(true);

      const cachedResult = (await get(key)) as OrderLogData | null;

      if (cachedResult && !_.isEmpty(cachedResult)) {
        setBacktest(id, cachedResult);
        setLoading(false);

        return;
      }

      let resolvedStrategy = strategyName;
      if (!resolvedStrategy) {
        const newTests = await getBacktestFiles();
        setTestList(newTests);
        resolvedStrategy = newTests.find((item) => item.value === id)?.data
          ?.strategyName as string | undefined;
      }

      const backtestData = await getOrderLog(id, resolvedStrategy);

      if (backtestData && !_.isEmpty(backtestData)) {
        setBacktest(id, backtestData);
        await set(key, backtestData);
      }

      setLoading(false);
    };

    void updateBacktest();
  }, [id, setBacktest, setTestList, strategyName]);

  return {
    backtest: backtest || [],
    loading,
  };
};
