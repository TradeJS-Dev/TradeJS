import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { get, set } from 'idb-keyval';
import { getBacktest, getBacktestFiles } from '@src/actions/backtest';
import { TestResult, TestCompareList, OnChangeCompare, Items } from '@types';
import { delay } from '@utils/delay';

const LOCAL_STORAGE_KEY = 'compare';

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

interface TestsListState {
  tests: Items;
  setTest: (tests: Items) => void;
}

const useTestsListStore = create<TestsListState>((set) => ({
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
      name: LOCAL_STORAGE_KEY,
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

export const useTestsList = () => {
  const [loadding, setLoading] = useState(false);
  const [fulFilled, setFulfilled] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tests = useTestsListStore((s) => s.tests);
  const setTest = useTestsListStore((s) => s.setTest);

  const noData = _.isEmpty(tests);

  const loadData = async () => {
    try {
      setLoading(true);
      await delay();
      const newTests = await getBacktestFiles({});
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
    tests,
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
