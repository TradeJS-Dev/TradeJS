import { createContext, useContext } from 'react';
import { TestResult } from '@types';

interface TestResultContextProps {
  id: string;
  testResult: TestResult;
}

export const TestResultContext = createContext<TestResultContextProps>(
  {} as TestResultContextProps,
);

export const useTestResult = () => {
  return useContext(TestResultContext);
};
