import args from 'args';
import chalk from 'chalk';
import ProgressBar from 'progress';
import { once } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { cleanRedis } from '@utils/cli';
import { getData, getKeys, redisKeys } from '@utils/redis';
import {
  buildMlTrainingRow,
  MlResultRecord,
  MlSignalRecord,
} from '@utils/mlTrainingTransform';
import {
  createMlExportQualityAccumulator,
  deriveTrainFeatureColumns,
  formatMlExportQualityIssues,
  ingestMlExportQualityRow,
  summarizeMlExportQuality,
} from '@utils/mlExportQuality';
import {
  DerivativesInterval,
  getDerivativesRangeForSymbols,
  getSpreadRangeForSymbols,
} from '@utils/timescale';
import { rollingMeanStd } from '@utils/marketSpread';
import {
  binarySearchLatestByTs,
  parseDerivativesIntervals,
  toFiniteNumber,
  toTimestampMs,
} from '@utils/derivativesFeatureUtils';

args.example(
  'yarn ts-node ./src/scripts/mlExport --format both',
  'Export ML dataset from Redis to data/ml/export',
);

args.option(['o', 'outDir'], 'Output directory', 'data/ml/export');
args.option(['f', 'format'], 'csv | jsonl | both', 'both');
args.option(['i', 'includeOpen'], 'Include signals without result', false);
args.option(['l', 'limit'], 'Limit number of signals', 0);
args.option(['s', 'strategy'], 'Filter by strategy/strategyName');
args.option(
  ['c', 'clearRedis'],
  'Clear ml:* keys after successful export',
  false,
);
args.option(
  ['D', 'withDerivatives'],
  'Attach derivatives features (OI/funding/liquidations) from Timescale',
  true,
);
args.option(
  ['T', 'derivativesIntervals'],
  'Derivatives intervals (comma-separated): 15m,1h',
  '15m,1h',
);
args.option(
  ['P', 'withSpread'],
  'Attach Binance/Coinbase spread features from Timescale',
  true,
);
args.option(
  ['R', 'spreadIntervals'],
  'Spread intervals (comma-separated): 15m,1h',
  '15m,1h',
);

const flags = args.parse(process.argv);

const toFileToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'any';

const csvEscape = (value: unknown): string => {
  if (value == null) return '';
  const raw = String(value);
  if (raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  if (raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw}"`;
  }
  return raw;
};

const normalizeTimestamp = (value: unknown): number | null => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num < 1_000_000_000_000 ? num * 1000 : num;
};

const getSignalTimestamp = (record: MlSignalRecord): number | null =>
  normalizeTimestamp(
    record?.signal?.timestamp ??
      record?.signal?.entryTimestamp ??
      record?.context?.entryTimestamp,
  );

const buildRow = (
  signalRecord: MlSignalRecord,
  resultRecord: MlResultRecord | null,
) => buildMlTrainingRow(signalRecord, resultRecord);

const CHUNK_SIZE = 1000;
const EXPORT_HIGH_ZERO_THRESHOLD = 0.95;
const EXPORT_HIGH_ZERO_WHITELIST: string[] = [];
const XS_BUCKET_MINUTES = 60;
const DERIVATIVES_SNAPSHOT_LOOKBACK_DAYS = 365;

type MetricKey = 'momentum' | 'volatility' | 'volume';

type RunningStat = {
  n: number;
  mean: number;
  m2: number;
};

type BucketStats = Record<MetricKey, RunningStat> & {
  count: number;
};

type DerivativesPoint = {
  ts: number;
  openInterest: number;
  fundingRate: number;
  liqLong: number;
  liqShort: number;
  liqTotal: number;
};

type DerivativesBySymbol = Map<string, DerivativesPoint[]>;
type DerivativesFeatureStore = Map<DerivativesInterval, DerivativesBySymbol>;

type SpreadPoint = {
  ts: number;
  spread: number;
  binancePrice: number;
  coinbasePrice: number;
};

