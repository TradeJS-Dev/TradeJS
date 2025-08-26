export const parseTestName = (testName: string) => {
  const [symbol, testSuiteId, testId] = testName.split('_');
  return { symbol, testSuiteId, testId };
};
