/// <reference types="node" />

import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { Dirent } from 'fs';
import { spawnSync } from 'child_process';

type Mode = 'head' | 'tail' | 'sample';
type InspectTool = 'quick' | 'ydata';

type NumericStats = {
  field: string;
  count: number;
  validCount: number;
  missingRate: number;
  nonFiniteRate: number;
  zeroRate: number;
  uniqueCount: number;
  min: number;
  max: number;
  mean: number;
  std: number;
  median: number;
  q1: number;
  q3: number;
  p95: number;
  p99: number;
  outlierRate: number;
  scaleRatio: number;
  issues: string[];
  score: number;
};

args.example(
  'yarn ml-inspect --rows 10000 --mode sample',
  'Inspect the latest ML dataset chunk and highlight problematic features',
);

args.option(['d', 'dir'], 'Dataset directory', 'data/ml/export');
args.option(['r', 'rows'], 'Rows to inspect', 10000);
args.option(['m', 'mode'], 'head | tail | sample', 'sample');
args.option(['S', 'strategy'], 'Strategy token in dataset filename', '');
args.option(
  ['f', 'file'],
  'Explicit dataset file path (overrides auto-select)',
);
args.option(['L', 'limitIssues'], 'How many fields to print in report', 25);
args.option(['M', 'minFieldValues'], 'Min valid values per numeric field', 50);
args.option(['T', 'tool'], 'quick | ydata', '');

const flags = args.parse(process.argv);

const toMode = (value: unknown): Mode => {
  const mode = String(value || 'sample').toLowerCase();
  if (mode === 'head' || mode === 'tail' || mode === 'sample') {
    return mode;
  }
  return 'sample';
};

const toInspectTool = (value: unknown): InspectTool | null => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'quick' || raw === 'ydata') return raw;
  return null;
};

const selectInspectTool = async (
  defaultTool: InspectTool = 'quick',
): Promise<InspectTool> => {
  if (!process.stdin.isTTY) {
    return defaultTool;
  }

  const options: InspectTool[] = ['quick', 'ydata'];
  console.log(chalk.cyan('Available inspect tools:'));
  options.forEach((name, index) => {
    const isDefault = name === defaultTool;
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
    `Select inspect tool [${chalk.green(defaultTool)}]: `,
  );
  rl.close();

  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultTool;
  const asNumber = Number(trimmed);
  if (
    Number.isFinite(asNumber) &&
    asNumber >= 1 &&
    asNumber <= options.length
  ) {
    return options[asNumber - 1];
  }
  if (options.includes(trimmed as InspectTool)) {
    return trimmed as InspectTool;
  }
  console.warn(
    `Unknown inspect tool "${answer.trim()}", using ${defaultTool}.`,
  );
  return defaultTool;
};

const asPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readRowsHead = async (filePath: string, maxRows: number) => {
  const rows: Array<Record<string, unknown>> = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        rows.push(row as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed line.
    }
    if (rows.length >= maxRows) {
      rl.close();
      break;
    }
  }
  return rows;
};

const readRowsTail = async (filePath: string, maxRows: number) => {
  const ring: Array<Record<string, unknown>> = [];
  let idx = 0;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      if (ring.length < maxRows) {
        ring.push(row as Record<string, unknown>);
      } else {
        ring[idx] = row as Record<string, unknown>;
        idx = (idx + 1) % maxRows;
      }
    } catch {
      // Ignore malformed line.
    }
  }
  if (ring.length < maxRows || idx === 0) {
    return ring;
  }
  return ring.slice(idx).concat(ring.slice(0, idx));
};

const readRowsSample = async (filePath: string, maxRows: number) => {
  const sample: Array<Record<string, unknown>> = [];
  let seen = 0;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      seen += 1;
      if (sample.length < maxRows) {
        sample.push(row as Record<string, unknown>);
      } else {
        const replaceIndex = Math.floor(Math.random() * seen);
        if (replaceIndex < maxRows) {
          sample[replaceIndex] = row as Record<string, unknown>;
        }
      }
    } catch {
      // Ignore malformed line.
    }
  }
  return sample;
};

