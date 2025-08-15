import { useEffect } from 'react';
import { create } from 'zustand';
import _ from 'lodash';
import { get, set } from 'idb-keyval';
import { getBacktest } from '@src/actions/backtest';
import { TestResult, TestCompareList, OnChangeCompare } from '@types';

const COLORS = [
  'purple',
  'pink',
  'red',
  'cyan',
  'orange',
  'yellow',
  'blue',
  'green',
];

interface TestsState {
  tests: Record<string, TestResult | null>;
  compareList: TestCompareList;
  setTest: (test: TestResult) => void;
  onChangeCompare: OnChangeCompare;
}

const useStore = create<TestsState>((set) => ({
  tests: {},
  compareList: [],
  setTest: (testResult) =>
    set(({ tests }) => ({
      tests: { ...tests, [testResult.test.name]: testResult },
    })),
  onChangeCompare: (testId, orderLog) =>
    set(({ compareList }) => {
      if (orderLog) {
        const newState = [
          ...compareList,
          { testId, orderLog, color: COLORS[compareList.length] },
        ];
        if (newState.length > COLORS.length) {
          newState.shift();
        }
        return { compareList: newState };
      }
      return { compareList: compareList.filter((t) => t.testId !== testId) };
    }),
}));

export const useTest = (testName: string) => {
  const testResult = useStore((s) => s.tests[testName]);
  const setTest = useStore((s) => s.setTest);

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
  const compareList = useStore((s) => s.compareList);
  const onChangeCompare = useStore((s) => s.onChangeCompare);

  return {
    compareList,
    onChangeCompare,
  };
};
