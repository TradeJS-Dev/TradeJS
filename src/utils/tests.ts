import { TestWorkerResult } from '@types';

export const parseTestName = (testName: string) => {
  const [symbol, testSuiteId, testId] = testName.split('_');
  return { symbol, testSuiteId, testId };
};

export const filterGoodTests = (tests: TestWorkerResult[]) => {
  return tests.filter((res) => res.stat?.orders > 5 && res.stat?.profit > 0);
};