const quantileSorted = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const left = sorted[base];
  const right = sorted[Math.min(base + 1, sorted.length - 1)];
  return left + (right - left) * rest;
};

const mean = (values: number[]) => {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
};

const std = (values: number[], valuesMean: number) => {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) {
    const diff = value - valuesMean;
    total += diff * diff;
  }
  return Math.sqrt(total / values.length);
};

const findLatestDataset = async (params: { dir: string; strategy: string }) => {
  const { dir, strategy } = params;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const strategyToken = strategy.trim().toLowerCase();
  const files = entries
    .filter((entry: Dirent) => entry.isFile())
    .map((entry: Dirent) => entry.name)
    .filter((name: string) => name.endsWith('.jsonl'))
    .filter(
      (name: string) => !name.includes('.train.') && !name.includes('.test.'),
    )
    .filter((name: string) =>
      strategyToken
        ? name.toLowerCase().includes(`ml-dataset-${strategyToken}-`)
        : name.toLowerCase().startsWith('ml-dataset-'),
    );

  if (!files.length) {
    return null;
  }

  const withMtime = await Promise.all(
    files.map(async (name: string) => {
      const stat = await fs.stat(path.join(dir, name));
      return { name, mtime: stat.mtimeMs };
    }),
  );
  withMtime.sort(
    (a: { name: string; mtime: number }, b: { name: string; mtime: number }) =>
      b.mtime - a.mtime,
  );
  return path.join(dir, withMtime[0].name);
};

const buildNumericStats = (
  rows: Array<Record<string, unknown>>,
  minFieldValues: number,
) => {
  const allFields = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      allFields.add(key);
    }
  }

  const numericStats: NumericStats[] = [];
  for (const field of allFields) {
    const values: number[] = [];
    let missing = 0;
    let nonFinite = 0;
    let zeros = 0;
    let present = 0;

    for (const row of rows) {
      const raw = row[field];
      if (raw === null || raw === undefined || raw === '') {
        missing += 1;
        continue;
      }
      present += 1;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        nonFinite += 1;
        continue;
      }
      values.push(value);
      if (value === 0) {
        zeros += 1;
      }
    }

    if (values.length < minFieldValues) {
      continue;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantileSorted(sorted, 0.25);
    const median = quantileSorted(sorted, 0.5);
    const q3 = quantileSorted(sorted, 0.75);
    const p95 = quantileSorted(sorted, 0.95);
    const p99 = quantileSorted(sorted, 0.99);
    const valuesMean = mean(values);
    const valuesStd = std(values, valuesMean);
    const iqr = q3 - q1;
    const low = q1 - 3 * iqr;
    const high = q3 + 3 * iqr;
    const outliers = values.filter((v) => v < low || v > high).length;
    const uniqueCount = new Set(values).size;

    numericStats.push({
      field,
      count: rows.length,
      validCount: values.length,
      missingRate: missing / rows.length,
      nonFiniteRate: nonFinite / Math.max(present, 1),
      zeroRate: zeros / Math.max(values.length, 1),
      uniqueCount,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: valuesMean,
      std: valuesStd,
      median,
      q1,
      q3,
      p95,
      p99,
      outlierRate: outliers / Math.max(values.length, 1),
      scaleRatio: 0,
      issues: [],
      score: 0,
    });
  }

  const medianAbsValues = numericStats
    .map((item) => Math.abs(item.median))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const globalMedianAbs = quantileSorted(medianAbsValues, 0.5) || 1;

  for (const stat of numericStats) {
    const issues: string[] = [];
    let score = 0;
    const absMedian = Math.abs(stat.median);
    const absP99 = Math.abs(stat.p99);
    const p99ToMedian = absP99 / Math.max(absMedian, 1e-12);
    const scaleRatio = absMedian / globalMedianAbs;
    const hasStableMedian = absMedian >= 1e-4;
    const isBinary = stat.uniqueCount <= 2;
    stat.scaleRatio = scaleRatio;

    if (stat.nonFiniteRate > 0) {
      issues.push('has NaN/Inf values');
      score += 5;
    }
    if (stat.missingRate > 0.2) {
      issues.push(`high missing rate ${(stat.missingRate * 100).toFixed(1)}%`);
      score += 4;
    } else if (stat.missingRate > 0.05) {
      issues.push(
        `noticeable missing rate ${(stat.missingRate * 100).toFixed(1)}%`,
      );
      score += 2;
    }
    if (stat.validCount > 0 && stat.uniqueCount <= 1) {
      issues.push('constant value (no signal for model)');
      score += 5;
    }
    if (stat.zeroRate > 0.98) {
      issues.push(`almost always zero ${(stat.zeroRate * 100).toFixed(1)}%`);
      score += 4;
    } else if (stat.zeroRate > 0.9) {
      issues.push(`mostly zero ${(stat.zeroRate * 100).toFixed(1)}%`);
      score += 2;
    }
    if (hasStableMedian) {
      if (p99ToMedian > 1_000) {
        issues.push(
          `extreme scale spread p99/median=${p99ToMedian.toFixed(0)}`,
        );
        score += 5;
      } else if (p99ToMedian > 100) {
        issues.push(`large scale spread p99/median=${p99ToMedian.toFixed(0)}`);
        score += 3;
      }
    }
    if (stat.outlierRate > 0.1) {
      issues.push(
        `very high outlier rate ${(stat.outlierRate * 100).toFixed(1)}%`,
      );
      score += 4;
    } else if (stat.outlierRate > 0.03) {
      issues.push(`high outlier rate ${(stat.outlierRate * 100).toFixed(1)}%`);
      score += 2;
    }
    if (!isBinary && (scaleRatio > 1_000 || scaleRatio < 0.001)) {
      issues.push(
        `feature scale differs from dataset median by x${scaleRatio.toExponential(2)}`,
      );
      score += 3;
    }

    stat.issues = issues;
    stat.score = score;
  }

  numericStats.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.outlierRate - a.outlierRate;
  });

  return numericStats;
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1_000_000 || (abs > 0 && abs < 0.0001)) {
    return value.toExponential(3);
  }
  return value.toFixed(6);
};

