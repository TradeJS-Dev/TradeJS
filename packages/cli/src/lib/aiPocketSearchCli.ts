export const AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS = {
  minProfitFactor: '1.2',
  minWinRate: '0',
  minTotalProfit: '0',
  validationSplit: '0.25',
  testSplit: '0',
} as const;

export const splitAiPocketResearchRowsByTimestamp = <
  T extends { timestamp?: number | null },
>(
  rows: T[],
  validationSplit: number,
  testSplit = 0,
) => {
  const timestamps = [
    ...new Set(
      rows
        .map((row) => row.timestamp)
        .filter((timestamp): timestamp is number => Number.isFinite(timestamp)),
    ),
  ].sort((left, right) => left - right);
  if (timestamps.length < 2) {
    return { trainRows: rows, validationRows: [] as T[], testRows: [] as T[] };
  }

  const getSplitCount = (ratio: number) =>
    ratio > 0 ? Math.max(1, Math.floor(timestamps.length * ratio)) : 0;
  let testEvents = getSplitCount(testSplit);
  let validationEvents = getSplitCount(validationSplit);
  const maximumHeldOut = timestamps.length - 1;
  if (testEvents + validationEvents > maximumHeldOut) {
    validationEvents = Math.max(
      0,
      validationEvents - (testEvents + validationEvents - maximumHeldOut),
    );
  }
  if (testEvents + validationEvents > maximumHeldOut) {
    testEvents = Math.max(0, maximumHeldOut - validationEvents);
  }

  const testStart = timestamps.length - testEvents;
  const validationStart = testStart - validationEvents;
  const validationTimestamps = new Set(
    timestamps.slice(validationStart, testStart),
  );
  const testTimestamps = new Set(timestamps.slice(testStart));
  const isIn = (timestampsSet: Set<number>, timestamp?: number | null) =>
    typeof timestamp === 'number' && timestampsSet.has(timestamp);
  return {
    trainRows: rows.filter(
      (row) =>
        !isIn(validationTimestamps, row.timestamp) &&
        !isIn(testTimestamps, row.timestamp),
    ),
    validationRows: rows.filter((row) =>
      isIn(validationTimestamps, row.timestamp),
    ),
    testRows: rows.filter((row) => isIn(testTimestamps, row.timestamp)),
  };
};

export const readAiPocketSearchCliOption = ({
  argv,
  longName,
  shortName,
}: {
  argv: string[];
  longName: string;
  shortName?: string;
}): string | undefined => {
  const longPrefix = `--${longName}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(longPrefix)) {
      return arg.slice(longPrefix.length);
    }
    if (
      arg === `--${longName}` ||
      (shortName != null && arg === `-${shortName}`)
    ) {
      return argv[index + 1];
    }
  }

  return undefined;
};
