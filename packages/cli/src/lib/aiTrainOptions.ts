export const parseTimestampFilter = (value: unknown): number | null => {
  if (value == null || String(value).trim() === '') {
    return null;
  }

  const text = String(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  throw new Error(
    `Invalid timestamp filter "${text}". Use an ISO date or epoch milliseconds.`,
  );
};

export const parseTrailingPeriodMs = (value: unknown): number | null => {
  if (value == null || String(value).trim() === '') {
    return null;
  }

  const text = String(value).trim().toLowerCase();
  const match = text.match(
    /^(?:last)?(\d+)(d|day|days|w|week|weeks|m|month|months|y|year|years)$/,
  );
  if (!match) {
    throw new Error(
      `Invalid --period value "${String(value)}". Use values like last365d, 90d, 12w, or 1y.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const dayMs = 24 * 60 * 60 * 1000;
  if (unit.startsWith('w')) {
    return amount * 7 * dayMs;
  }
  if (unit.startsWith('m')) {
    return amount * 30.4375 * dayMs;
  }
  if (unit.startsWith('y')) {
    return amount * 365 * dayMs;
  }
  return amount * dayMs;
};

export const parseQualityThresholds = (value: unknown) => {
  const raw = String(value ?? '3,4,5')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part))
    .map((part) => Math.trunc(part))
    .filter((part) => part > 0);
  return [...new Set(raw)].sort((left, right) => left - right);
};

export type AiTrainDumpFeatureMode = 'none' | 'gateFeatures' | 'baseContext';

export const parseDumpFeatureMode = (
  value: unknown,
): AiTrainDumpFeatureMode => {
  const text = String(value ?? 'none')
    .trim()
    .toLowerCase();
  if (!text || text === 'none' || text === 'false' || text === '0') {
    return 'none';
  }
  if (text === 'gatefeatures' || text === 'gate-features') {
    return 'gateFeatures';
  }
  if (text === 'basecontext' || text === 'base-context') {
    return 'baseContext';
  }

  throw new Error(
    `Invalid --dumpFeatures value "${String(value)}". Use none, gateFeatures, or baseContext.`,
  );
};

export const hasCliOption = ({
  argv,
  longName,
  shortName,
}: {
  argv: string[];
  longName: string;
  shortName: string;
}) =>
  argv.some(
    (arg) =>
      arg === `--${longName}` ||
      arg.startsWith(`--${longName}=`) ||
      arg === `-${shortName}` ||
      arg.startsWith(`-${shortName}=`),
  );

export const resolveAiTrainRecentLimit = ({
  argv,
  recentValue,
  hasDateFilter,
  defaultRecent = 50,
}: {
  argv: string[];
  recentValue: unknown;
  hasDateFilter: boolean;
  defaultRecent?: number;
}) => {
  const hasExplicitRecent = hasCliOption({
    argv,
    longName: 'recent',
    shortName: 'n',
  });
  const selectedRecent = hasDateFilter && !hasExplicitRecent ? 0 : recentValue;
  const parsed = Number(selectedRecent);

  return Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : defaultRecent;
};