type SpreadBySymbol = Map<string, SpreadPoint[]>;
type SpreadFeatureStore = Map<DerivativesInterval, SpreadBySymbol>;

const addHeaders = (
  row: Record<string, any>,
  headers: string[],
  headerSet: Set<string>,
) => {
  for (const key of Object.keys(row)) {
    if (row[key] === undefined || headerSet.has(key)) continue;
    headerSet.add(key);
    headers.push(key);
  }
};

const writeJsonlChunk = async (
  filePath: string,
  rows: Array<Record<string, any>>,
) => {
  if (!rows.length) return;
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  const done = new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
  });
  for (const row of rows) {
    if (!stream.write(`${JSON.stringify(row)}\n`)) {
      await once(stream, 'drain');
    }
  }
  stream.end();
  await done;
};

const appendJsonlChunks = async (targetPath: string, chunkPaths: string[]) => {
  const stream = createWriteStream(targetPath, { encoding: 'utf8' });
  const done = new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
  });

  for (const chunkPath of chunkPaths) {
    const reader = createReadStream(chunkPath, { encoding: 'utf8' });
    for await (const chunk of reader) {
      if (!stream.write(chunk)) {
        await once(stream, 'drain');
      }
    }
  }

  stream.end();
  await done;
};

const writeCsvFromJsonlChunks = async (
  targetPath: string,
  headers: string[],
  chunkPaths: string[],
) => {
  const stream = createWriteStream(targetPath, { encoding: 'utf8' });
  const done = new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
  });

  if (!stream.write(`${headers.join(',')}\n`)) {
    await once(stream, 'drain');
  }

  for (const chunkPath of chunkPaths) {
    const rl = readline.createInterface({
      input: createReadStream(chunkPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const row = JSON.parse(trimmed) as Record<string, any>;
      const lineOut = `${headers.map((h) => csvEscape(row[h])).join(',')}\n`;
      if (!stream.write(lineOut)) {
        await once(stream, 'drain');
      }
    }
  }

  stream.end();
  await done;
};

const ensureStat = (value?: RunningStat): RunningStat =>
  value ?? { n: 0, mean: 0, m2: 0 };

const updateStat = (stat: RunningStat, value: number) => {
  stat.n += 1;
  const delta = value - stat.mean;
  stat.mean += delta / stat.n;
  const delta2 = value - stat.mean;
  stat.m2 += delta * delta2;
};

const statStd = (stat: RunningStat) =>
  stat.n > 1 ? Math.sqrt(stat.m2 / (stat.n - 1)) : 0;

const toFinite = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const floorToBucket = (ts: number, bucketMinutes: number) => {
  const bucketMs = bucketMinutes * 60 * 1000;
  if (!bucketMs || !Number.isFinite(ts) || ts <= 0) return 0;
  return Math.floor(ts / bucketMs) * bucketMs;
};

const erfApprox = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t *
      Math.exp(-ax * ax));
  return sign * y;
};

const normalCdf = (z: number) => 0.5 * (1 + erfApprox(z / Math.SQRT2));

const metricFromRow = (row: Record<string, any>, metric: MetricKey) => {
  if (metric === 'momentum') {
    return toFinite(
      row.TF15M_Price1hPcnt_10 ??
        row.TF15M_Price1hPcnt_9 ??
        row.TF1H_Price1hPcnt_10 ??
        row.TF15M_RelRet_Mean10,
    );
  }
  if (metric === 'volatility') {
    return toFinite(
      row.Regime_RealizedVol_10 ??
        row.TF15M_AltRet_Std10 ??
        row.Regime_ATR_PCT_Last,
    );
  }
  return toFinite(
    row.TF15M_Volume1h_10_MedianNorm ??
      row.TF15M_Candle_Volume_10_MedianNorm ??
      row.TF1H_Volume1h_10_MedianNorm ??
      0,
  );
};

