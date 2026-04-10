export const TRAIN_FEATURE_EXCLUDED_COLUMNS = new Set([
  'label',
  'profit',
  'signalId',
  'entryTimestamp',
]);

export type QualityIssueCode =
  | 'all_zero'
  | 'high_zero'
  | 'nan_or_inf'
  | 'zero_variance';

export type QualityIssue = {
  code: QualityIssueCode;
  column: string;
  details: string;
};

type ColumnStats = {
  finiteCount: number;
  zeroCount: number;
  nanOrInfCount: number;
  mean: number;
  m2: number;
  distinctFinite: Set<number>;
  distinctOverflow: boolean;
};

export type MlExportQualityAccumulator = {
  rowCount: number;
  columnStats: Map<string, ColumnStats>;
};

export type MlExportQualitySummary = {
  featureColumns: string[];
  numericFeatureColumns: string[];
  allZeroColumns: string[];
  highZeroColumns: string[];
  nanOrInfColumns: string[];
  zeroVarianceContinuousColumns: string[];
  issues: QualityIssue[];
};

export type MlExportQualityOptions = {
  highZeroThreshold?: number;
  highZeroWhitelist?: string[];
};

const isWhitelisted = (column: string, whitelist: string[]) =>
  whitelist.some((allowed) => allowed === column);

const toFiniteNumber = (
  value: unknown,
):
  | { finite: true; value: number }
  | { finite: false; reason: 'skip' | 'nan_or_inf' } => {
  if (value == null || value === '') {
    return { finite: false, reason: 'skip' };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    if (Number.isNaN(num) || num === Infinity || num === -Infinity) {
      return { finite: false, reason: 'nan_or_inf' };
    }
    return { finite: false, reason: 'skip' };
  }
  return { finite: true, value: num };
};

const updateColumnStats = (stats: ColumnStats, value: number) => {
  stats.finiteCount += 1;
  if (value === 0) {
    stats.zeroCount += 1;
  }

  const delta = value - stats.mean;
  stats.mean += delta / stats.finiteCount;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;

  if (!stats.distinctOverflow) {
    stats.distinctFinite.add(value);
    if (stats.distinctFinite.size > 12) {
      stats.distinctOverflow = true;
      stats.distinctFinite.clear();
    }
  }
};

export const createMlExportQualityAccumulator =
  (): MlExportQualityAccumulator => ({
    rowCount: 0,
    columnStats: new Map<string, ColumnStats>(),
  });

export const ingestMlExportQualityRow = (
  acc: MlExportQualityAccumulator,
  row: Record<string, unknown>,
) => {
  acc.rowCount += 1;
  for (const [column, rawValue] of Object.entries(row)) {
    let stats = acc.columnStats.get(column);
    if (!stats) {
      stats = {
        finiteCount: 0,
        zeroCount: 0,
        nanOrInfCount: 0,
        mean: 0,
        m2: 0,
        distinctFinite: new Set<number>(),
        distinctOverflow: false,
      };
      acc.columnStats.set(column, stats);
    }

    const parsed = toFiniteNumber(rawValue);
    if (!parsed.finite) {
      if (parsed.reason === 'nan_or_inf') {
        stats.nanOrInfCount += 1;
      }
      continue;
    }

    updateColumnStats(stats, parsed.value);
  }
};

export const deriveTrainFeatureColumns = (headers: string[]): string[] =>
  headers.filter((column) => !TRAIN_FEATURE_EXCLUDED_COLUMNS.has(column));

const isBinaryLike = (stats: ColumnStats): boolean => {
  if (stats.distinctOverflow) return false;
  if (!stats.distinctFinite.size) return false;
  for (const value of stats.distinctFinite) {
    if (value !== 0 && value !== 1) {
      return false;
    }
  }
  return true;
};

export const summarizeMlExportQuality = (
  acc: MlExportQualityAccumulator,
  featureColumns: string[],
  options?: MlExportQualityOptions,
): MlExportQualitySummary => {
  const threshold = options?.highZeroThreshold ?? 0.95;
  const whitelist = options?.highZeroWhitelist ?? [];

  const numericFeatureColumns: string[] = [];
  const allZeroColumns: string[] = [];
  const highZeroColumns: string[] = [];
  const nanOrInfColumns: string[] = [];
  const zeroVarianceContinuousColumns: string[] = [];
  const issues: QualityIssue[] = [];

  for (const column of featureColumns) {
    const stats = acc.columnStats.get(column);
    if (!stats || stats.finiteCount === 0) {
      continue;
    }

    numericFeatureColumns.push(column);

    if (stats.nanOrInfCount > 0) {
      nanOrInfColumns.push(column);
      issues.push({
        code: 'nan_or_inf',
        column,
        details: `nan_or_inf_count=${stats.nanOrInfCount}`,
      });
    }

    const zeroRate = stats.zeroCount / stats.finiteCount;
    if (
      stats.zeroCount === stats.finiteCount &&
      !isWhitelisted(column, whitelist)
    ) {
      allZeroColumns.push(column);
      issues.push({
        code: 'all_zero',
        column,
        details: `zero_rate=1.000`,
      });
      continue;
    }

    if (zeroRate >= threshold && !isWhitelisted(column, whitelist)) {
      highZeroColumns.push(column);
      issues.push({
        code: 'high_zero',
        column,
        details: `zero_rate=${zeroRate.toFixed(3)} threshold=${threshold}`,
      });
    }

    const variance =
      stats.finiteCount > 1 ? stats.m2 / (stats.finiteCount - 1) : 0;
    const continuous = !isBinaryLike(stats);
    if (continuous && variance === 0) {
      zeroVarianceContinuousColumns.push(column);
      issues.push({
        code: 'zero_variance',
        column,
        details: 'variance=0',
      });
    }
  }

  return {
    featureColumns,
    numericFeatureColumns,
    allZeroColumns,
    highZeroColumns,
    nanOrInfColumns,
    zeroVarianceContinuousColumns,
    issues,
  };
};

export const formatMlExportQualityIssues = (
  datasetName: string,
  summary: MlExportQualitySummary,
  limit = 20,
): string[] => {
  const lines: string[] = [];
  lines.push(
    `${datasetName}: features=${summary.featureColumns.length}, numeric_features=${summary.numericFeatureColumns.length}`,
  );
  lines.push(
    `${datasetName}: all_zero=${summary.allZeroColumns.length}, high_zero=${summary.highZeroColumns.length}, nan_or_inf=${summary.nanOrInfColumns.length}, zero_variance_continuous=${summary.zeroVarianceContinuousColumns.length}`,
  );
  if (!summary.issues.length) {
    return lines;
  }

  lines.push(
    `${datasetName}: issues (first ${Math.min(limit, summary.issues.length)}):`,
  );
  for (const issue of summary.issues.slice(0, limit)) {
    lines.push(`  - [${issue.code}] ${issue.column} (${issue.details})`);
  }
  return lines;
};
