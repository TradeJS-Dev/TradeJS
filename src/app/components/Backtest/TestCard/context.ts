import { createContext, useContext } from 'react';
import { TestResult } from '@types';
import { TestCompareList, OnChangeCompare } from './types';

interface TestResultContextProps {
  id: string;
  testResult: TestResult;
  onChangeCompare: OnChangeCompare;
  compareList: TestCompareList;
}

export const TestResultContext = createContext<TestResultContextProps>(
  {} as TestResultContextProps,
);

export const useTestResult = () => {
  return useContext(TestResultContext);
};
