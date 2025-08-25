import { createContext, useContext } from 'react';
import { TestResult } from '@types';

interface TestResultContextProps {
  testResult: TestResult;
}

export const TestResultContext = createContext<TestResultContextProps>(
  {} as TestResultContextProps,
);

export const useTestContext = () => {
  return useContext(TestResultContext);
};
