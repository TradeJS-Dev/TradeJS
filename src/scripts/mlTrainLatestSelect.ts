import path from 'path';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { spawnSync } from 'child_process';
import { once } from 'events';
import readline from 'readline';
import args from 'args';
import chalk from 'chalk';
import { selectStrategy } from './selectStrategy';

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

type ModelType = 'catboost' | 'random_forest';
const MODEL_TYPES: ModelType[] = ['catboost', 'random_forest'];
const STRATEGIES = ['Breakout', 'TrendLine', 'any'] as const;
type StrategyType = (typeof STRATEGIES)[number];

args.option(['s', 'strategy'], 'Strategy name (e.g. TrendLine)');
args.option(['m', 'model'], 'Model type: catboost | random_forest');
args.option(
  ['L', 'latestOnly'],
  'Use only latest dataset pair (overrides ML_TRAIN_USE_LATEST_ONLY)',
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
  const raw = String(value ?? '').trim().toLowerCase();
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

const listDatasetBases = async (
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
  const trainNames = new Set(
    fileNames.filter(
      (name) =>
        name.startsWith(acceptedPrefix) && name.endsWith('.train.jsonl'),
    ),
  );
  const testNames = new Set(
    fileNames.filter(
      (name) => name.startsWith(acceptedPrefix) && name.endsWith('.test.jsonl'),
    ),
  );

  const bases = [...trainNames]
    .map((name) => name.replace('.train.jsonl', ''))
    .filter((base) => testNames.has(`${base}.test.jsonl`));

  const withMtime = await Promise.all(
    bases.map(async (base) => {
      const trainStat = await fs.stat(path.join(dir, `${base}.train.jsonl`));
      return { base, mtime: trainStat.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => a.mtime - b.mtime);
  return withMtime.map(({ base }) => base);
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

const listLatestTrainCsv = async (
  dir: string,
  strategyName: string,
): Promise<string | null> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const prefix = `ml-dataset-${toFileToken(strategyName)}-`;
  const legacyPrefix = 'ml-dataset-';
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const hasScopedFiles = fileNames.some((name) => name.startsWith(prefix));
  const acceptedPrefix = hasScopedFiles ? prefix : legacyPrefix;
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) => name.startsWith(acceptedPrefix) && name.endsWith('.train.csv'),
    );

  if (!candidates.length) return null;

  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      const stat = await fs.stat(path.join(dir, name));
      return { name, mtime: stat.mtimeMs };
    }),
  );

  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0].name;
};

const run = async () => {
  const selectedFromCli = parseStrategy(flags.strategy);
  const selected =
    selectedFromCli ??
    (await selectStrategy());
  const envModelType = (process.env.ML_MODEL_TYPE ?? 'catboost')
    .trim()
    .toLowerCase();
  const defaultModelType: ModelType = MODEL_TYPES.includes(
    envModelType as ModelType,
  )
    ? (envModelType as ModelType)
    : 'catboost';
  const modelFromCli = parseModelType(flags.model);
  const modelType =
    modelFromCli ?? (await selectModelType(defaultModelType));
  const useLatestOnly =
    Boolean(flags.latestOnly) || asBool(process.env.ML_TRAIN_USE_LATEST_ONLY);
  const exportDir = path.join(process.cwd(), 'data', 'ml', 'export');
  const modelDirRoot = path.join(process.cwd(), 'data', 'ml');
  const bases = await listDatasetBases(exportDir, selected);

  let trainInputPath: string;
  let testInputPath: string;
  let cleanupFiles: string[] = [];

  if (bases.length && useLatestOnly) {
    const latestBase = bases[bases.length - 1];
    trainInputPath = path.join(exportDir, `${latestBase}.train.jsonl`);
    testInputPath = path.join(exportDir, `${latestBase}.test.jsonl`);
    console.log(
      `Using latest JSONL dataset pair: ${path.basename(trainInputPath)}`,
    );
  } else if (bases.length) {
    const trainFiles = bases.map((base) =>
      path.join(exportDir, `${base}.train.jsonl`),
    );
    const testFiles = bases.map((base) =>
      path.join(exportDir, `${base}.test.jsonl`),
    );
    const mergedPrefix = `ml-dataset-merged-${Date.now()}`;
    trainInputPath = path.join(exportDir, `${mergedPrefix}.train.jsonl`);
    testInputPath = path.join(exportDir, `${mergedPrefix}.test.jsonl`);
    await concatFiles(trainFiles, trainInputPath);
    await concatFiles(testFiles, testInputPath);
    cleanupFiles = [trainInputPath, testInputPath];
    console.log(`Merged datasets: ${bases.length} exports`);
  } else {
    const trainFile = await listLatestTrainCsv(exportDir, selected);
    if (!trainFile) {
      console.error(
        'No ml-dataset-*.train.jsonl or .train.csv found in data/ml/export',
      );
      process.exit(1);
    }
    const testFile = trainFile.replace('.train.csv', '.test.csv');
    const testPath = path.join(exportDir, testFile);
    try {
      await fs.access(testPath);
    } catch {
      console.error('No paired test dataset found in data/ml/export');
      process.exit(1);
    }
    trainInputPath = path.join(exportDir, trainFile);
    testInputPath = testPath;
    console.log(`Using latest CSV dataset pair: ${trainFile}`);
  }

  try {
    const trainStat = await fs.stat(trainInputPath);
    const testStat = await fs.stat(testInputPath);
    const totalInputBytes = trainStat.size + testStat.size;
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
    const chunkSize = asInt(process.env.ML_TRAIN_CHUNK_SIZE, 20_000);
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
    const useEnsemble =
      (forceEnsemble || enableEnsemble) && !disableEnsemble;

    if (useIncremental && modelType === 'catboost') {
      console.log(
        `Using incremental mode (total input ${(totalInputBytes / 1024 / 1024 / 1024).toFixed(2)} GiB, chunk size ${chunkSize}, iters/chunk ${incrementalIterations})`,
      );
    }
    if (!useEnsemble) {
      console.log('Using single-model mode (outer ensemble disabled).');
    }
    console.log(`Train recent days: ${trainRecentDays}`);

    const result = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        'docker-compose.ml.yml',
        'run',
        '--rm',
        'ml',
        'python',
        '/app/ml/train.py',
        '--input',
        `/app/data/ml/export/${path.basename(trainInputPath)}`,
        '--test-input',
        `/app/data/ml/export/${path.basename(testInputPath)}`,
        '--strategy',
        selected,
        '--model-type',
        modelType,
        '--train-recent-days',
        String(trainRecentDays),
        ...(useEnsemble ? ['--ensemble'] : []),
        ...(useIncremental && modelType === 'catboost'
          ? [
              '--incremental',
              '--chunk-size',
              String(chunkSize),
              '--incremental-iterations',
              String(incrementalIterations),
            ]
          : []),
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      },
    );
    const code = result.status ?? 1;
    let finalCode = code;
    if (result.signal === 'SIGKILL' || code === 137) {
      console.error(
        'Training was killed (exit 137). Most likely out-of-memory. Try ML_TRAIN_USE_LATEST_ONLY=1, random_forest, or a smaller export.',
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
