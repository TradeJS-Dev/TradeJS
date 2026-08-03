import {
  SimpleOrderLogData,
  TestResult,
  TestCompareList,
} from '@tradejs/types';

const getLineName = (testResult: TestResult) =>
  `${testResult.test.symbol}-${testResult.test.testId}`;

export const mapOrderLogToChartData = (testResult: TestResult) => {
  const data = testResult.orderLog.map(([timestamp, amount]) => ({
    [getLineName(testResult)]: amount,
    timestamp,
  }));

  const series = [
    {
      name: getLineName(testResult),
      color: 'teal.solid',
    },
  ];

  return {
    data,
    series,
  };
};

const getAmountFromOrderLog = (
  ind: number,
  timeline: number[],
  orderLog: SimpleOrderLogData,
  fallback: number,
) => {
  if (ind < 1) {
    return fallback;
  }

  const order = orderLog.findLast(
    (log) => log[0] <= timeline[ind] && log[0] > timeline[ind - 1],
  );

  if (!order) {
    return fallback;
  }

  return order[1];
};

export const getChartData = (testList: TestCompareList, timeline: number[]) => {
  const values: Record<string, number> = {};

  const data = timeline.map((timestamp, ind) => {
    testList.forEach(({ testResult }) => {
      values[getLineName(testResult)] = getAmountFromOrderLog(
        ind,
        timeline,
        testResult.orderLog,
        values[getLineName(testResult)] || 100,
      );
    });

    return {
      ...values,
      timestamp,
    };
  });

  const series = testList.map(({ testResult, color }) => ({
    name: getLineName(testResult),
    color: `${color}.solid`,
  }));

  return {
    data,
    series,
  };
};
