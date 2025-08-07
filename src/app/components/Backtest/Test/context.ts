import { createContext, useContext } from 'react';
import { BacktestHistory } from '@types';

interface TestContextProps {
  id: string;
  test: BacktestHistory;
}

export const TestContext = createContext<TestContextProps>(
  {} as TestContextProps,
);

export const useTest = () => {
  return useContext(TestContext);
};
