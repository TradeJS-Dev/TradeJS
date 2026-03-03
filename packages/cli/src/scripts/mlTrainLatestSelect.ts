import path from 'path';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { createHash } from 'crypto';
import { execSync, spawn } from 'child_process';
import { once } from 'events';
import readline from 'readline';
import args from 'args';
import chalk from 'chalk';
import { selectStrategy } from './selectStrategy';
import {
  computeWindowBoundaries,
  isDerivedDatasetFileName,
  toIsoUtcOrNull,
} from '@utils/mlWindowing';
import { findLookaheadViolations } from '@utils/mlCausalityGuard';

const toFileToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'any';

const asBool = (value: string | undefined) =>
  ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());

const asInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asNonNegativeInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
};

const getMlContainerMemUsage = (): string => {
  try {
    const psRaw = execSync(
      'docker ps --filter status=running --filter label=com.docker.compose.service=ml --format "{{.ID}}\\t{{.Names}}\\t{{.Label \\"com.docker.compose.oneoff\\"}}"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!psRaw) return 'n/a';

    const rows = psRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id = '', name = '', oneoff = ''] = line.split('\t');
        return { id, name, oneoff };
      });
    if (!rows.length) return 'n/a';
    const chosen = rows.find((row) => row.oneoff === 'True') ?? rows[0];
    if (!chosen?.id) return 'n/a';

    const memUsage = execSync(
      `docker stats --no-stream --format "{{.MemUsage}}" ${chosen.id}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!memUsage) return 'n/a';
    return `${chosen.name}: ${memUsage}`;
  } catch {
    return 'n/a';
  }
};

type ModelType =
  | 'catboost'
  | 'random_forest'
  | 'extra_trees'
  | 'xgboost'
  | 'lightgbm';
const MODEL_TYPES: ModelType[] = [
  'catboost',
  'random_forest',
  'extra_trees',
  'xgboost',
  'lightgbm',
];
const STRATEGIES = [
  'Breakout',
  'MaStrategy',
  'TrendLine',
  'VolumeDivergence',
  'any',
] as const;
type StrategyType = (typeof STRATEGIES)[number];

args.option(['s', 'strategy'], 'Strategy name (e.g. TrendLine)');
args.option(
  ['m', 'model'],
  'Model type: catboost | random_forest | extra_trees | xgboost | lightgbm',
);
args.option(
  ['L', 'latestOnly'],
  'Use only latest dataset file (overrides ML_TRAIN_USE_LATEST_ONLY)',
  false,
);
const flags = args.parse(process.argv);

const parseStrategy = (value: unknown): StrategyType | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const byName = STRATEGIES.find(
    (name) => name.toLowerCase() === raw.toLowerCase(),
  );
  return byName ?? null;
};

const parseModelType = (value: unknown): ModelType | null => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  return MODEL_TYPES.includes(raw as ModelType) ? (raw as ModelType) : null;
};

const selectModelType = async (defaultModel: ModelType): Promise<ModelType> => {
  if (!process.stdin.isTTY) {
    return defaultModel;
  }

  console.log(chalk.cyan('Available models:'));
  MODEL_TYPES.forEach((name, index) => {
    const isDefault = name === defaultModel;
    const label = isDefault ? chalk.green(name) : name;
    const suffix = isDefault ? chalk.gray(' (default)') : '';
    console.log(`  ${chalk.yellow(String(index + 1))}) ${label}${suffix}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (text: string) =>
    new Promise<string>((resolve) => rl.question(text, resolve));
  const answer = await question(
    `Select model [${chalk.green(defaultModel)}]: `,
  );
  rl.close();

  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) {
    return defaultModel;
  }
  const asNumber = Number(trimmed);
  if (
    Number.isFinite(asNumber) &&
    asNumber >= 1 &&
    asNumber <= MODEL_TYPES.length
  ) {
    return MODEL_TYPES[asNumber - 1];
  }
  if (MODEL_TYPES.includes(trimmed as ModelType)) {
    return trimmed as ModelType;
  }
  console.warn(`Unknown model "${answer.trim()}", using ${defaultModel}.`);
  return defaultModel;
};

