import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { get, set } from 'idb-keyval';
import { getBacktest, getBacktestFiles } from '@actions/backtest';
import { TestResult, TestCompareList, OnChangeCompare, Items } from '@types';
import { delay } from '@utils/async';
import { parseTestName } from '@utils/tests';

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

interface FavotiteTestsState {
  tests: {
    testName: string;
    netProfit: number;
  }[];
  toggleFavorite: (testName: string, netProfit: number) => void;
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
    }),
    {
      name: FAVORITE_LOCAL_STORAGE_KEY,
    },
  ),
);

interface TestListState {
  tests: Items;
  setTest: (tests: Items) => void;
}

const useTestListStore = create<TestListState>((set) => ({
  tests: [],
  setTest: (tests) =>
    set(() => ({
      tests,
    })),
}));

interface TestsCompareState {
  compareList: {
    testName: string;
    color: string;
  }[];
  onChangeCompare: OnChangeCompare;
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
    }),
    {
      name: COMPARE_LOCAL_STORAGE_KEY,
    },
  ),
);

interface TestsState {
  tests: Record<string, TestResult | null>;
  setTest: (test: TestResult) => void;
}

const useTestsStore = create<TestsState>((set) => ({
  tests: {},
  setTest: (testResult) =>
    set(({ tests }) => ({
      tests: { ...tests, [testResult.test.name]: testResult },
    })),
}));

export const useFavoriteTests = () => {
  const favotites = useFavoriteTetstsStore((s) => s.tests);
  const toggleFavorite = useFavoriteTetstsStore((s) => s.toggleFavorite);
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

  const testItems: Items = _.chain([...favoriteItems, ...tests])
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

  useEffect(() => {
    loadData();
  }, []);

  return {
    loadding,
    fulFilled,
    error,
    noData,
    tests: testItems,
  };
};

export const useTest = (testName: string) => {
  const testResult = useTestsStore((s) => s.tests[testName]);
  const setTest = useTestsStore((s) => s.setTest);

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

    const test = await getBacktest(testName);

    if (!test) {
      return;
    }

    setTest(test);

    await set(key, test);
  };

  useEffect(() => {
    loadData();
  }, [testName]);

  return testResult;
};

export const useTestsCompare = () => {
  const tests = useTestsStore((s) => s.tests);
  const setTest = useTestsStore((s) => s.setTest);
  const compareList = useTestsCompareStore((s) => s.compareList);
  const onChangeCompare = useTestsCompareStore((s) => s.onChangeCompare);

  const loadData = async (testName: string) => {
    const key = `test-${testName}`;

    const cachedResult = (await get(key)) as TestResult | null;

    if (!_.isEmpty(cachedResult)) {
      setTest(cachedResult);
    }
  };

  useEffect(() => {
    compareList.forEach(({ testName }) => {
      if (!tests[testName]) {
        loadData(testName);
      }
    });
  }, [compareList]);

  const checkIsCompared = (testName: string) =>
    compareList.some((s) => s.testName === testName);

  return {
    compareList: compareList
      .map(({ testName, color }) => {
        const testResult = tests[testName];
        return {
          testResult,
          color,
        };
      })
      .filter((c) => !!c.testResult) as TestCompareList,
    checkIsCompared,
    onChangeCompare,
  };
};
