import type {
  AiPocketCadenceMode,
  AiPocketFeaturePolicy,
  AiPocketSearchObjective,
} from '../aiPocketSearch';
import { readAiPocketSearchCliOption } from '../aiPocketSearchCli';
import {
  parseQualityThresholds,
  parseTimestampFilter,
  parseTrailingPeriodMs,
  resolveAiTrainRecentLimit,
} from '../aiTrainOptions';

export type AiPocketSearchCommandOptions = {
  outDir: string;
  strategyName?: string;
  explicitFile: string;
  skip: number;
  minQuality: number;
  sinceInput: number | null;
  untilTimestamp: number | null;
  trailingPeriodMs: number | null;
  periodLabel: string | null;
  recent: number;
  qualityThresholds: number[];
  scope: string;
  direction: string;
  maxDepth: number;
  explicitMinSupport?: number;
  minProfitFactor: number;
  minWinRate: number;
  minTotalProfit: number;
  maxAtomicPredicates: number;
  maxCombinations: number;
  validationSplit: number;
  testSplit: number;
  sealTest: boolean;
  explicitMinValidationSupport: number;
  explicitMinEvents: number;
  explicitMinValidationEvents: number;
  maxBatch: number;
  maxEventCountShare: number;
  explicitMaxEventCountShare: boolean;
  maxSymbolCountShare: number;
  objective: AiPocketSearchObjective;
  allowRiskRegression: boolean;
  requireValidationEligibility: boolean;
  dedupeEquivalentSelections: boolean;
  top: number;
  includeSymbol: boolean;
  includeGateContext: boolean;
  featureProfile: 'compact' | 'all';
  featurePolicy: AiPocketFeaturePolicy;
  coverageMode: 'auto' | 'full';
  cadenceMode: AiPocketCadenceMode;
  jsonOutput: boolean;
  outputPath: string;
  reportDir: string;
  explicitReportFile: string;
};

const normalizeInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
};

const normalizePositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const normalizeNonNegativeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeRatio = (value: unknown, fallback: number) => {
  if (typeof value === 'boolean') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(0.9, parsed));
};

const normalizeUnitRatio = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
};

const normalizeFeatureProfile = (value: unknown): 'compact' | 'all' => {
  const normalized = String(value || 'all')
    .trim()
    .toLowerCase();
  return normalized === 'compact' ? 'compact' : 'all';
};

const normalizeFeaturePolicy = (value: unknown): AiPocketFeaturePolicy => {
  const normalized = String(value || 'causal-stationary')
    .trim()
    .toLowerCase();
  if (!['causal-stationary', 'all'].includes(normalized)) {
    throw new Error(
      `Unsupported --featurePolicy "${normalized}". Use causal-stationary or all.`,
    );
  }
  return normalized as AiPocketFeaturePolicy;
};

const normalizeCoverageMode = (value: unknown): 'auto' | 'full' => {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (!['auto', 'full'].includes(normalized)) {
    throw new Error(
      `Unsupported --coverageMode "${normalized}". Use auto or full.`,
    );
  }
  return normalized as 'auto' | 'full';
};

const normalizeCadenceMode = (value: unknown): AiPocketCadenceMode => {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (!['auto', 'fixed'].includes(normalized)) {
    throw new Error(
      `Unsupported --cadenceMode "${normalized}". Use auto or fixed.`,
    );
  }
  return normalized as AiPocketCadenceMode;
};

const normalizeObjective = (
  value: unknown,
  scope: string,
): AiPocketSearchObjective => {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (normalized === 'auto') {
    if (scope === 'approved') {
      return 'filter-gate';
    }
    if (scope === 'rejected' || scope === 'candidates') {
      return 'add-to-gate';
    }
    return 'standalone';
  }
  if (!['standalone', 'add-to-gate', 'filter-gate'].includes(normalized)) {
    throw new Error(
      `Unsupported --objective "${normalized}". Use auto, standalone, add-to-gate, or filter-gate.`,
    );
  }
  return normalized as AiPocketSearchObjective;
};

const hasCliOption = (argv: string[], longName: string, shortName?: string) =>
  argv.some(
    (arg) =>
      arg === `--${longName}` ||
      arg.startsWith(`--${longName}=`) ||
      (shortName ? arg === `-${shortName}` : false),
  );