const listDatasetFiles = async (
  dir: string,
  strategyName: string,
): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const prefix = `ml-dataset-${toFileToken(strategyName)}-`;
  const legacyPrefix = 'ml-dataset-';
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const hasScopedFiles = fileNames.some((name) => name.startsWith(prefix));
  const acceptedPrefix = hasScopedFiles ? prefix : legacyPrefix;
  const jsonlFiles = fileNames
    .filter(
      (name) => name.startsWith(acceptedPrefix) && name.endsWith('.jsonl'),
    )
    .filter((name) => !name.includes('.train.') && !name.includes('.test.'))
    .filter((name) => !name.includes('.holdout-train.'))
    .filter((name) => !name.includes('.holdout-test.'))
    .filter((name) => !name.includes('.walk-forward.'))
    .filter((name) => !name.includes('.prod.'));

  const withMtime = await Promise.all(
    jsonlFiles.map(async (name) => {
      const stat = await fs.stat(path.join(dir, name));
      return { name, mtime: stat.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => a.mtime - b.mtime);
  return withMtime.map(({ name }) => name);
};

const concatFiles = async (files: string[], outPath: string) => {
  const out = createWriteStream(outPath, { encoding: 'utf8' });
  const done = once(out, 'finish');
  try {
    for (const file of files) {
      const reader = createReadStream(file, { encoding: 'utf8' });
      for await (const chunk of reader) {
        if (!out.write(chunk)) {
          await once(out, 'drain');
        }
      }
    }
  } finally {
    out.end();
    await done;
  }
};

const pipeNormalized = (
  stream: NodeJS.ReadableStream | null,
  write: (line: string) => void,
) => {
  if (!stream) return () => {};
  let buffer = '';
  const onData = (chunk: Buffer | string) => {
    const text = String(chunk).replace(/\r/g, '\n');
    buffer += text;
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      write(part);
    }
  };
  stream.on('data', onData);
  return () => {
    stream.off('data', onData);
    if (buffer.length) {
      write(buffer);
      buffer = '';
    }
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SPLIT_PROGRESS_EVERY = 200_000;

const parseTimestampMs = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
};

const scanMaxLabeledTimestampMs = async (
  inputPath: string,
): Promise<number> => {
  const rl = readline.createInterface({
    input: createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let maxTs = 0;
  let scanned = 0;
  const startedAt = Date.now();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    scanned++;
    if (scanned % SPLIT_PROGRESS_EVERY === 0) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      console.log(
        `[split] scan max labeled ts: lines=${scanned} elapsed=${elapsed}s`,
      );
    }
    try {
      const row = JSON.parse(trimmed) as {
        label?: unknown;
        entryTimestamp?: unknown;
      };
      if (row.label === null || row.label === undefined) continue;
      const ts = parseTimestampMs(row.entryTimestamp);
      if (ts && ts > maxTs) maxTs = ts;
    } catch {
      // ignore malformed lines
    }
  }
  rl.close();
  if (!maxTs) {
    throw new Error('No labeled rows with entryTimestamp found in dataset.');
  }
  return maxTs;
};

const scanMaxTrainTimestampMs = async (
  inputPath: string,
  holdoutCutoffMs: number,
): Promise<number> => {
  const rl = readline.createInterface({
    input: createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let maxTrainTs = 0;
  let scanned = 0;
  const startedAt = Date.now();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    scanned++;
    if (scanned % SPLIT_PROGRESS_EVERY === 0) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      console.log(
        `[split] scan max train ts: lines=${scanned} elapsed=${elapsed}s`,
      );
    }
    try {
      const row = JSON.parse(trimmed) as {
        label?: unknown;
        entryTimestamp?: unknown;
      };
      if (row.label === null || row.label === undefined) continue;
      const ts = parseTimestampMs(row.entryTimestamp);
      if (ts && ts <= holdoutCutoffMs && ts > maxTrainTs) {
        maxTrainTs = ts;
      }
    } catch {
      // ignore malformed lines
    }
  }
  rl.close();
  if (!maxTrainTs) {
    throw new Error(
      'No train rows found after holdout cutoff. Adjust test window.',
    );
  }
  return maxTrainTs;
};

type PreparedSplitFiles = {
  holdoutTrainPath: string;
  holdoutTestPath: string;
  prodPath: string;
  walkForwardFolds: Array<{
    fold: number;
    startTs: number;
    endTs: number;
    trainPath: string;
    testPath: string;
    trainRows: number;
    testRows: number;
  }>;
  cleanup: string[];
  reused: boolean;
  key: string;
  exportHash: string;
  counts: {
    holdoutTrainRows: number;
    holdoutTestRows: number;
    walkForwardSourceRows: number;
    prodRows: number;
  };
};

const hashFileNameSha1 = (filePath: string): string =>
  createHash('sha1').update(path.basename(filePath)).digest('hex');

const prepareTrainWindowFiles = async ({
  inputPath,
  testDays,
  trainRecentDays,
  walkForwardFolds,
  enforceCausalityGuard,
}: {
  inputPath: string;
  testDays: number;
  trainRecentDays: number;
  walkForwardFolds: number;
  enforceCausalityGuard: boolean;
}): Promise<PreparedSplitFiles> => {
  const inputBaseName = path.basename(inputPath);
  if (isDerivedDatasetFileName(inputBaseName)) {
    throw new Error(
      `Refusing to split derived dataset file: ${inputBaseName}. Expected base export file.`,
    );
  }

  const exportHash = hashFileNameSha1(inputPath);
  const keyPayload = JSON.stringify({
    exportHash,
    testDays,
    trainRecentDays,
    walkForwardFolds,
    causalityGuardVersion: enforceCausalityGuard ? 1 : 0,
  });
  const key = createHash('sha1').update(keyPayload).digest('hex').slice(0, 12);
  const dir = path.dirname(inputPath);
  const parsed = path.parse(inputPath);
  const holdoutTrainPath = path.join(
    dir,
    `${parsed.name}.holdout-train.${key}.jsonl`,
  );
  const holdoutTestPath = path.join(
    dir,
    `${parsed.name}.holdout-test.${key}.jsonl`,
  );
  const prodPath = path.join(dir, `${parsed.name}.prod.${key}.jsonl`);
  const walkForwardFoldDefs = Array.from(
    { length: Math.max(walkForwardFolds, 0) },
    (_, idx) => {
      const fold = idx + 1;
      const foldToken = `fold-${fold}`;
      return {
        fold,
        trainPath: path.join(
          dir,
          `${parsed.name}.walk-forward-${foldToken}.train.${key}.jsonl`,
        ),
        testPath: path.join(
          dir,
          `${parsed.name}.walk-forward-${foldToken}.test.${key}.jsonl`,
        ),
      };
    },
  );
  const metaPath = path.join(dir, `${parsed.name}.windows.${key}.meta.json`);

  try {
    const [metaRaw] = await Promise.all([
      fs.readFile(metaPath, 'utf8'),
      fs.access(holdoutTrainPath),
      fs.access(holdoutTestPath),
      fs.access(prodPath),
      ...walkForwardFoldDefs.flatMap((entry) => [
        fs.access(entry.trainPath),
        fs.access(entry.testPath),
      ]),
    ]);
    const meta = JSON.parse(metaRaw) as {
      exportHash?: string;
      counts?: {
        holdoutTrainRows?: number;
        holdoutTestRows?: number;
        walkForwardSourceRows?: number;
        prodRows?: number;
      };
      files?: {
        holdout?: {
          holdoutTrainRows?: number;
          holdoutTestRows?: number;
          holdoutTrain?: string;
          holdoutTest?: string;
          holdoutCutoffMs?: number;
          holdoutTrainStartMs?: number;
          holdoutTrainMinTs?: number;
          holdoutTrainMaxTs?: number;
          holdoutTestMinTs?: number;
          holdoutTestMaxTs?: number;
        };
        prod?: {
          prodRows?: number;
          prodStartMs?: number;
          prodMinTs?: number;
          prodMaxTs?: number;
          prod?: string;
        };
        walkForwardFolds?: Array<{
          fold?: number;
          walkForwardSourceRows?: number;
          startTs?: number;
          endTs?: number;
          trainRows?: number;
          testRows?: number;
          train?: string;
          test?: string;
        }>;
      };
      foldCounts?: Array<{
        fold?: number;
        trainRows?: number;
        testRows?: number;
      }>;
    };
    if (meta.exportHash === exportHash) {
      const foldMetaByFold = new Map<
        number,
        {
          startTs: number;
          endTs: number;
          trainRows: number;
          testRows: number;
        }
      >();
      const fileFolds = Array.isArray(meta.files?.walkForwardFolds)
        ? meta.files?.walkForwardFolds ?? []
        : [];
      const hasExtendedFoldTiming =
        fileFolds.length === 0 || 'trainMinTs' in (fileFolds[0] as object);
      if (!hasExtendedFoldTiming) {
        throw new Error('Legacy meta format cache miss');
      }
      if (!meta.files?.prod?.prod) {
        throw new Error('Legacy meta format cache miss (prod block missing)');
      }
      for (const foldFile of fileFolds) {
        const fold = Number(foldFile.fold);
        if (!Number.isFinite(fold) || fold <= 0) continue;
        foldMetaByFold.set(fold, {
          startTs: Number(foldFile.startTs ?? 0),
          endTs: Number(foldFile.endTs ?? 0),
          trainRows: Number(foldFile.trainRows ?? 0),
          testRows: Number(foldFile.testRows ?? 0),
        });
      }
      if (Array.isArray(meta.foldCounts)) {
        for (const row of meta.foldCounts) {
          const fold = Number(row.fold);
          if (!Number.isFinite(fold) || fold <= 0) continue;
          const prev = foldMetaByFold.get(fold) ?? {
            startTs: 0,
            endTs: 0,
            trainRows: 0,
            testRows: 0,
          };
          foldMetaByFold.set(fold, {
            ...prev,
            trainRows: Number(row.trainRows ?? 0),
            testRows: Number(row.testRows ?? 0),
          });
        }
      }
      return {
        holdoutTrainPath,
        holdoutTestPath,
        prodPath,
        walkForwardFolds: walkForwardFoldDefs.map((entry) => {
          const metaRow = foldMetaByFold.get(entry.fold);
          return {
            fold: entry.fold,
            startTs: Number(metaRow?.startTs ?? 0),
            endTs: Number(metaRow?.endTs ?? 0),
            trainPath: entry.trainPath,
            testPath: entry.testPath,
            trainRows: Number(metaRow?.trainRows ?? 0),
            testRows: Number(metaRow?.testRows ?? 0),
          };
        }),
        cleanup: [],
        reused: true,
        key,
        exportHash,
        counts: {
          holdoutTrainRows: Number(
            meta.files?.holdout?.holdoutTrainRows ??
              meta.counts?.holdoutTrainRows ??
              0,
          ),
          holdoutTestRows: Number(
            meta.files?.holdout?.holdoutTestRows ??
              meta.counts?.holdoutTestRows ??
              0,
          ),
          walkForwardSourceRows: Number(
            meta.files?.walkForwardFolds?.[0]?.walkForwardSourceRows ??
              meta.counts?.walkForwardSourceRows ??
              0,
          ),
          prodRows: Number(
            meta.files?.prod?.prodRows ?? meta.counts?.prodRows ?? 0,
          ),
        },
      };
    }
  } catch {
    // cache miss
  }

  console.log('[split] phase 1/3: scanning max labeled timestamp...');
  const maxLabeledTs = await scanMaxLabeledTimestampMs(inputPath);
  const holdoutCutoffMs = maxLabeledTs - testDays * DAY_MS;
  console.log('[split] phase 2/3: scanning max train timestamp...');
  const maxTrainTs = await scanMaxTrainTimestampMs(inputPath, holdoutCutoffMs);
  const {
    holdoutCutoffMs: derivedHoldoutCutoffMs,
    holdoutTrainStartMs,
    wfStartMs,
    prodStartMs,
    folds,
  } = computeWindowBoundaries({
    maxLabeledTs,
    maxTrainTs,
    testDays,
    trainRecentDays,
    walkForwardFolds,
  });
  if (derivedHoldoutCutoffMs !== holdoutCutoffMs) {
    throw new Error('Internal split boundary mismatch for holdout cutoff.');
  }
  const walkForwardFoldsWithWindows = walkForwardFoldDefs.map((entry) => {
    const foldWindow = folds.find((row) => row.fold === entry.fold);
    return {
      ...entry,
      startTs: Number(foldWindow?.startTs ?? 0),
      endTs: Number(foldWindow?.endTs ?? 0),
      trainRows: 0,
      testRows: 0,
    };
  });

  console.log('[split] phase 3/3: writing holdout/walk-forward files...');
  const holdoutTrainWriter = createWriteStream(holdoutTrainPath, {
    encoding: 'utf8',
  });
  const holdoutTestWriter = createWriteStream(holdoutTestPath, {
    encoding: 'utf8',
  });
  const prodWriter = createWriteStream(prodPath, {
    encoding: 'utf8',
  });
  const walkForwardWriters = walkForwardFoldsWithWindows.map((entry) => ({
    ...entry,
    trainWriter: createWriteStream(entry.trainPath, {
      encoding: 'utf8',
    }),
    testWriter: createWriteStream(entry.testPath, {
      encoding: 'utf8',
    }),
    trainMinTs: Number.POSITIVE_INFINITY,
    trainMaxTs: 0,
    testMinTs: Number.POSITIVE_INFINITY,
    testMaxTs: 0,
  }));

  let holdoutTrainRows = 0;
  let holdoutTestRows = 0;
  let walkForwardSourceRows = 0;
  let holdoutTrainMinTs = Number.POSITIVE_INFINITY;
  let holdoutTrainMaxTs = 0;
  let holdoutTestMinTs = Number.POSITIVE_INFINITY;
  let holdoutTestMaxTs = 0;
  let holdoutTrainOutOfRangeRows = 0;
  let prodRows = 0;
  let prodMinTs = Number.POSITIVE_INFINITY;
  let prodMaxTs = 0;
  let scanned = 0;
  const writeStartedAt = Date.now();

  const rl = readline.createInterface({
    input: createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    scanned++;
    if (scanned % SPLIT_PROGRESS_EVERY === 0) {
      const elapsed = Math.floor((Date.now() - writeStartedAt) / 1000);
      console.log(
        `[split] writing: lines=${scanned} train=${holdoutTrainRows} test=${holdoutTestRows} wf_source=${walkForwardSourceRows} elapsed=${elapsed}s`,
      );
    }
    let parsedRow: { label?: unknown; entryTimestamp?: unknown } | null = null;
    try {
      parsedRow = JSON.parse(trimmed) as {
        label?: unknown;
        entryTimestamp?: unknown;
      };
    } catch {
      continue;
    }
    if (!parsedRow || parsedRow.label === null || parsedRow.label === undefined)
      continue;
    const ts = parseTimestampMs(parsedRow.entryTimestamp);
    if (!ts) continue;
    if (enforceCausalityGuard) {
      const violations = findLookaheadViolations(
        parsedRow as Record<string, unknown>,
      );
      if (violations.length) {
        const sample = violations
          .slice(0, 3)
          .map(
            (row) =>
              `${row.key}: ${row.featureTimestampMs} > ${row.entryTimestampMs}`,
          )
          .join(', ');
        throw new Error(
          `Lookahead validation failed: feature timestamp is newer than entryTimestamp. ${sample}`,
        );
      }
    }

    if (ts > holdoutCutoffMs) {
      if (!holdoutTestWriter.write(`${trimmed}\n`)) {
        await once(holdoutTestWriter, 'drain');
      }
      holdoutTestRows++;
      if (ts < holdoutTestMinTs) holdoutTestMinTs = ts;
      if (ts > holdoutTestMaxTs) holdoutTestMaxTs = ts;
    } else {
      if (ts >= holdoutTrainStartMs) {
        if (!holdoutTrainWriter.write(`${trimmed}\n`)) {
          await once(holdoutTrainWriter, 'drain');
        }
        holdoutTrainRows++;
        if (ts < holdoutTrainStartMs || ts > holdoutCutoffMs) {
          holdoutTrainOutOfRangeRows++;
        }
        if (ts < holdoutTrainMinTs) holdoutTrainMinTs = ts;
        if (ts > holdoutTrainMaxTs) holdoutTrainMaxTs = ts;
      }
      if (ts >= wfStartMs && ts <= maxTrainTs) {
        walkForwardSourceRows++;
        for (const foldWriter of walkForwardWriters) {
          if (ts > foldWriter.startTs && ts <= foldWriter.endTs) {
            if (!foldWriter.testWriter.write(`${trimmed}\n`)) {
              await once(foldWriter.testWriter, 'drain');
            }
            foldWriter.testRows++;
            if (ts < foldWriter.testMinTs) foldWriter.testMinTs = ts;
            if (ts > foldWriter.testMaxTs) foldWriter.testMaxTs = ts;
          } else if (ts <= foldWriter.startTs) {
            if (!foldWriter.trainWriter.write(`${trimmed}\n`)) {
              await once(foldWriter.trainWriter, 'drain');
            }
            foldWriter.trainRows++;
            if (ts < foldWriter.trainMinTs) foldWriter.trainMinTs = ts;
            if (ts > foldWriter.trainMaxTs) foldWriter.trainMaxTs = ts;
          }
        }
      }
    }
    if (ts >= prodStartMs) {
      if (!prodWriter.write(`${trimmed}\n`)) {
        await once(prodWriter, 'drain');
      }
      prodRows++;
      if (ts < prodMinTs) prodMinTs = ts;
      if (ts > prodMaxTs) prodMaxTs = ts;
    }
  }

  rl.close();
  holdoutTrainWriter.end();
  holdoutTestWriter.end();
  prodWriter.end();
  for (const foldWriter of walkForwardWriters) {
    foldWriter.trainWriter.end();
    foldWriter.testWriter.end();
  }
  const finishPromises = [
    once(holdoutTrainWriter, 'finish'),
    once(holdoutTestWriter, 'finish'),
    once(prodWriter, 'finish'),
    ...walkForwardWriters.flatMap((foldWriter) => [
      once(foldWriter.trainWriter, 'finish'),
      once(foldWriter.testWriter, 'finish'),
    ]),
  ];
  await Promise.all(finishPromises);

  if (!holdoutTrainRows || !holdoutTestRows) {
    throw new Error(
      `Window split produced empty holdout set (train=${holdoutTrainRows}, test=${holdoutTestRows}).`,
    );
  }
  if (holdoutTrainOutOfRangeRows > 0) {
    throw new Error(
      `Holdout split validation failed (train_out_of_range=${holdoutTrainOutOfRangeRows}).`,
    );
  }
  if (holdoutTrainMaxTs > holdoutCutoffMs) {
    throw new Error(
      `Holdout train contains rows newer than cutoff (${holdoutTrainMaxTs} > ${holdoutCutoffMs}).`,
    );
  }
  if (holdoutTestMinTs <= holdoutCutoffMs) {
    throw new Error(
      `Holdout test contains rows older/equal cutoff (${holdoutTestMinTs} <= ${holdoutCutoffMs}).`,
    );
  }
  if (walkForwardFolds > 0 && !walkForwardSourceRows) {
    throw new Error('Window split produced empty walk-forward source dataset.');
  }
  if (!prodRows) {
    throw new Error('Window split produced empty prod dataset.');
  }
  for (const foldWriter of walkForwardWriters) {
    if (!foldWriter.trainRows || !foldWriter.testRows) {
      throw new Error(
        `Walk-forward fold ${foldWriter.fold} is empty (train=${foldWriter.trainRows}, test=${foldWriter.testRows}).`,
      );
    }
  }

  const meta = {
    exportFile: path.basename(inputPath),
    exportHash,
    params: {
      testDays,
      trainRecentDays,
      walkForwardFolds,
      causalityGuard: enforceCausalityGuard,
    },
    files: {
      holdout: {
        holdoutTrainRows,
        holdoutTestRows,
        holdoutCutoffMs,
        holdoutCutoffDt: toIsoUtcOrNull(holdoutCutoffMs),
        holdoutTrainStartMs,
        holdoutTrainStartDt: toIsoUtcOrNull(holdoutTrainStartMs),
        holdoutTrainMinTs: holdoutTrainRows > 0 ? holdoutTrainMinTs : null,
        holdoutTrainMinDt: toIsoUtcOrNull(
          holdoutTrainRows > 0 ? holdoutTrainMinTs : null,
        ),
        holdoutTrainMaxTs: holdoutTrainRows > 0 ? holdoutTrainMaxTs : null,
        holdoutTrainMaxDt: toIsoUtcOrNull(
          holdoutTrainRows > 0 ? holdoutTrainMaxTs : null,
        ),
        holdoutTestMinTs: holdoutTestRows > 0 ? holdoutTestMinTs : null,
        holdoutTestMinDt: toIsoUtcOrNull(
          holdoutTestRows > 0 ? holdoutTestMinTs : null,
        ),
        holdoutTestMaxTs: holdoutTestRows > 0 ? holdoutTestMaxTs : null,
        holdoutTestMaxDt: toIsoUtcOrNull(
          holdoutTestRows > 0 ? holdoutTestMaxTs : null,
        ),
        holdoutTrain: path.basename(holdoutTrainPath),
        holdoutTest: path.basename(holdoutTestPath),
      },
      prod: {
        prodRows,
        prodStartMs: Number.isFinite(prodStartMs) ? prodStartMs : null,
        prodStartDt: toIsoUtcOrNull(
          Number.isFinite(prodStartMs) ? prodStartMs : null,
        ),
        prodMinTs: prodRows > 0 ? prodMinTs : null,
        prodMinDt: toIsoUtcOrNull(prodRows > 0 ? prodMinTs : null),
        prodMaxTs: prodRows > 0 ? prodMaxTs : null,
        prodMaxDt: toIsoUtcOrNull(prodRows > 0 ? prodMaxTs : null),
        prod: path.basename(prodPath),
      },
      walkForwardFolds: walkForwardWriters.map((entry) => ({
        fold: entry.fold,
        walkForwardSourceRows,
        startTs: entry.startTs,
        startDt: toIsoUtcOrNull(entry.startTs),
        endTs: entry.endTs,
        endDt: toIsoUtcOrNull(entry.endTs),
        trainStartMs: Number.isFinite(wfStartMs) ? wfStartMs : null,
        trainStartDt: toIsoUtcOrNull(
          Number.isFinite(wfStartMs) ? wfStartMs : null,
        ),
        trainMinTs: entry.trainRows > 0 ? entry.trainMinTs : null,
        trainMinDt: toIsoUtcOrNull(
          entry.trainRows > 0 ? entry.trainMinTs : null,
        ),
        trainMaxTs: entry.trainRows > 0 ? entry.trainMaxTs : null,
        trainMaxDt: toIsoUtcOrNull(
          entry.trainRows > 0 ? entry.trainMaxTs : null,
        ),
        testMinTs: entry.testRows > 0 ? entry.testMinTs : null,
        testMinDt: toIsoUtcOrNull(entry.testRows > 0 ? entry.testMinTs : null),
        testMaxTs: entry.testRows > 0 ? entry.testMaxTs : null,
        testMaxDt: toIsoUtcOrNull(entry.testRows > 0 ? entry.testMaxTs : null),
        trainRows: entry.trainRows,
        testRows: entry.testRows,
        train: path.basename(entry.trainPath),
        test: path.basename(entry.testPath),
      })),
    },
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  return {
    holdoutTrainPath,
    holdoutTestPath,
    prodPath,
    walkForwardFolds: walkForwardWriters.map((entry) => ({
      fold: entry.fold,
      startTs: entry.startTs,
      endTs: entry.endTs,
      trainPath: entry.trainPath,
      testPath: entry.testPath,
      trainRows: entry.trainRows,
      testRows: entry.testRows,
    })),
    cleanup: [],
    reused: false,
    key,
    exportHash,
    counts: {
      holdoutTrainRows,
      holdoutTestRows,
      walkForwardSourceRows,
      prodRows,
    },
  };
};

const run = async () => {
  const selectedFromCli = parseStrategy(flags.strategy);
  const selected = selectedFromCli ?? (await selectStrategy());
  const envModelType = (process.env.ML_MODEL_TYPE ?? 'random_forest')
    .trim()
    .toLowerCase();
  const defaultModelType: ModelType = MODEL_TYPES.includes(
    envModelType as ModelType,
  )
    ? (envModelType as ModelType)
    : 'random_forest';
  const modelFromCli = parseModelType(flags.model);
  const modelType = modelFromCli ?? (await selectModelType(defaultModelType));
  const useLatestOnly =
    Boolean(flags.latestOnly) || asBool(process.env.ML_TRAIN_USE_LATEST_ONLY);
  const exportDir = path.join(process.cwd(), 'data', 'ml', 'export');
  const modelDirRoot = path.join(process.cwd(), 'data', 'ml');
  const datasetFiles = await listDatasetFiles(exportDir, selected);

  let inputPath: string;
  let cleanupFiles: string[] = [];

  if (datasetFiles.length && useLatestOnly) {
    const latest = datasetFiles[datasetFiles.length - 1];
    inputPath = path.join(exportDir, latest);
    console.log(`Using latest JSONL dataset: ${path.basename(inputPath)}`);
  } else if (datasetFiles.length) {
    const files = datasetFiles.map((name) => path.join(exportDir, name));
    const mergedPrefix = `ml-dataset-merged-${Date.now()}`;
    inputPath = path.join(exportDir, `${mergedPrefix}.jsonl`);
    await concatFiles(files, inputPath);
    cleanupFiles = [inputPath];
    console.log(`Merged datasets: ${datasetFiles.length} exports`);
  } else {
    console.error('No ml-dataset-*.jsonl found in data/ml/export');
    process.exit(1);
  }

  try {
    const inputStat = await fs.stat(inputPath);
    const totalInputBytes = inputStat.size;
    const autoIncrementalThresholdGb = asInt(
      process.env.ML_TRAIN_INCREMENTAL_THRESHOLD_GB,
      2,
    );
    const autoIncrementalThresholdBytes =
      autoIncrementalThresholdGb * 1024 * 1024 * 1024;
    const forceIncremental = asBool(process.env.ML_TRAIN_INCREMENTAL);
    const disableIncremental = asBool(process.env.ML_TRAIN_NO_INCREMENTAL);
    const useIncremental =
      !disableIncremental &&
      (forceIncremental || totalInputBytes >= autoIncrementalThresholdBytes);
    const chunkSize = asInt(process.env.ML_TRAIN_CHUNK_SIZE, 10_000);
    const incrementalIterations = asInt(
      process.env.ML_TRAIN_INCREMENTAL_ITERATIONS,
      30,
    );
    const trainRecentDays = asNonNegativeInt(
      process.env.ML_TRAIN_RECENT_DAYS,
      60,
    );
    const enableEnsemble = asBool(process.env.ML_TRAIN_ENSEMBLE);
    const forceEnsemble = asBool(process.env.ML_TRAIN_FORCE_ENSEMBLE);
    const disableEnsemble = asBool(process.env.ML_TRAIN_NO_ENSEMBLE);
    const useEnsemble = (forceEnsemble || enableEnsemble) && !disableEnsemble;
    const walkForwardFolds = asNonNegativeInt(
      process.env.ML_TRAIN_WALK_FORWARD_FOLDS,
      2,
    );
    const featureProfile = (process.env.ML_TRAIN_FEATURE_PROFILE ?? 'all')
      .trim()
      .toLowerCase();
    const reportDir = (
      process.env.ML_TRAIN_REPORT_DIR ?? 'data/ml/models'
    ).trim();
    const testDays = asInt(process.env.ML_TRAIN_TEST_DAYS, 30);

    if (useIncremental && modelType === 'catboost') {
      console.log(
        `Using incremental mode (total input ${(totalInputBytes / 1024 / 1024 / 1024).toFixed(2)} GiB, chunk size ${chunkSize}, iters/chunk ${incrementalIterations})`,
      );
    }
    if (!useEnsemble) {
      console.log('Using single-model mode (outer ensemble disabled).');
    }
    console.log(`Train recent days: ${trainRecentDays}`);
    console.log(`Walk-forward folds: ${walkForwardFolds}`);
    console.log(`Feature profile: ${featureProfile}`);
    const splitFiles = await prepareTrainWindowFiles({
      inputPath,
      testDays,
      trainRecentDays,
      walkForwardFolds,
      enforceCausalityGuard: !asBool(
        process.env.ML_TRAIN_DISABLE_CAUSALITY_GUARD,
      ),
    });
    cleanupFiles.push(...splitFiles.cleanup);
    const splitMode = splitFiles.reused ? 'Reusing' : 'Prepared';
    console.log(
      `${splitMode} split key=${splitFiles.key} export_hash=${splitFiles.exportHash.slice(0, 12)}`,
    );
    console.log(
      `${splitMode} holdout files: train=${path.basename(splitFiles.holdoutTrainPath)} (${splitFiles.counts.holdoutTrainRows} rows), test=${path.basename(splitFiles.holdoutTestPath)} (${splitFiles.counts.holdoutTestRows} rows)`,
    );
    console.log(
      `${splitMode} prod file: ${path.basename(splitFiles.prodPath)} (${splitFiles.counts.prodRows} rows)`,
    );
    if (splitFiles.walkForwardFolds.length) {
      console.log(
        `${splitMode} walk-forward source rows: ${splitFiles.counts.walkForwardSourceRows}`,
      );
      for (const foldEntry of splitFiles.walkForwardFolds) {
        console.log(
          `${splitMode} walk-forward fold ${foldEntry.fold}: train=${path.basename(foldEntry.trainPath)} (${foldEntry.trainRows} rows), test=${path.basename(foldEntry.testPath)} (${foldEntry.testRows} rows)`,
        );
      }
    } else {
      console.log(`${splitMode} walk-forward folds disabled.`);
    }

    const trainArgs = [
      'compose',
      '-f',
      'docker-compose.ml.yml',
      'run',
      '--rm',
      'ml',
      'python',
      '/app/ml/train.py',
      '--input',
      `/app/data/ml/export/${path.basename(splitFiles.holdoutTrainPath)}`,
      '--test-input',
      `/app/data/ml/export/${path.basename(splitFiles.holdoutTestPath)}`,
      '--prod-input',
      `/app/data/ml/export/${path.basename(splitFiles.prodPath)}`,
      '--strategy',
      selected,
      '--model-type',
      modelType,
      '--feature-profile',
      featureProfile,
      '--train-recent-days',
      String(trainRecentDays),
      '--walk-forward-folds',
      String(walkForwardFolds),
      '--test-days',
      String(testDays),
      '--report-dir',
      reportDir,
      ...(useEnsemble ? ['--ensemble'] : []),
      ...splitFiles.walkForwardFolds.flatMap((foldEntry) => [
        '--walk-forward-fold-train-input',
        `/app/data/ml/export/${path.basename(foldEntry.trainPath)}`,
        '--walk-forward-fold-test-input',
        `/app/data/ml/export/${path.basename(foldEntry.testPath)}`,
      ]),
    ];

    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let sawDockerOutput = false;
    const heartbeatSec = asInt(process.env.ML_TRAIN_HEARTBEAT_SEC, 10);
    const trainDebug = asBool(process.env.ML_TRAIN_DEBUG);
    const noOutputTimeoutSec = asInt(
      process.env.ML_TRAIN_DOCKER_NO_OUTPUT_TIMEOUT_SEC,
      90,
    );
    console.log(`Starting train command: docker ${trainArgs.join(' ')}`);

    const child = spawn('docker', trainArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        COMPOSE_IGNORE_ORPHANS: '1',
      },
    });
    const stopStdoutPipe = pipeNormalized(child.stdout, (line) => {
      sawDockerOutput = true;
      lastOutputAt = Date.now();
      process.stdout.write(`${line}\n`);
    });
    const stopStderrPipe = pipeNormalized(child.stderr, (line) => {
      sawDockerOutput = true;
      lastOutputAt = Date.now();
      process.stderr.write(`${line}\n`);
    });

    const heartbeat = setInterval(
      () => {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        const silenceSec = Math.floor((Date.now() - lastOutputAt) / 1000);
        if (trainDebug) {
          const nodeMem = formatBytes(process.memoryUsage().rss);
          const mlMem = getMlContainerMemUsage();
          process.stdout.write(
            `\n[train] still running... elapsed ${elapsedSec}s, silence=${silenceSec}s (model=${modelType}, strategy=${selected}, node_rss=${nodeMem}, ml_mem=${mlMem})\n`,
          );
        }
        if (
          noOutputTimeoutSec > 0 &&
          !sawDockerOutput &&
          silenceSec >= noOutputTimeoutSec
        ) {
          process.stderr.write(
            `[train] docker produced no output for ${silenceSec}s; terminating process. Check Docker Desktop/daemon health.\n`,
          );
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill('SIGKILL');
            }
          }, 5_000).unref();
        }
      },
      Math.max(heartbeatSec, 1) * 1000,
    );

    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      error?: Error;
    }>((resolve) => {
      child.on('error', (error) => resolve({ code: 1, signal: null, error }));
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    clearInterval(heartbeat);
    stopStdoutPipe();
    stopStderrPipe();

    const code = result.code ?? 1;
    let finalCode = code;
    if (result.error) {
      console.error(`Failed to start docker process: ${result.error.message}`);
    }
    if (result.signal === 'SIGKILL' || code === 137) {
      console.error(
        'Training was killed (exit 137). Most likely out-of-memory. Try ML_TRAIN_USE_LATEST_ONLY=1, random_forest/extra_trees, or a smaller export.',
      );
    }
    if (code === 0) {
      const modelDir = path.join(modelDirRoot, 'models');
      let savedModels: string[] = [];
      try {
        const entries = await fs.readdir(modelDir, { withFileTypes: true });
        savedModels = entries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .filter(
            (name) =>
              name === `${selected}.joblib` ||
              /^.+\.model\d+\.joblib$/.test(name),
          )
          .filter((name) => name.startsWith(`${selected}.`))
          .sort();
      } catch {
        savedModels = [];
      }
      if (!savedModels.length) {
        console.error(
          `Training finished but no model artifacts found in ${modelDir} for strategy "${selected}".`,
        );
        finalCode = 1;
      } else {
        console.log(`Saved model artifacts (${savedModels.length}):`);
        for (const name of savedModels) {
          console.log(`  - data/ml/models/${name}`);
        }
      }
    }
    process.exitCode = finalCode;
  } finally {
    for (const file of cleanupFiles) {
      await fs.rm(file, { force: true });
    }
  }

  process.exit(process.exitCode ?? 1);
};

run().catch((err) => {
  console.error('Failed to train:', err);
  process.exit(1);
});
