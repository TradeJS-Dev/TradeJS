import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { getData, getKeys, redisKeys } from '@utils/redis';

type MlSignalRecord = {
  signal: any;
  context?: {
    userName?: string;
    testId?: string;
    testSuiteId?: string;
    testName?: string;
    symbol?: string;
    strategyName?: string;
    strategyConfig?: any;
    connectorName?: string;
  };
  candles?: any[];
  btcCandles?: any[];
};

type MlResultRecord = {
  signalId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryTimestamp: number;
  entryPrice: number;
  closeTimestamp: number;
  closePrice: number;
  outcome: 'TAKE_PROFIT' | 'STOP_LOSS' | 'CLOSE';
};

args.example(
  'yarn ts-node ./src/scripts/mlExport --format both',
  'Export ML dataset from Redis to data/ml',
);

args.option(['o', 'outDir'], 'Output directory', 'data/ml');
args.option(['f', 'format'], 'csv | jsonl | both', 'both');
args.option(['i', 'includeOpen'], 'Include signals without result', false);
args.option(['n', 'noCandles'], 'Do not export candles arrays', false);
args.option(['l', 'limit'], 'Limit number of signals', 0);
args.option(['s', 'strategy'], 'Filter by strategy/strategyName');

const flags = args.parse(process.argv);

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

const formatPct = (value: number | null): number | null => {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 10000) / 10000;
};

const buildRow = (
  signalRecord: MlSignalRecord,
  resultRecord: MlResultRecord | null,
  includeCandles: boolean,
) => {
  const { signal, context, candles, btcCandles } = signalRecord;

  const signalId = signal?.signalId ?? '';
  const direction = signal?.direction ?? resultRecord?.direction ?? '';
  const entryPrice = resultRecord?.entryPrice ?? null;
  const closePrice = resultRecord?.closePrice ?? null;

  let returnPct: number | null = null;
  if (entryPrice != null && closePrice != null && entryPrice > 0) {
    const raw = (closePrice - entryPrice) / entryPrice;
    returnPct = direction === 'SHORT' ? -raw * 100 : raw * 100;
  }

  const label = returnPct == null ? null : returnPct > 0 ? 1 : 0;

  return {
    signalId,
    symbol: signal?.symbol ?? context?.symbol ?? resultRecord?.symbol ?? '',
    interval: signal?.interval ?? '',
    strategy: signal?.strategy ?? '',
    direction,
    timestamp: signal?.timestamp ?? null,
    currentPrice: signal?.prices?.currentPrice ?? null,
    takeProfitPrice: signal?.prices?.takeProfitPrice ?? null,
    stopLossPrice: signal?.prices?.stopLossPrice ?? null,
    riskRatio: signal?.prices?.riskRatio ?? null,
    touches: signal?.indicators?.touches ?? null,
    distance: signal?.indicators?.distance ?? null,
    atr: signal?.indicators?.atr ?? null,
    correlation: signal?.indicators?.correlation ?? null,
    trendLine: signal?.figures?.trendLine
      ? JSON.stringify(signal?.figures?.trendLine)
      : '',
    userName: context?.userName ?? '',
    testId: context?.testId ?? '',
    testSuiteId: context?.testSuiteId ?? '',
    testName: context?.testName ?? '',
    strategyName: context?.strategyName ?? '',
    connectorName: context?.connectorName ?? '',
    strategyConfig: context?.strategyConfig
      ? JSON.stringify(context?.strategyConfig)
      : '',
    entryTimestamp: resultRecord?.entryTimestamp ?? null,
    entryPrice,
    closeTimestamp: resultRecord?.closeTimestamp ?? null,
    closePrice,
    outcome: resultRecord?.outcome ?? '',
    returnPct: formatPct(returnPct),
    label,
    candles: includeCandles ? JSON.stringify(candles ?? []) : undefined,
    btcCandles: includeCandles ? JSON.stringify(btcCandles ?? []) : undefined,
  };
};

const mlExport = async () => {
  const outDir = flags.outDir as string;
  const includeOpen = Boolean(flags.includeOpen);
  const includeCandles = !Boolean(flags.noCandles);
  const format = String(flags.format || 'both').toLowerCase();
  const strategyFilter = flags.strategy ? String(flags.strategy) : '';

  await fs.mkdir(outDir, { recursive: true });

  const signalKeys = await getKeys(redisKeys.mlSignals());
  const limit = parseInt(flags.limit || '0', 10);
  const keys = limit > 0 ? signalKeys.slice(0, limit) : signalKeys;

  if (!keys.length) {
    console.log(chalk.yellow('No ml:signals keys found.'));
    process.exit(0);
  }

  const rows: Array<Record<string, any>> = [];

  for await (const key of keys) {
    const signalRecord = (await getData(key, null)) as MlSignalRecord | null;

    if (!signalRecord?.signal?.signalId) {
      continue;
    }

    const signalId = signalRecord.signal.signalId as string;
    const resultRecord = (await getData(
      redisKeys.mlResult(signalId),
      null,
    )) as MlResultRecord | null;

    if (!resultRecord && !includeOpen) {
      continue;
    }

    const row = buildRow(signalRecord, resultRecord, includeCandles);

    if (strategyFilter) {
      const rowStrategy = String(
        row.strategy || row.strategyName || '',
      ).toLowerCase();
      if (rowStrategy !== strategyFilter.toLowerCase()) {
        continue;
      }
    }

    rows.push(row);
  }

  if (!rows.length) {
    console.log(chalk.yellow('No rows to export.'));
    process.exit(0);
  }

  const baseName = `ml-dataset-${Date.now()}`;
  const jsonlPath = path.join(outDir, `${baseName}.jsonl`);
  const csvPath = path.join(outDir, `${baseName}.csv`);

  if (format === 'jsonl' || format === 'both') {
    const jsonl = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await fs.writeFile(jsonlPath, jsonl, 'utf8');
    console.log(chalk.green(`JSONL saved: ${jsonlPath}`));
  }

  if (format === 'csv' || format === 'both') {
    const headers = Object.keys(rows[0]).filter(
      (key) => rows[0][key] !== undefined,
    );
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      const line = headers.map((h) => csvEscape(row[h])).join(',');
      csvLines.push(line);
    }
    await fs.writeFile(csvPath, csvLines.join('\n') + '\n', 'utf8');
    console.log(chalk.green(`CSV saved: ${csvPath}`));
  }

  console.log(
    chalk.gray(
      `rows: ${rows.length}, includeOpen: ${includeOpen}, includeCandles: ${includeCandles}, strategy: ${strategyFilter || 'any'}`,
    ),
  );

  process.exit(0);
};

mlExport();