export const resolveAiPocketSearchCommandOptions = ({
  flags,
  argv,
}: {
  flags: Record<string, unknown>;
  argv: string[];
}): AiPocketSearchCommandOptions => {
  const outDir = String(flags.outDir || 'data/ai/export');
  const strategyName = String(flags.strategy || '').trim() || undefined;
  const explicitFile = String(flags.file || '').trim();
  const skip = normalizeInt(flags.skip, 0);
  const minQuality = normalizeInt(flags.minQuality, 4);
  const sinceInput = parseTimestampFilter(flags.since);
  const untilTimestamp = parseTimestampFilter(flags.until);
  const trailingPeriodMs = parseTrailingPeriodMs(flags.period);
  const periodLabel = String(flags.period || '').trim() || null;
  const hasDateFilter =
    trailingPeriodMs != null || sinceInput != null || untilTimestamp != null;
  const recent = resolveAiTrainRecentLimit({
    argv,
    recentValue: flags.recent,
    hasDateFilter,
  });
  const qualityThresholds = parseQualityThresholds(flags.qualityThresholds);
  const scope = String(flags.scope || 'all')
    .trim()
    .toLowerCase();
  if (!['all', 'approved', 'rejected', 'candidates'].includes(scope)) {
    throw new Error(
      `Unsupported --scope "${scope}". Use all, approved, rejected, or candidates.`,
    );
  }
  const direction = String(flags.direction || '')
    .trim()
    .toUpperCase();
  if (direction && !['LONG', 'SHORT'].includes(direction)) {
    throw new Error(
      `Unsupported --direction "${direction}". Use LONG or SHORT.`,
    );
  }

  const explicitMaxEventCountShare = hasCliOption(
    argv,
    'maxEventCountShare',
    'U',
  );
  const maxDepth = normalizePositiveInt(flags.maxDepth, 2);
  const explicitMinSupport = hasCliOption(argv, 'minSupport', 'm')
    ? normalizePositiveInt(flags.minSupport, 20)
    : undefined;
  const minProfitFactor = normalizeNonNegativeNumber(
    readAiPocketSearchCliOption({
      argv,
      longName: 'minProfitFactor',
      shortName: 'F',
    }) ?? flags.minProfitFactor,
    1.2,
  );
  const minWinRate = normalizeNonNegativeNumber(
    readAiPocketSearchCliOption({
      argv,
      longName: 'minWinRate',
      shortName: 'W',
    }) ?? flags.minWinRate,
    0,
  );
  const minTotalProfitValue =
    readAiPocketSearchCliOption({
      argv,
      longName: 'minTotalProfit',
      shortName: 'R',
    }) ?? flags.minTotalProfit;
  const minTotalProfit = Number.isFinite(Number(minTotalProfitValue))
    ? Number(minTotalProfitValue)
    : 0;
  const validationSplit = hasCliOption(argv, 'validationSplit', 'V')
    ? normalizeRatio(
        readAiPocketSearchCliOption({
          argv,
          longName: 'validationSplit',
          shortName: 'V',
        }) ?? flags.validationSplit,
        0.25,
      )
    : 0.25;
  const testSplit = hasCliOption(argv, 'testSplit', 'T')
    ? normalizeRatio(
        readAiPocketSearchCliOption({
          argv,
          longName: 'testSplit',
          shortName: 'T',
        }) ?? flags.testSplit,
        0,
      )
    : 0;
  const sealTest = Boolean(flags.sealTest);
  if (sealTest && testSplit <= 0) {
    throw new Error('--sealTest requires a positive --testSplit');
  }

  const maxEventCountShare = normalizeUnitRatio(
    readAiPocketSearchCliOption({
      argv,
      longName: 'maxEventCountShare',
      shortName: 'U',
    }) ?? flags.maxEventCountShare,
    0.25,
  );
  const maxSymbolCountShare = normalizeUnitRatio(
    readAiPocketSearchCliOption({
      argv,
      longName: 'maxSymbolCountShare',
      shortName: 'Z',
    }) ?? flags.maxSymbolCountShare,
    0.5,
  );
  const objective = normalizeObjective(flags.objective, scope);

  return {
    outDir,
    strategyName,
    explicitFile,
    skip,
    minQuality,
    sinceInput,
    untilTimestamp,
    trailingPeriodMs,
    periodLabel,
    recent,
    qualityThresholds,
    scope,
    direction,
    maxDepth,
    ...(explicitMinSupport != null ? { explicitMinSupport } : {}),
    minProfitFactor,
    minWinRate,
    minTotalProfit,
    maxAtomicPredicates: normalizePositiveInt(flags.maxAtomicPredicates, 180),
    maxCombinations: normalizePositiveInt(flags.maxCombinations, 60_000),
    validationSplit,
    testSplit,
    sealTest,
    explicitMinValidationSupport: normalizeInt(flags.minValidationSupport, 0),
    explicitMinEvents: normalizeInt(flags.minEvents, 0),
    explicitMinValidationEvents: normalizeInt(flags.minValidationEvents, 0),
    maxBatch: normalizeInt(flags.maxBatch, 5),
    maxEventCountShare,
    explicitMaxEventCountShare,
    maxSymbolCountShare,
    objective,
    allowRiskRegression: Boolean(flags.allowRiskRegression),
    requireValidationEligibility: !Boolean(flags.allowValidationRegression),
    dedupeEquivalentSelections: Boolean(flags.dedupeEquivalentSelections),
    top: normalizePositiveInt(flags.top, 30),
    includeSymbol: Boolean(flags.includeSymbol),
    includeGateContext: Boolean(flags.includeGateContext),
    featureProfile: normalizeFeatureProfile(flags.featureProfile),
    featurePolicy: normalizeFeaturePolicy(flags.featurePolicy),
    coverageMode: normalizeCoverageMode(flags.coverageMode),
    cadenceMode: normalizeCadenceMode(flags.cadenceMode),
    jsonOutput: Boolean(flags.json),
    outputPath: String(flags.output || '').trim(),
    reportDir: String(flags.reportDir || 'data/ai/output').trim(),
    explicitReportFile: String(flags.reportFile || '').trim(),
  };
};
