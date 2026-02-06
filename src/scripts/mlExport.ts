import args from 'args';
import chalk from 'chalk';
import ProgressBar from 'progress';
import { once } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { getData, getKeys, redisKeys } from '@utils/redis';
import {
  buildMlTrainingRow,
  MlResultRecord,
  MlSignalRecord,
} from '@utils/mlTrainingTransform';

args.example(
  'yarn ts-node ./src/scripts/mlExport --format both',
  'Export ML dataset from Redis to data/ml',
);

args.option(['o', 'outDir'], 'Output directory', 'data/ml');
args.option(['f', 'format'], 'csv | jsonl | both', 'both');
args.option(['i', 'includeOpen'], 'Include signals without result', false);
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

const mlExport = async () => {
  const outDir = flags.outDir as string;
  const includeOpen = Boolean(flags.includeOpen);
  const format = String(flags.format || 'both').toLowerCase();
  const strategyFilter = flags.strategy ? String(flags.strategy) : '';
  const trainLabel = 'train';
  const testLabel = 'test';

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

  const rowsTrain: Array<Record<string, any>> = [];
  const rowsTest: Array<Record<string, any>> = [];

  const headersTrain: string[] = [];
  const headersTest: string[] = [];
  const headerSetTrain = new Set<string>();
  const headerSetTest = new Set<string>();

  const tempDir = path.join(outDir, `ml-export-chunks-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const chunkFilesTrain: string[] = [];
  const chunkFilesTest: string[] = [];
  let totalRows = 0;
  let maxTimestamp = 0;

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
    }
  }

  if (!maxTimestamp) {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(chalk.yellow('No signals with timestamp found.'));
    process.exit(0);
  }

  const testWindowMs = 30 * 24 * 60 * 60 * 1000;
  const testStart = maxTimestamp - testWindowMs;

  for (let start = 0; start < keys.length; start += CHUNK_SIZE) {
    const batch = keys.slice(start, start + CHUNK_SIZE);
    rowsTrain.length = 0;
    rowsTest.length = 0;

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
      if (row.label === 1) posCount += 1;
      if (row.label === 0) negCount += 1;

      if (ts >= testStart) {
        rowsTest.push(row);
        addHeaders(row, headersTest, headerSetTest);
      } else {
        rowsTrain.push(row);
        addHeaders(row, headersTrain, headerSetTrain);
      }
    }

    if (rowsTrain.length) {
      const chunkPathTrain = path.join(
        tempDir,
        `chunk-${trainLabel}-${start}.jsonl`,
      );
      await writeJsonlChunk(chunkPathTrain, rowsTrain);
      chunkFilesTrain.push(chunkPathTrain);
      totalRows += rowsTrain.length;
    }
    if (rowsTest.length) {
      const chunkPathTest = path.join(
        tempDir,
        `chunk-${testLabel}-${start}.jsonl`,
      );
      await writeJsonlChunk(chunkPathTest, rowsTest);
      chunkFilesTest.push(chunkPathTest);
      totalRows += rowsTest.length;
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

  const baseName = `ml-dataset-${Date.now()}`;
  const jsonlPathTrain = path.join(outDir, `${baseName}.${trainLabel}.jsonl`);
  const csvPathTrain = path.join(outDir, `${baseName}.${trainLabel}.csv`);
  const jsonlPathTest = path.join(outDir, `${baseName}.${testLabel}.jsonl`);
  const csvPathTest = path.join(outDir, `${baseName}.${testLabel}.csv`);

  if (format === 'jsonl' || format === 'both') {
    await appendJsonlChunks(jsonlPathTrain, chunkFilesTrain);
    await appendJsonlChunks(jsonlPathTest, chunkFilesTest);
    console.log(chalk.green(`JSONL saved: ${jsonlPathTrain}`));
    console.log(chalk.green(`JSONL saved: ${jsonlPathTest}`));
  }

  if (format === 'csv' || format === 'both') {
    await writeCsvFromJsonlChunks(csvPathTrain, headersTrain, chunkFilesTrain);
    await writeCsvFromJsonlChunks(csvPathTest, headersTest, chunkFilesTest);
    console.log(chalk.green(`CSV saved: ${csvPathTrain}`));
    console.log(chalk.green(`CSV saved: ${csvPathTest}`));
  }

  for (const filePath of [...chunkFilesTrain, ...chunkFilesTest]) {
    await fs.rm(filePath, { force: true });
  }
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(
    chalk.gray(
      `rows: ${totalRows} (chunks: ${chunkFilesTrain.length + chunkFilesTest.length}), split: time(last 30d), includeOpen: ${includeOpen}, strategy: ${strategyFilter || 'any'}`,
    ),
  );

  process.exit(0);
};

mlExport();
