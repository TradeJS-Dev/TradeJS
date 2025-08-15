import { format } from 'date-fns';
import { SimpleOrderLogData, TestCompareList } from '@types';

export const mapOrderLogToChartData = (
  testId: string,
  orderLog: SimpleOrderLogData,
) => {
  const data = orderLog.map(([timestamp, amount]) => ({
    [testId]: amount,
    timestamp: format(timestamp, 'dd.MM'),
  }));

  const series = [
    {
      name: testId,
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
    const formattedTimestamp = format(timestamp, 'dd.MM');

    testList.forEach(({ testId, orderLog }) => {
      values[testId] = getAmountFromOrderLog(
        ind,
        timeline,
        orderLog,
        values[testId] || 100,
      );
    });

    return {
      ...values,
      timestamp: formattedTimestamp,
    };
  });

  const series = testList.map(({ testId, color }) => ({
    name: testId,
    color,
  }));

  return {
    data,
    series,
  };
};
