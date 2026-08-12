import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import chalk from 'chalk';
import {
  buildStrategyLiveDiagnosis,
  buildStrategyMonitoringProfile,
  collectReleaseEvidenceReferences,
  createStrategyReleaseManifest,
  planStrategyEvidenceRetention,
  publishStrategyRelease,
  publishStrategyLiveDiagnosis,
  verifyStrategyReleaseEnvelope,
} from '../lib/strategyRelease';

type StrategyReleaseCommand =
  | 'create'
  | 'verify'
  | 'diagnose'
  | 'profile'
  | 'retention';

const valueAfter = (argv: string[], name: string) => {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
};

const required = (value: string | undefined, name: string) => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
};

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(temporaryPath, filePath);
};

export const runStrategyReleaseCommand = async (options: {
  command: StrategyReleaseCommand;
  inputPath: string;
  rootDir?: string;
  outputPath?: string;
  apply?: boolean;
  variantId?: string;
  startTime?: number;
  endTime?: number;
  days?: number[];
}) => {
  const inputPath = path.resolve(options.inputPath);
  if (options.command === 'verify') {
    const envelope = await verifyStrategyReleaseEnvelope(inputPath);
    return {
      kind: 'verified' as const,
      releaseId: envelope.releaseId,
      verdict: envelope.manifest.verdict.status,
      inputPath,
    };
  }
  if (options.command === 'profile') {
    const startTime = options.startTime;
    const endTime = options.endTime;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      throw new Error('--startTime and --endTime are required');
    }
    const trades: Array<{ exitTimestamp: number; netProfit: number }> = [];
    const lines = createInterface({
      input: createReadStream(inputPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as {
        variantId?: string;
        exitTimestamp?: number;
        netProfit?: number;
      };
      if (options.variantId && row.variantId !== options.variantId) continue;
      if (
        Number.isFinite(row.exitTimestamp) &&
        Number.isFinite(row.netProfit)
      ) {
        trades.push({
          exitTimestamp: row.exitTimestamp!,
          netProfit: row.netProfit!,
        });
      }
    }
    const profile = buildStrategyMonitoringProfile({
      trades,
      startTime: startTime!,
      endTime: endTime!,
      days: options.days?.length ? options.days : [7, 30, 90],
    });
    const outputPath = path.resolve(
      options.outputPath ?? 'output/strategy-monitoring-profile.json',
    );
    await writeJsonAtomic(outputPath, profile);
    return {
      kind: 'profiled' as const,
      trades: trades.length,
      outputPath,
      profile,
    };
  }
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8')) as any;
  if (options.command === 'retention') {
    const plan = planStrategyEvidenceRetention(input);
    if (options.apply) {
      await Promise.all(plan.delete.map((entry) => fs.rm(entry.path)));
    }
    return {
      kind: 'retention' as const,
      applied: Boolean(options.apply),
      keepCount: plan.keep.length,
      deleteCount: plan.delete.length,
      bytesReclaimable: plan.bytesReclaimable,
      delete: plan.delete.map((entry) => entry.path),
    };
  }
  if (options.command === 'diagnose') {
    const diagnosis = buildStrategyLiveDiagnosis(input);
    const outputPath = path.resolve(
      options.outputPath ?? 'output/strategy-live-diagnosis.json',
    );
    await writeJsonAtomic(outputPath, diagnosis);
    const published = options.rootDir
      ? await publishStrategyLiveDiagnosis({
          rootDir: path.resolve(options.rootDir),
          diagnosis,
          sourceArtifacts: input.sourceArtifacts ?? [],
        })
      : null;
    return {
      kind: 'diagnosed' as const,
      verdict: diagnosis.verdict,
      outputPath,
      diagnosisPath: published?.diagnosisPath ?? null,
      markerPath: published?.markerPath ?? null,
    };
  }
  const manifest = createStrategyReleaseManifest({
    ...input,
    evidence: await collectReleaseEvidenceReferences(input.evidence ?? []),
  });
  const published = await publishStrategyRelease({
    rootDir: path.resolve(options.rootDir ?? 'data/strategy-release'),
    manifest,
  });
  return {
    kind: 'created' as const,
    releaseId: manifest.releaseId,
    verdict: manifest.verdict.status,
    releasePath: published.releasePath,
    markerPath: published.markerPath,
  };
};

const printUsage = () =>
  console.log(`Usage:
  yarn strategy:release create --input <draft.json> [--root data/strategy-release]
  yarn strategy:release verify --input <release.json>
  yarn strategy:release profile --input <trades.jsonl> --variant <id> --startTime <ms> --endTime <ms> [--days 7,30,90] [--out <profile.json>]
  yarn strategy:release diagnose --input <diagnosis-input.json> [--out output/diagnosis.json]
  yarn strategy:release retention --input <inventory.json> [--apply]`);

export const main = async () => {
  const argv = process.argv.slice(2);
  const command = argv[0] as StrategyReleaseCommand | undefined;
  if (
    !command ||
    !['create', 'verify', 'diagnose', 'profile', 'retention'].includes(command)
  ) {
    printUsage();
    if (command) process.exitCode = 1;
    return;
  }
  const result = await runStrategyReleaseCommand({
    command,
    inputPath: required(valueAfter(argv, '--input'), '--input'),
    rootDir: valueAfter(argv, '--root'),
    outputPath: valueAfter(argv, '--out'),
    apply: argv.includes('--apply'),
    variantId: valueAfter(argv, '--variant'),
    startTime: Number(valueAfter(argv, '--startTime')),
    endTime: Number(valueAfter(argv, '--endTime')),
    days: valueAfter(argv, '--days')
      ?.split(',')
      .map((entry) => Number(entry.trim())),
  });
  console.log(chalk.green(JSON.stringify(result, null, 2)));
};