const buildCrossSectionStats = async (
  filePath: string,
  bucketMinutes: number,
) => {
  const stats = new Map<number, BucketStats>();
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, any>;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const ts = normalizeTimestamp(row.entryTimestamp);
    if (!ts) continue;
    const bucket = floorToBucket(ts, bucketMinutes);
    let bucketStats = stats.get(bucket);
    if (!bucketStats) {
      bucketStats = {
        count: 0,
        momentum: ensureStat(),
        volatility: ensureStat(),
        volume: ensureStat(),
      };
      stats.set(bucket, bucketStats);
    }
    bucketStats.count += 1;
    updateStat(bucketStats.momentum, metricFromRow(row, 'momentum'));
    updateStat(bucketStats.volatility, metricFromRow(row, 'volatility'));
    updateStat(bucketStats.volume, metricFromRow(row, 'volume'));
  }
  return stats;
};

const enrichCrossSectionalFeatures = async (
  filePath: string,
  bucketMinutes: number,
) => {
  const stats = await buildCrossSectionStats(filePath, bucketMinutes);
  const tempPath = `${filePath}.tmp`;
  const stream = createWriteStream(tempPath, { encoding: 'utf8' });
  const done = new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
  });
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, any>;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const ts = normalizeTimestamp(row.entryTimestamp);
    if (ts) {
      const bucket = floorToBucket(ts, bucketMinutes);
      const bucketStats = stats.get(bucket);
      if (bucketStats) {
        const momentum = metricFromRow(row, 'momentum');
        const volatility = metricFromRow(row, 'volatility');
        const volume = metricFromRow(row, 'volume');
        const momentumStd = statStd(bucketStats.momentum);
        const volatilityStd = statStd(bucketStats.volatility);
        const volumeStd = statStd(bucketStats.volume);
        const momentumZ =
          momentumStd > 0
            ? (momentum - bucketStats.momentum.mean) / momentumStd
            : 0;
        const volatilityZ =
          volatilityStd > 0
            ? (volatility - bucketStats.volatility.mean) / volatilityStd
            : 0;
        const volumeZ =
          volumeStd > 0 ? (volume - bucketStats.volume.mean) / volumeStd : 0;
        const composite = 0.5 * momentumZ - 0.25 * volatilityZ + 0.25 * volumeZ;

        row.XS_BucketCount = bucketStats.count;
        row.XS_Momentum_Z = Math.max(-8, Math.min(8, momentumZ));
        row.XS_Volatility_Z = Math.max(-8, Math.min(8, volatilityZ));
        row.XS_Volume_Z = Math.max(-8, Math.min(8, volumeZ));
        row.XS_Momentum_Pct = normalCdf(momentumZ);
        row.XS_Volatility_Pct = normalCdf(volatilityZ);
        row.XS_Volume_Pct = normalCdf(volumeZ);
        row.XS_Composite = Math.max(-8, Math.min(8, composite));
        row.XS_Composite_Pct = normalCdf(composite);
      }
    }
    if (!stream.write(`${JSON.stringify(row)}\n`)) {
      await once(stream, 'drain');
    }
  }
  stream.end();
  await done;
  await fs.rename(tempPath, filePath);
};

const scanJsonlDatasetQuality = async (
  filePath: string,
  datasetLabel: string,
) => {
  const acc = createMlExportQualityAccumulator();
  const headers = new Set<string>();
  let rowCount = 0;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    rowCount += 1;
    for (const key of Object.keys(row)) headers.add(key);
    ingestMlExportQualityRow(acc, row);
  }
  const featureColumns = deriveTrainFeatureColumns([...headers]);
  const summary = summarizeMlExportQuality(acc, featureColumns, {
    highZeroThreshold: EXPORT_HIGH_ZERO_THRESHOLD,
    highZeroWhitelist: EXPORT_HIGH_ZERO_WHITELIST,
  });
  return { datasetLabel, summary, rowCount };
};

