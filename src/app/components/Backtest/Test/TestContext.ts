import { createContext } from 'react';
import { BacktestHistory } from '@types';

interface TestContextProps {
  id: string;
  test: BacktestHistory;
}

export const TestContext = createContext<TestContextProps>(
  {} as TestContextProps,
);