const runQuickInspect = async (params: {
  datasetPath: string;
  mode: Mode;
  rowsToInspect: number;
  limitIssues: number;
  minFieldValues: number;
}) => {
  const { datasetPath, mode, rowsToInspect, limitIssues, minFieldValues } =
    params;
  let rows: Array<Record<string, unknown>> = [];
  if (mode === 'head') {
    rows = await readRowsHead(datasetPath, rowsToInspect);
  } else if (mode === 'tail') {
    rows = await readRowsTail(datasetPath, rowsToInspect);
  } else {
    rows = await readRowsSample(datasetPath, rowsToInspect);
  }

  if (!rows.length) {
    console.error(chalk.red('No rows could be read from dataset.'));
    process.exit(1);
  }

  const numericStats = buildNumericStats(rows, minFieldValues);
  if (!numericStats.length) {
    console.error(
      chalk.red(
        'No numeric fields with enough values were found in sampled rows.',
      ),
    );
    process.exit(1);
  }

  const problematic = numericStats.filter((item) => item.score > 0);
  console.log(chalk.gray('ML dataset inspection (quick)'));
  console.log(chalk.gray(`file: ${datasetPath}`));
  console.log(chalk.gray(`mode: ${mode}`));
  console.log(chalk.gray(`rows inspected: ${rows.length}`));
  console.log(chalk.gray(`numeric fields analyzed: ${numericStats.length}`));
  console.log(chalk.gray(`fields with recommendations: ${problematic.length}`));
  console.log('');

  if (!problematic.length) {
    console.log(
      chalk.green('No problematic fields detected by current rules.'),
    );
    process.exit(0);
  }

  const top = problematic.slice(0, limitIssues);
  for (const item of top) {
    console.log(chalk.yellow(item.field));
    console.log(
      `  score=${item.score} issues=${item.issues.join('; ') || 'none'}`,
    );
    console.log(
      `  median=${formatNumber(item.median)} p99=${formatNumber(item.p99)} min=${formatNumber(item.min)} max=${formatNumber(item.max)}`,
    );
    console.log(
      `  missing=${(item.missingRate * 100).toFixed(2)}% nonFinite=${(item.nonFiniteRate * 100).toFixed(2)}% outliers=${(item.outlierRate * 100).toFixed(2)}% zeros=${(item.zeroRate * 100).toFixed(2)}%`,
    );
  }

  if (problematic.length > limitIssues) {
    console.log('');
    console.log(
      chalk.gray(
        `... ${problematic.length - limitIssues} more fields hidden (raise --limitIssues)`,
      ),
    );
  }

  console.log('');
  console.log(chalk.cyan('How to fix common issues:'));
  console.log(
    '  - Large scale spread: normalize feature (log1p / relative to price / robust scaling).',
  );
  console.log(
    '  - High outliers: winsorize/clip or rebuild the source transform.',
  );
  console.log('  - Missing values: fill consistently or remove the feature.');
  console.log(
    '  - Constant/mostly zero: drop the feature or redefine its window.',
  );
};