const writeDatasetQualityMarkdown = async (params: {
  datasetPath: string;
  datasetLabel: string;
  rowCount: number;
  summary: ReturnType<typeof summarizeMlExportQuality>;
}) => {
  const { datasetPath, datasetLabel, rowCount, summary } = params;
  const mdPath = `${datasetPath.replace(/\.jsonl$/i, '')}.quality.md`;
  const lines: string[] = [
    `# Dataset Quality: ${datasetLabel}`,
    '',
    `- file: ${path.basename(datasetPath)}`,
    `- rows: ${rowCount}`,
    `- feature_columns: ${summary.featureColumns.length}`,
    `- numeric_feature_columns: ${summary.numericFeatureColumns.length}`,
    `- all_zero_columns: ${summary.allZeroColumns.length}`,
    `- high_zero_columns(>=${Math.round(EXPORT_HIGH_ZERO_THRESHOLD * 100)}%): ${summary.highZeroColumns.length}`,
    `- nan_or_inf_columns: ${summary.nanOrInfColumns.length}`,
    `- zero_variance_continuous_columns: ${summary.zeroVarianceContinuousColumns.length}`,
    '',
    '## Issues',
    '',
  ];
  if (!summary.issues.length) {
    lines.push('- none');
  } else {
    for (const issue of summary.issues.slice(0, 200)) {
      lines.push(`- [${issue.code}] ${issue.column} (${issue.details})`);
    }
  }
  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8');
  return mdPath;
};

const normalizeIntervals = (value: unknown): DerivativesInterval[] => {
  const parsed = parseDerivativesIntervals(value);
  return parsed.length ? parsed : ['15m', '1h'];
};

const toDerivativePoint = (row: Record<string, unknown>): DerivativesPoint | null => {
  const ts = toTimestampMs(row.ts);
  if (ts == null || !Number.isFinite(ts)) return null;
  return {
    ts,
    openInterest: toFiniteNumber(row.open_interest, 0),
    fundingRate: toFiniteNumber(row.funding_rate, 0),
    liqLong: toFiniteNumber(row.liq_long, 0),
    liqShort: toFiniteNumber(row.liq_short, 0),
    liqTotal: toFiniteNumber(row.liq_total, 0),
  };
};

const toSpreadPoint = (row: Record<string, unknown>): SpreadPoint | null => {
  const ts = toTimestampMs(row.ts);
  if (ts == null || !Number.isFinite(ts)) return null;
  return {
    ts,
    spread: toFiniteNumber(row.spread, 0),
    binancePrice: toFiniteNumber(row.binance_price, 0),
    coinbasePrice: toFiniteNumber(row.coinbase_price, 0),
  };
};

