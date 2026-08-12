import type {
  AiPocketCadenceMode,
  AiPocketCadenceProfile,
  AiPocketCoverageFamily,
  AiPocketSearchRow,
} from './aiPocketSearch';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_SUPPORT = 20;
const LOW_CADENCE_EVENT_LIMIT = 200;
const LOW_CADENCE_MAX_EVENT_SHARE = 1 / 3;

const countIndependentEvents = (rows: Array<{ timestamp?: number | null }>) => {
  const timestampEvents = new Set<number>();
  let rowsWithoutTimestamp = 0;
  for (const row of rows) {
    if (typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)) {
      timestampEvents.add(row.timestamp);
    } else {
      rowsWithoutTimestamp += 1;
    }
  }
  return timestampEvents.size + rowsWithoutTimestamp;
};

const getPeriodDays = (rows: Array<{ timestamp?: number | null }>) => {
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;
  for (const row of rows) {
    const timestamp = row.timestamp;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      continue;
    }
    minTimestamp =
      minTimestamp == null ? timestamp : Math.min(minTimestamp, timestamp);
    maxTimestamp =
      maxTimestamp == null ? timestamp : Math.max(maxTimestamp, timestamp);
  }
  if (minTimestamp == null || maxTimestamp == null) {
    return null;
  }
  return Math.max((maxTimestamp - minTimestamp) / DAY_MS, 1);
};

const clampInt = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.ceil(value)));

export const resolveAiPocketCadenceProfile = ({
  trainRows,
  validationRows = [],
  testRows = [],
  mode = 'auto',
  validationSplit = 0.25,
  minSupport,
  minEvents,
  minValidationSupport,
  minValidationEvents,
  maxEventCountShare = 0.25,
  explicitMaxEventCountShare = false,
}: {
  trainRows: Array<{ timestamp?: number | null }>;
  validationRows?: Array<{ timestamp?: number | null }>;
  testRows?: Array<{ timestamp?: number | null }>;
  mode?: AiPocketCadenceMode;
  validationSplit?: number;
  minSupport?: number;
  minEvents?: number;
  minValidationSupport?: number;
  minValidationEvents?: number;
  maxEventCountShare?: number;
  explicitMaxEventCountShare?: boolean;
}): AiPocketCadenceProfile => {
  const trainEvents = countIndependentEvents(trainRows);
  const validationEvents = countIndependentEvents(validationRows);
  const testEvents = countIndependentEvents(testRows);
  const trainPeriodDays = getPeriodDays(trainRows);
  const trainEventsPerDay =
    trainPeriodDays == null ? null : trainEvents / trainPeriodDays;
  const sparseSample = trainEvents < LOW_CADENCE_EVENT_LIMIT;
  const lowCadence = trainEventsPerDay != null && trainEventsPerDay < 0.25;
  const adaptiveSample = mode === 'auto' && sparseSample;
  const adaptiveThresholds =
    adaptiveSample &&
    (minSupport == null ||
      minEvents == null ||
      (validationRows.length > 0 &&
        (minValidationSupport == null || minValidationEvents == null)) ||
      !explicitMaxEventCountShare);
  const resolvedMinSupport =
    minSupport ??
    (adaptiveSample
      ? clampInt(trainEvents * 0.1, 3, DEFAULT_MIN_SUPPORT)
      : DEFAULT_MIN_SUPPORT);
  const resolvedMinEvents =
    minEvents ??
    (minSupport != null || !adaptiveSample
      ? Math.max(5, Math.ceil(resolvedMinSupport * 0.5))
      : clampInt(resolvedMinSupport * 0.5, 3, 10));
  const hasValidation = validationRows.length > 0;
  const resolvedMinValidationSupport =
    minValidationSupport ??
    (hasValidation
      ? Math.max(3, Math.ceil(resolvedMinSupport * validationSplit * 0.5))
      : 0);
  const resolvedMinValidationEvents =
    minValidationEvents ??
    (hasValidation
      ? Math.max(
          adaptiveSample ? 3 : 2,
          Math.ceil(resolvedMinEvents * validationSplit * 0.5),
        )
      : 0);
  const resolvedMaxEventCountShare =
    adaptiveSample && !explicitMaxEventCountShare
      ? Math.max(maxEventCountShare, LOW_CADENCE_MAX_EVENT_SHARE)
      : maxEventCountShare;

  return {
    mode,
    lowCadence,
    sparseSample,
    adaptiveThresholds,
    trainRows: trainRows.length,
    trainEvents,
    trainPeriodDays,
    trainEventsPerDay,
    validationRows: validationRows.length,
    validationEvents,
    testRows: testRows.length,
    testEvents,
    minSupport: resolvedMinSupport,
    minEvents: resolvedMinEvents,
    minValidationSupport: resolvedMinValidationSupport,
    minValidationEvents: resolvedMinValidationEvents,
    maxEventCountShare: resolvedMaxEventCountShare,
  };
};

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

export const splitAiPocketCoverageRowsByTimestamp = <
  T extends Pick<AiPocketSearchRow, 'timestamp' | 'featureCoverage'>,
>(
  rows: T[],
  family: AiPocketCoverageFamily,
  validationSplit: number,
  testSplit = 0,
) =>
  splitAiPocketResearchRowsByTimestamp(
    rows.filter((row) => row.featureCoverage?.[family] === true),
    validationSplit,
    testSplit,
  );

export const sealAiPocketTestPartition = <
  T extends { timestamp?: number | null },
>(
  split: {
    trainRows: T[];
    validationRows: T[];
    testRows: T[];
  },
  sealed: boolean,
) => {
  const finiteTimestamps = split.testRows
    .map((row) => row.timestamp)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
  return {
    discoveryRows: [
      ...split.trainRows,
      ...split.validationRows,
      ...(sealed ? [] : split.testRows),
    ],
    searchTestRows: sealed ? [] : split.testRows,
    evidence: {
      sealed,
      rows: split.testRows.length,
      events: countIndependentEvents(split.testRows),
      startTimestamp: finiteTimestamps.length
        ? Math.min(...finiteTimestamps)
        : null,
      endTimestamp: finiteTimestamps.length
        ? Math.max(...finiteTimestamps)
        : null,
    },
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
