/// <reference types="node" />

import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { Dirent } from 'fs';

type Mode = 'head' | 'tail' | 'sample';

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

args.option(['d', 'dir'], 'Dataset directory', 'data/ml');
args.option(['s', 'split'], 'train | test', 'train');
args.option(['r', 'rows'], 'Rows to inspect', 10000);
args.option(['m', 'mode'], 'head | tail | sample', 'sample');
args.option(['S', 'strategy'], 'Strategy token in dataset filename', '');
args.option(['f', 'file'], 'Explicit dataset file path (overrides auto-select)');
args.option(['L', 'limitIssues'], 'How many fields to print in report', 25);
args.option(['M', 'minFieldValues'], 'Min valid values per numeric field', 50);

const flags = args.parse(process.argv);

const toMode = (value: unknown): Mode => {
  const mode = String(value || 'sample').toLowerCase();
  if (mode === 'head' || mode === 'tail' || mode === 'sample') {
    return mode;
  }
  return 'sample';
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

const findLatestDataset = async (params: {
  dir: string;
  split: string;
  strategy: string;
}) => {
  const { dir, split, strategy } = params;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const strategyToken = strategy.trim().toLowerCase();
  const suffix = `.${split}.jsonl`;
  const files = entries
    .filter((entry: Dirent) => entry.isFile())
    .map((entry: Dirent) => entry.name)
    .filter((name: string) => name.endsWith(suffix))
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
    stat.scaleRatio = scaleRatio;

    if (stat.nonFiniteRate > 0) {
      issues.push('has NaN/Inf values');
      score += 5;
    }
    if (stat.missingRate > 0.2) {
      issues.push(`high missing rate ${(stat.missingRate * 100).toFixed(1)}%`);
      score += 4;
    } else if (stat.missingRate > 0.05) {
      issues.push(`noticeable missing rate ${(stat.missingRate * 100).toFixed(1)}%`);
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
    if (p99ToMedian > 1_000) {
      issues.push(`extreme scale spread p99/median=${p99ToMedian.toFixed(0)}`);
      score += 5;
    } else if (p99ToMedian > 100) {
      issues.push(`large scale spread p99/median=${p99ToMedian.toFixed(0)}`);
      score += 3;
    }
    if (stat.outlierRate > 0.1) {
      issues.push(`very high outlier rate ${(stat.outlierRate * 100).toFixed(1)}%`);
      score += 4;
    } else if (stat.outlierRate > 0.03) {
      issues.push(`high outlier rate ${(stat.outlierRate * 100).toFixed(1)}%`);
      score += 2;
    }
    if (scaleRatio > 1_000 || scaleRatio < 0.001) {
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

const main = async () => {
  const dir = String(flags.dir || 'data/ml');
  const split = String(flags.split || 'train').toLowerCase();
  const rowsToInspect = asPositiveInt(flags.rows, 10000);
  const mode = toMode(flags.mode);
  const strategy = String(flags.strategy || '');
  const limitIssues = asPositiveInt(flags.limitIssues, 25);
  const minFieldValues = asPositiveInt(flags.minFieldValues, 50);

  if (split !== 'train' && split !== 'test') {
    console.error(chalk.red('Invalid --split. Use train or test.'));
    process.exit(1);
  }

  const explicitFile = flags.file ? String(flags.file) : '';
  const datasetPath =
    explicitFile ||
    (await findLatestDataset({
      dir,
      split,
      strategy,
    }));

  if (!datasetPath) {
    console.error(
      chalk.red(
        `No dataset found. Expected ml-dataset-*.${split}.jsonl in ${dir}`,
      ),
    );
    process.exit(1);
  }

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
      chalk.red('No numeric fields with enough values were found in sampled rows.'),
    );
    process.exit(1);
  }

  const problematic = numericStats.filter((item) => item.score > 0);
  console.log(chalk.gray('ML dataset inspection'));
  console.log(chalk.gray(`file: ${datasetPath}`));
  console.log(chalk.gray(`mode: ${mode}`));
  console.log(chalk.gray(`rows inspected: ${rows.length}`));
  console.log(chalk.gray(`numeric fields analyzed: ${numericStats.length}`));
  console.log(
    chalk.gray(`fields with recommendations: ${problematic.length}`),
  );
  console.log('');

  if (!problematic.length) {
    console.log(chalk.green('No problematic fields detected by current rules.'));
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
  console.log('  - Large scale spread: normalize feature (log1p / relative to price / robust scaling).');
  console.log('  - High outliers: winsorize/clip or rebuild the source transform.');
  console.log('  - Missing values: fill consistently or remove the feature.');
  console.log('  - Constant/mostly zero: drop the feature or redefine its window.');
};

main().catch((err) => {
  console.error('ml-inspect failed:', err);
  process.exit(1);
});
