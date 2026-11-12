import type { OrderLogData, TestCompareList, TestResult } from '@tradejs/types';

const getLineName = (testResult: TestResult) =>
  `${testResult.test.symbol}-${testResult.test.testId}`;

export const getChartData = ({
  testResult,
  orders,
  compareList,
  startTimestamp,
  endTimestamp,
}: {
  testResult: TestResult;
  orders: OrderLogData;
  compareList: TestCompareList;
  startTimestamp: number;
  endTimestamp: number;
}) => {
  const currentLine = getLineName(testResult);
  const compared = compareList.filter(
    (entry) => entry.testResult.test.testId !== testResult.test.testId,
  );
  const series = [
    ...compared.map((entry) => ({
      name: getLineName(entry.testResult),
      color: `${entry.color}.solid`,
    })),
    { name: currentLine, color: 'teal.solid' },
  ];
  const values: Record<string, number> = {
    ...Object.fromEntries(
      compared.map((entry) => [getLineName(entry.testResult), 100]),
    ),
    [currentLine]: testResult.orderLog[0]?.[1] ?? 100,
  };
  const events = [
    ...compared.flatMap((entry) =>
      entry.testResult.orderLog.map(([timestamp, equity]) => ({
        timestamp,
        equity,
        line: getLineName(entry.testResult),
      })),
    ),
    ...(orders.length
      ? orders.map(({ timestamp, amount }) => ({
          timestamp,
          equity: amount,
          line: currentLine,
        }))
      : testResult.orderLog.map(([timestamp, equity]) => ({
          timestamp,
          equity,
          line: currentLine,
        }))),
  ].sort((left, right) => left.timestamp - right.timestamp);

  let cursor = 0;
  while (cursor < events.length && events[cursor].timestamp < startTimestamp) {
    const { equity, line } = events[cursor++];
    values[line] = equity;
  }

  const data = [{ ...values, timestamp: startTimestamp }];
  for (; cursor < events.length; cursor++) {
    const { timestamp, equity, line } = events[cursor];
    if (timestamp > endTimestamp) break;
    if (values[line] === equity) continue;
    values[line] = equity;
    data.push({ ...values, timestamp });
  }

  if (data.at(-1)?.timestamp !== endTimestamp) {
    data.push({ ...values, timestamp: endTimestamp });
  }
  return { data, series };
};