const loadDerivativesFeatureStore = async (params: {
  symbols: string[];
  intervals: DerivativesInterval[];
  minTs: number;
  maxTs: number;
}): Promise<DerivativesFeatureStore> => {
  const store: DerivativesFeatureStore = new Map();
  const { symbols, intervals, minTs, maxTs } = params;
  if (!symbols.length || !intervals.length || !minTs || !maxTs) return store;

  const startTs = Math.max(
    0,
    minTs - DERIVATIVES_SNAPSHOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  for (const interval of intervals) {
    const rows = await getDerivativesRangeForSymbols(
      symbols,
      interval,
      startTs,
      maxTs,
    );
    const bySymbol: DerivativesBySymbol = new Map();
    for (const row of rows as Array<Record<string, unknown>>) {
      const symbol = String(row.symbol ?? '').trim().toUpperCase();
      if (!symbol) continue;
      const point = toDerivativePoint(row);
      if (!point) continue;
      const bucket = bySymbol.get(symbol);
      if (bucket) {
        bucket.push(point);
      } else {
        bySymbol.set(symbol, [point]);
      }
    }
    for (const points of bySymbol.values()) {
      points.sort((a, b) => a.ts - b.ts);
    }
    store.set(interval, bySymbol);
  }
  return store;
};

const loadSpreadFeatureStore = async (params: {
  symbols: string[];
  intervals: DerivativesInterval[];
  minTs: number;
  maxTs: number;
}): Promise<SpreadFeatureStore> => {
  const store: SpreadFeatureStore = new Map();
  const { symbols, intervals, minTs, maxTs } = params;
  if (!symbols.length || !intervals.length || !minTs || !maxTs) return store;

  const startTs = Math.max(
    0,
    minTs - DERIVATIVES_SNAPSHOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  for (const interval of intervals) {
    const rows = await getSpreadRangeForSymbols(symbols, interval, startTs, maxTs);
    const bySymbol: SpreadBySymbol = new Map();
    for (const row of rows as Array<Record<string, unknown>>) {
      const symbol = String(row.symbol ?? '').trim().toUpperCase();
      if (!symbol) continue;
      const point = toSpreadPoint(row);
      if (!point) continue;
      const bucket = bySymbol.get(symbol);
      if (bucket) {
        bucket.push(point);
      } else {
        bySymbol.set(symbol, [point]);
      }
    }
    for (const points of bySymbol.values()) {
      points.sort((a, b) => a.ts - b.ts);
    }
    store.set(interval, bySymbol);
  }
  return store;
};

const attachDerivativesFeatures = (
  row: Record<string, any>,
  featureStore: DerivativesFeatureStore,
  signalTs: number,
) => {
  const symbol = String(row.symbol ?? '').trim().toUpperCase();
  if (!symbol || !signalTs || !Number.isFinite(signalTs)) return;

  for (const [interval, bySymbol] of featureStore.entries()) {
    const points = bySymbol.get(symbol);
    if (!points || !points.length) continue;
    const idx = binarySearchLatestByTs(points, signalTs);
    if (idx < 0) continue;
    const current = points[idx];
    const prev = idx > 0 ? points[idx - 1] : null;
    const prefix = interval === '15m' ? 'DERIV_TF15M' : 'DERIV_TF1H';
    const ageMinutes = Math.max(0, (signalTs - current.ts) / 60_000);

    row[`${prefix}_AgeMin`] = ageMinutes;
    row[`${prefix}_HasData`] = 1;
    row[`${prefix}_OI`] = current.openInterest;
    row[`${prefix}_Funding`] = current.fundingRate;
    row[`${prefix}_LiqLong`] = current.liqLong;
    row[`${prefix}_LiqShort`] = current.liqShort;
    row[`${prefix}_LiqTotal`] = current.liqTotal;
    row[`${prefix}_LiqImbalance`] = current.liqTotal
      ? (current.liqLong - current.liqShort) / current.liqTotal
      : 0;

    if (prev) {
      row[`${prefix}_OI_Delta`] = current.openInterest - prev.openInterest;
      row[`${prefix}_Funding_Delta`] = current.fundingRate - prev.fundingRate;
      row[`${prefix}_LiqTotal_Delta`] = current.liqTotal - prev.liqTotal;
    } else {
      row[`${prefix}_OI_Delta`] = 0;
      row[`${prefix}_Funding_Delta`] = 0;
      row[`${prefix}_LiqTotal_Delta`] = 0;
    }
  }
};

const attachSpreadFeatures = (
  row: Record<string, any>,
  featureStore: SpreadFeatureStore,
  signalTs: number,
) => {
  const symbol = String(row.symbol ?? '').trim().toUpperCase();
  if (!symbol || !signalTs || !Number.isFinite(signalTs)) return;

  for (const [interval, bySymbol] of featureStore.entries()) {
    const points = bySymbol.get(symbol);
    if (!points || !points.length) continue;
    const idx = binarySearchLatestByTs(points, signalTs);
    if (idx < 0) continue;
    const current = points[idx];
    const prev1 = idx > 0 ? points[idx - 1] : null;
    const prev3 = idx > 2 ? points[idx - 3] : null;
    const prefix = interval === '15m' ? 'SPREAD_TF15M' : 'SPREAD_TF1H';
    const ageMinutes = Math.max(0, (signalTs - current.ts) / 60_000);
    const series = points.map((point) => point.spread);
    const { mean, std } = rollingMeanStd(series, idx, 20);
    const z = std > 0 ? (current.spread - mean) / std : 0;

    row[`${prefix}_AgeMin`] = ageMinutes;
    row[`${prefix}_HasData`] = 1;
    row[`${prefix}_Value`] = current.spread;
    row[`${prefix}_Mean20`] = mean;
    row[`${prefix}_Std20`] = std;
    row[`${prefix}_Z`] = z;
    row[`${prefix}_Breakout`] = Math.abs(z) >= 2 ? (z > 0 ? 1 : -1) : 0;
    row[`${prefix}_Delta1`] = prev1 ? current.spread - prev1.spread : 0;
    row[`${prefix}_Delta3`] = prev3 ? current.spread - prev3.spread : 0;
    row[`${prefix}_BinancePx`] = current.binancePrice;
    row[`${prefix}_CoinbasePx`] = current.coinbasePrice;
  }
};

const mlExport = async () => {
  const outDir = flags.outDir as string;
  const includeOpen = Boolean(flags.includeOpen);
  const withDerivatives = Boolean(flags.withDerivatives);
  const withSpread = Boolean(flags.withSpread);
  const derivativesIntervals = normalizeIntervals(flags.derivativesIntervals);
  const spreadIntervals = normalizeIntervals(flags.spreadIntervals);
  const format = String(flags.format || 'both').toLowerCase();
  const strategyFilter = flags.strategy ? String(flags.strategy) : '';

  await fs.mkdir(outDir, { recursive: true });

  const rawSignalKeys = flags.strategy
    ? await getKeys(redisKeys.mlSignalsByStrategy(flags.strategy))
    : await getKeys(redisKeys.mlSignals());
  const signalKeys = flags.strategy
    ? rawSignalKeys
    : rawSignalKeys.filter((key) => key.includes(':signals:'));
  const limit = parseInt(flags.limit || '0', 10);
  const keys = limit > 0 ? signalKeys.slice(0, limit) : signalKeys;

  if (!keys.length) {
    console.log(chalk.yellow('No ml:signals keys found.'));
    process.exit(0);
  }

  const rowsChunk: Array<Record<string, any>> = [];
  const headers: string[] = [];
  const headerSet = new Set<string>();

  const tempDir = path.join(
    outDir,
    `ml-export-chunks-${Date.now()}-${process.pid}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });

  const chunkFiles: string[] = [];
  let totalRows = 0;
  let maxTimestamp = 0;
  let minTimestampScan = Number.MAX_SAFE_INTEGER;
  let minTimestamp = Number.MAX_SAFE_INTEGER;
  let labeledRows = 0;
  const symbolCounts = new Map<string, number>();
  const derivativeSymbols = new Set<string>();
  const spreadSymbols = new Set<string>();

  const totalChunks = Math.ceil(keys.length / CHUNK_SIZE) || 1;
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :rows :pos :neg',
    {
      total: totalChunks,
      width: 30,
    },
  );
  let posCount = 0;
  let negCount = 0;

  for (let start = 0; start < keys.length; start += CHUNK_SIZE) {
    const batch = keys.slice(start, start + CHUNK_SIZE);
    for await (const key of batch) {
      const signalRecord = (await getData(key, null)) as MlSignalRecord | null;
      if (!signalRecord?.signal) continue;

      if (strategyFilter) {
        const rowStrategy = String(
          signalRecord.signal?.strategy ||
            signalRecord.context?.strategyName ||
            '',
        ).toLowerCase();
        if (rowStrategy !== strategyFilter.toLowerCase()) {
          continue;
        }
      }

      const ts = getSignalTimestamp(signalRecord);
      if (ts && ts > maxTimestamp) {
        maxTimestamp = ts;
      }
      if (ts && ts < minTimestampScan) {
        minTimestampScan = ts;
      }
      const symbol = String(
        signalRecord.signal?.symbol ?? signalRecord.context?.symbol ?? '',
      )
        .trim()
        .toUpperCase();
      if (withDerivatives && symbol) {
        derivativeSymbols.add(symbol);
      }
      if (withSpread && symbol) {
        spreadSymbols.add(symbol);
      }
    }
  }

  if (!maxTimestamp) {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(chalk.yellow('No signals with timestamp found.'));
    process.exit(0);
  }

  let derivativesFeatureStore: DerivativesFeatureStore = new Map();
  let spreadFeatureStore: SpreadFeatureStore = new Map();
  if (withDerivatives) {
    try {
      derivativesFeatureStore = await loadDerivativesFeatureStore({
        symbols: [...derivativeSymbols],
        intervals: derivativesIntervals,
        minTs:
          minTimestampScan === Number.MAX_SAFE_INTEGER ? maxTimestamp : minTimestampScan,
        maxTs: maxTimestamp,
      });
      console.log(
        chalk.cyan(
          `Derivatives feature store loaded: symbols=${derivativeSymbols.size}, intervals=${derivativesIntervals.join(',')}`,
        ),
      );
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Derivatives enrichment skipped: ${(error as Error)?.message || error}`,
        ),
      );
      derivativesFeatureStore = new Map();
    }
  }
  if (withSpread) {
    try {
      spreadFeatureStore = await loadSpreadFeatureStore({
        symbols: [...spreadSymbols],
        intervals: spreadIntervals,
        minTs:
          minTimestampScan === Number.MAX_SAFE_INTEGER ? maxTimestamp : minTimestampScan,
        maxTs: maxTimestamp,
      });
      console.log(
        chalk.cyan(
          `Spread feature store loaded: symbols=${spreadSymbols.size}, intervals=${spreadIntervals.join(',')}`,
        ),
      );
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Spread enrichment skipped: ${(error as Error)?.message || error}`,
        ),
      );
      spreadFeatureStore = new Map();
    }
  }

  for (let start = 0; start < keys.length; start += CHUNK_SIZE) {
    const batch = keys.slice(start, start + CHUNK_SIZE);
    rowsChunk.length = 0;

    for await (const key of batch) {
      const signalRecord = (await getData(key, null)) as MlSignalRecord | null;

      if (!signalRecord?.signal?.signalId) {
        continue;
      }

      const signalId = signalRecord.signal.signalId as string;
      const keyParts = key.split(':');
      const strategyNameFromKey =
        keyParts.length >= 4 ? keyParts[1] : undefined;
      const strategyName =
        strategyNameFromKey ||
        signalRecord?.context?.strategyName ||
        signalRecord?.signal?.strategy;

      const resultRecord = strategyName
        ? ((await getData(
            redisKeys.mlResult(strategyName, signalId),
            null,
          )) as MlResultRecord | null)
        : null;

      if (!resultRecord && !includeOpen) {
        continue;
      }

      if (strategyFilter) {
        const rowStrategy = String(
          signalRecord.signal?.strategy ||
            signalRecord.context?.strategyName ||
            '',
        ).toLowerCase();
        if (rowStrategy !== strategyFilter.toLowerCase()) {
          continue;
        }
      }

      const ts = getSignalTimestamp(signalRecord);
      if (!ts) {
        continue;
      }

      const row = buildRow(signalRecord, resultRecord);
      if (withDerivatives && derivativesFeatureStore.size > 0) {
        attachDerivativesFeatures(row, derivativesFeatureStore, ts);
      }
      if (withSpread && spreadFeatureStore.size > 0) {
        attachSpreadFeatures(row, spreadFeatureStore, ts);
      }
      if (row.label === 1) posCount += 1;
      if (row.label === 0) negCount += 1;
      const symbol = String(row.symbol ?? '').trim().toUpperCase();
      if (symbol) {
        symbolCounts.set(symbol, (symbolCounts.get(symbol) ?? 0) + 1);
      }
      if (ts < minTimestamp) minTimestamp = ts;
      rowsChunk.push(row);
      addHeaders(row, headers, headerSet);
      if (row.label === 0 || row.label === 1) labeledRows += 1;
    }

    if (rowsChunk.length) {
      const chunkPath = path.join(tempDir, `chunk-${start}.jsonl`);
      await writeJsonlChunk(chunkPath, rowsChunk);
      chunkFiles.push(chunkPath);
      totalRows += rowsChunk.length;
    }

    bar.tick(1, {
      rows: chalk.yellow(totalRows),
      pos: chalk.green(posCount),
      neg: chalk.red(negCount),
    });
  }

  if (totalRows === 0) {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(chalk.yellow('No rows to export.'));
    process.exit(0);
  }

  const strategyToken = toFileToken(strategyFilter || 'any');
  const baseName = `ml-dataset-${strategyToken}-${Date.now()}`;
  const jsonlPath = path.join(outDir, `${baseName}.jsonl`);
  const csvPath = path.join(outDir, `${baseName}.csv`);

  if (format === 'jsonl' || format === 'both') {
    await appendJsonlChunks(jsonlPath, chunkFiles);
    await enrichCrossSectionalFeatures(jsonlPath, XS_BUCKET_MINUTES);
    console.log(chalk.green(`JSONL saved: ${jsonlPath}`));
  }

  if (format === 'csv' || format === 'both') {
    await writeCsvFromJsonlChunks(csvPath, headers, chunkFiles);
    console.log(chalk.green(`CSV saved: ${csvPath}`));
  }

  for (const filePath of chunkFiles) {
    await fs.rm(filePath, { force: true });
  }
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(
    chalk.gray(
      `rows: ${totalRows} (chunks: ${chunkFiles.length}), includeOpen: ${includeOpen}, strategy: ${strategyFilter || 'any'}`,
    ),
  );
  const pct = (part: number, whole: number) =>
    whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : 'n/a';
  const topSymbols = [...symbolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => `${symbol}:${count}`)
    .join(', ');
  const minIso =
    minTimestamp === Number.MAX_SAFE_INTEGER
      ? 'n/a'
      : new Date(minTimestamp).toISOString();
  const maxIso = maxTimestamp ? new Date(maxTimestamp).toISOString() : 'n/a';
  console.log(chalk.cyan('Data quality snapshot:'));
  console.log(
    `  labeled=${labeledRows} (pos=${posCount}, neg=${negCount}, pos_rate=${pct(posCount, labeledRows)})`,
  );
  console.log(
    `  symbols=${symbolCounts.size}, top10=[${topSymbols || 'n/a'}]`,
  );
  console.log(`  time_range=${minIso} .. ${maxIso}`);

  if (!(format === 'jsonl' || format === 'both')) {
    console.log(
      chalk.yellow(
        'Post-export quality checks skipped: JSONL is required for feature quality scan.',
      ),
    );
    process.exit(0);
  }

  const scan = await scanJsonlDatasetQuality(jsonlPath, 'dataset');
  const quality = scan.summary;
  console.log(chalk.cyan('Post-export quality checks:'));
  for (const line of formatMlExportQualityIssues('dataset', quality, 10)) {
    console.log(`  ${line}`);
  }
  const qualityMd = await writeDatasetQualityMarkdown({
    datasetPath: jsonlPath,
    datasetLabel: 'dataset',
    rowCount: scan.rowCount,
    summary: quality,
  });
  console.log(chalk.green(`Quality report saved: ${qualityMd}`));
  const qualityIssues = [...quality.issues];
  if (qualityIssues.length > 0) {
    console.error(
      chalk.red(
        `Export quality checks failed: ${qualityIssues.length} issue(s). ` +
          'Fix feature generation or extend whitelist intentionally.',
      ),
    );
    process.exit(1);
  }

  if (flags.clearRedis) {
    if (!strategyFilter) {
      console.log(
        chalk.yellow(
          'Skipping Redis cleanup: --clearRedis requires --strategy to avoid deleting all ml:* keys.',
        ),
      );
    } else {
      const strategyPrefix = `ml:${strategyFilter}:`;
      console.log(chalk.gray(`Clearing Redis keys: ${strategyPrefix}*`));
      await cleanRedis(strategyPrefix);
    }
  }

  process.exit(0);
};

mlExport();