const runYDataInspect = async (params: {
  datasetPath: string;
  mode: Mode;
  rowsToInspect: number;
}) => {
  const { datasetPath, mode, rowsToInspect } = params;
  const cwd = process.cwd();
  const absDatasetPath = path.resolve(datasetPath);
  const dataRoot = path.resolve(cwd, 'data');

  if (!absDatasetPath.startsWith(dataRoot)) {
    console.error(
      chalk.red(
        `ydata mode supports only files under ${dataRoot}. Use --file inside data/`,
      ),
    );
    process.exit(1);
  }

  const relToData = path.relative(dataRoot, absDatasetPath);
  const inputInContainer = `/app/data/${relToData}`;
  const reportDir = path.dirname(absDatasetPath);
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(
    reportDir,
    `${path.basename(datasetPath, path.extname(datasetPath))}.profile.html`,
  );
  const reportRelToData = path.relative(dataRoot, reportPath);
  const reportInContainer = `/app/data/${reportRelToData}`;

  console.log(
    chalk.gray(
      'Running ydata-profiling report via docker ml-profile service...',
    ),
  );
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.ml.yml',
      'run',
      '--rm',
      'ml-profile',
      'python',
      '/app/ml/profile.py',
      '--input',
      inputInContainer,
      '--rows',
      String(rowsToInspect),
      '--mode',
      mode,
      '--output',
      reportInContainer,
      '--title',
      `ML Profile: ${path.basename(datasetPath)}`,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    },
  );

  if ((result.status ?? 1) !== 0) {
    console.error(
      chalk.red(
        'ydata-profiling failed. Build profile image first: docker compose -f docker-compose.ml.yml build ml-profile',
      ),
    );
    process.exit(result.status ?? 1);
  }

  console.log(chalk.green(`Profile report saved: ${reportPath}`));
};

const main = async () => {
  const dir = String(flags.dir || 'data/ml/export');
  const rowsToInspect = asPositiveInt(flags.rows, 10000);
  const mode = toMode(flags.mode);
  const strategy = String(flags.strategy || '');
  const limitIssues = asPositiveInt(flags.limitIssues, 25);
  const minFieldValues = asPositiveInt(flags.minFieldValues, 50);
  const toolFromFlags = toInspectTool(flags.tool);

  const explicitFile = flags.file ? String(flags.file) : '';
  const datasetPath =
    explicitFile ||
    (await findLatestDataset({
      dir,
      strategy,
    }));

  if (!datasetPath) {
    console.error(
      chalk.red(`No dataset found. Expected ml-dataset-*.jsonl in ${dir}`),
    );
    process.exit(1);
  }

  const tool = toolFromFlags ?? (await selectInspectTool('quick'));
  if (tool === 'ydata') {
    await runYDataInspect({
      datasetPath,
      mode,
      rowsToInspect,
    });
    return;
  }

  await runQuickInspect({
    datasetPath,
    mode,
    rowsToInspect,
    limitIssues,
    minFieldValues,
  });
};

main().catch((err) => {
  console.error('ml-inspect failed:', err);
  process.exit(1);
});
