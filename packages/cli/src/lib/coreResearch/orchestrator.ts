import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { listCoreResearchTraceFiles } from '@tradejs/infra/coreResearch';
import { writeCoreResearchMatches, writeCoreResearchTrades } from './artifacts';
import {
  appendCoreResearchLedger,
  canonicalJson,
  prepareCoreResearch,
  readCoreResearchLedger,
  sha256File,
  sha256Json,
  writeJsonAtomic,
  writeCoreResearchStageIndex,
} from './io';
import { compareCoreResearchVariants } from './comparison';
import { readCoreResearchVariant } from './dataset';
import {
  buildCostStress,
  buildEqualTimeFolds,
  buildMonthlyWindows,
  buildRegimeMetrics,
  buildTerminalWindows,
  DAY_MS,
  summarizeCoreResearchWindow,
} from './metrics';
import { buildCoreResearchHtml } from './report';
import { reconcileCoreResearchVariant } from './reconciliation';
import { applyCoreResearchRobustnessGuardrails } from './selection';
import {
  applyHolmCorrection,
  deflatedSharpeDiagnostic,
  probabilityOfBacktestOverfitting,
} from './statistics';
import { summarizeCoreResearchTrace } from './trace';
import {
  CORE_RESEARCH_RESULT_SCHEMA,
  type CoreResearchResult,
  type CoreResearchSpec,
  type CoreResearchVariantAnalysis,
} from './types';

const summarizeSupplementalFiles = async (params: {
  variant: CoreResearchSpec['variants'][number];
  files: string[];
  id: string;
  start: number;
  end: number;
}) => {
  const loaded = await readCoreResearchVariant({
    ...params.variant,
    id: params.id,
    files: params.files,
    runId: undefined,
    command: undefined,
  });
  return summarizeCoreResearchWindow({
    trades: loaded.trades,
    label: params.id,
    start: params.start,
    end: params.end,
  });
};

const analyzeCoreResearchPrepared = async (
  spec: CoreResearchSpec,
  options: {
    prepared?: Awaited<ReturnType<typeof prepareCoreResearch>>;
    variants?: CoreResearchSpec['variants'];
  } = {},
) => {
  const prepared = options.prepared ?? (await prepareCoreResearch(spec));
  const { paths, specSha256 } = prepared;
  if (prepared.manifest.status === 'completed') {
    throw new Error(
      `Research ${spec.researchId} is already completed and immutable; use verify or create a new researchId`,
    );
  }
  await appendCoreResearchLedger({
    ledgerPath: paths.ledgerPath,
    researchId: spec.researchId,
    event: 'analysis_started',
    specSha256,
    hypothesisFamily: spec.hypothesis.family,
    hypothesesInRecord: spec.variants.filter(
      (variant) => variant.role === 'candidate',
    ).length,
  });
  const analysisSpec: CoreResearchSpec = {
    ...spec,
    variants: options.variants ?? spec.variants,
  };
  const loaded = await Promise.all(
    analysisSpec.variants.map(readCoreResearchVariant),
  );
  const windowed = loaded.map((entry) => ({
    ...entry,
    trades: entry.trades.filter(
      (trade) =>
        trade.exitTimestamp >= spec.window.start &&
        trade.exitTimestamp < spec.window.end,
    ),
  }));
  const periodDays = (spec.window.end - spec.window.start) / DAY_MS;
  const analyses: CoreResearchVariantAnalysis[] = await Promise.all(
    windowed.map(async (entry) => ({
      variant: entry.variant,
      files: entry.files,
      duplicateRowsDropped: entry.duplicateRowsDropped,
      setupIdentitySources: entry.trades.reduce(
        (summary, trade) => {
          summary[trade.setupIdentitySource] += 1;
          return summary;
        },
        {
          'research.setupIdentity': 0,
          'strategy-context': 0,
          'signal-time-fallback': 0,
        } as CoreResearchVariantAnalysis['setupIdentitySources'],
      ),
      full: summarizeCoreResearchWindow({
        trades: entry.trades,
        label: 'full',
        start: spec.window.start,
        end: spec.window.end,
      }),
      terminal: buildTerminalWindows({
        trades: entry.trades,
        end: spec.window.end,
        terminalDays: spec.window.terminalDays,
      }),
      folds: buildEqualTimeFolds({
        trades: entry.trades,
        start: spec.window.start,
        end: spec.window.end,
        folds: spec.window.folds,
      }),
      monthly: buildMonthlyWindows({
        trades: entry.trades,
        start: spec.window.start,
        end: spec.window.end,
      }),
      regimes: buildRegimeMetrics(entry.trades, periodDays),
      costStress: buildCostStress({
        trades: entry.trades,
        periodDays,
        extraRoundTripBps: spec.robustness.costStressBps,
      }),
      traceFunnel: await summarizeCoreResearchTrace(entry.variant.traceFiles),
      latestSignalTimeRegime: entry.trades.length
        ? {
            ...[...entry.trades].sort(
              (left, right) => right.signalTimestamp - left.signalTimestamp,
            )[0].regime,
            timestamp: Math.max(
              ...entry.trades.map((trade) => trade.signalTimestamp),
            ),
            lagToWindowEndMs:
              spec.window.end -
              Math.max(...entry.trades.map((trade) => trade.signalTimestamp)),
          }
        : null,
      reconciliation: await reconcileCoreResearchVariant({
        variant: entry.variant,
        spec,
        exportMetrics: summarizeCoreResearchWindow({
          trades: entry.trades,
          label: 'full',
          start: spec.window.start,
          end: spec.window.end,
        }).cohorts.ALL,
      }),
      supplemental: {
        coldStart: Object.fromEntries(
          await Promise.all(
            Object.entries(entry.variant.coldStartFiles ?? {}).map(
              async ([label, files]) => [
                label,
                await summarizeSupplementalFiles({
                  variant: entry.variant,
                  files,
                  id: `${entry.variant.id}-cold-${label}`,
                  start: spec.window.start,
                  end: spec.window.end,
                }),
              ],
            ),
          ),
        ),
        stress: Object.fromEntries(
          await Promise.all(
            Object.entries(entry.variant.stressFiles ?? {}).map(
              async ([label, files]) => [
                label,
                await summarizeSupplementalFiles({
                  variant: entry.variant,
                  files,
                  id: `${entry.variant.id}-stress-${label}`,
                  start: spec.window.start,
                  end: spec.window.end,
                }),
              ],
            ),
          ),
        ),
        confirmation: entry.variant.confirmationFiles?.length
          ? await summarizeSupplementalFiles({
              variant: entry.variant,
              files: entry.variant.confirmationFiles,
              id: `${entry.variant.id}-confirmation`,
              start: spec.window.start,
              end: spec.window.end,
            })
          : null,
      },
    })),
  );
  const control = windowed.find((entry) => entry.variant.role === 'control');
  if (!control) throw new Error('Core research control variant was not loaded');
  const comparisons = windowed
    .filter((entry) => entry.variant.role === 'candidate')
    .map((candidate) =>
      compareCoreResearchVariants({ spec: analysisSpec, control, candidate }),
    );
  const familyHypotheses = (await readCoreResearchLedger(paths.ledgerPath))
    .filter((record) => record.hypothesisFamily === spec.hypothesis.family)
    .reduce(
      (sum, record) =>
        record.event === 'prepared' ? sum + record.hypothesesInRecord : sum,
      0,
    );
  applyHolmCorrection(
    comparisons.map((comparison) => comparison.bootstrap),
    Math.max(comparisons.length, familyHypotheses),
  );
  applyCoreResearchRobustnessGuardrails({ spec, analyses, comparisons });
  const evidence = {
    screen: spec.stage === 'screen' ? 'present' : 'missing',
    isolatedLong: spec.stage === 'isolated_long' ? 'present' : 'missing',
    terminals: spec.window.terminalDays.length ? 'present' : 'missing',
    folds: spec.window.folds >= 2 ? 'present' : 'missing',
    coldStart: analysisSpec.variants.every(
      (variant) => Object.keys(variant.coldStartFiles ?? {}).length > 0,
    )
      ? 'present'
      : 'missing',
    costStress: spec.robustness.costStressBps.length ? 'present' : 'missing',
    delayStress: analysisSpec.variants.every(
      (variant) => Object.keys(variant.stressFiles ?? {}).length > 0,
    )
      ? 'present'
      : 'missing',
    fastNonFast: analysisSpec.variants.every(
      (variant) => (variant.confirmationFiles?.length ?? 0) > 0,
    )
      ? 'present'
      : 'missing',
    runtimeParity: analysisSpec.variants.every(
      (variant) => (variant.runtimeParityFiles?.length ?? 0) > 0,
    )
      ? 'present'
      : 'missing',
  } as const;
  const primarySourceHashes = Object.fromEntries(
    analyses.flatMap((analysis) =>
      analysis.files.map((file) => [
        path.relative(paths.researchDir, file.path),
        file.sha256,
      ]),
    ),
  );
  const supplementalSourcePaths = [
    ...new Set(
      analysisSpec.variants.flatMap((variant) => [
        ...(variant.traceFiles ?? []),
        ...(variant.confirmationFiles ?? []),
        ...(variant.runtimeParityFiles ?? []),
        ...Object.values(variant.coldStartFiles ?? {}).flat(),
        ...Object.values(variant.stressFiles ?? {}).flat(),
      ]),
    ),
  ];
  const supplementalSourceHashes = Object.fromEntries(
    await Promise.all(
      supplementalSourcePaths.map(async (filePath) => [
        path.relative(paths.researchDir, path.resolve(filePath)),
        await sha256File(path.resolve(filePath)),
      ]),
    ),
  );
  const sourceHashes = {
    ...primarySourceHashes,
    ...supplementalSourceHashes,
  };
  const result: CoreResearchResult = {
    schema: CORE_RESEARCH_RESULT_SCHEMA,
    researchId: spec.researchId,
    stage: spec.stage,
    generatedAt: new Date().toISOString(),
    specSha256,
    lineage: spec.lineage,
    semantics: {
      cohortOrder: ['ALL', 'LONG', 'SHORT'],
      pnlPerTrade: 'cohort PnL / cohort completed positions',
      drawdown: {
        ALL: 'time-ordered aggregate portfolio realized drawdown',
        LONG: 'time-ordered LONG-only realized drawdown',
        SHORT: 'time-ordered SHORT-only realized drawdown',
      },
      regimeCausality:
        'signal-time payload.additionalIndicators.baseContext only',
    },
    variants: analyses,
    comparisons,
    multipleTesting: {
      family: spec.hypothesis.family,
      hypotheses: Math.max(comparisons.length, familyHypotheses),
      method: 'Holm',
    },
    evidence,
    overfittingDiagnostics: {
      deflatedSharpe: Object.fromEntries(
        analyses.map((analysis) => [
          analysis.variant.id,
          deflatedSharpeDiagnostic(
            analysis.monthly.map((window) => window.cohorts.ALL.pnl),
            Math.max(comparisons.length, familyHypotheses),
          ),
        ]),
      ),
      probabilityOfBacktestOverfitting: probabilityOfBacktestOverfitting(
        analyses.map((analysis) =>
          analysis.folds.map((window) => window.cohorts.ALL.pnl),
        ),
      ),
    },
    artifactHashes: sourceHashes,
  };
  await writeJsonAtomic(paths.resultPath, result);
  await writeJsonAtomic(paths.comparisonPath, comparisons);
  await writeCoreResearchMatches({ filePath: paths.matchesPath, comparisons });
  await writeCoreResearchTrades({
    filePath: paths.tradesPath,
    variants: windowed.map((entry) => ({
      variantId: entry.variant.id,
      trades: entry.trades,
    })),
  });
  const tradesByVariant = new Map(
    windowed.map((entry) => [entry.variant.id, entry.trades]),
  );
  await fs.writeFile(
    paths.reportPath,
    buildCoreResearchHtml({ spec, result, tradesByVariant }),
    'utf8',
  );
  const artifactHashes: Record<string, string> = {
    'spec.json': await sha256File(paths.specPath),
    'result.json': await sha256File(paths.resultPath),
    'comparison.json': await sha256File(paths.comparisonPath),
    'matches.csv': await sha256File(paths.matchesPath),
    'trades.jsonl': await sha256File(paths.tradesPath),
    'report.html': await sha256File(paths.reportPath),
  };
  const resolvedRunsPath = path.join(paths.researchDir, 'resolved-runs.json');
  try {
    artifactHashes['resolved-runs.json'] = await sha256File(resolvedRunsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    for (const name of await fs.readdir(paths.runLogDir)) {
      if (!name.endsWith('.log')) continue;
      artifactHashes[`runs/${name}`] = await sha256File(
        path.join(paths.runLogDir, name),
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeJsonAtomic(paths.manifestPath, {
    schema: 'tradejs-core-research-manifest/v1',
    researchId: spec.researchId,
    specSha256,
    status: 'completed',
    createdAt: spec.createdAt,
    completedAt: result.generatedAt,
    selection: Object.fromEntries(
      comparisons.map((comparison) => [
        comparison.candidateId,
        comparison.selection,
      ]),
    ),
    artifactHashes,
  });
  await appendCoreResearchLedger({
    ledgerPath: paths.ledgerPath,
    researchId: spec.researchId,
    event: 'analysis_completed',
    specSha256,
    hypothesisFamily: spec.hypothesis.family,
    hypothesesInRecord: comparisons.length,
    artifactHashes,
  });
  await writeCoreResearchStageIndex(paths.rootDir);
  return { result, paths, artifactHashes };
};

export const analyzeCoreResearch = async (
  spec: CoreResearchSpec,
  options: {
    prepared?: Awaited<ReturnType<typeof prepareCoreResearch>>;
    variants?: CoreResearchSpec['variants'];
  } = {},
) => {
  const prepared = options.prepared ?? (await prepareCoreResearch(spec));
  try {
    return await analyzeCoreResearchPrepared(spec, { ...options, prepared });
  } catch (error) {
    if (prepared.manifest.status !== 'completed') {
      try {
        await appendCoreResearchLedger({
          ledgerPath: prepared.paths.ledgerPath,
          researchId: spec.researchId,
          event: 'analysis_failed',
          specSha256: prepared.specSha256,
          hypothesisFamily: spec.hypothesis.family,
          hypothesesInRecord: spec.variants.filter(
            (variant) => variant.role === 'candidate',
          ).length,
        });
      } catch {
        // Preserve the original analysis failure; ledger locking is reported by
        // the next explicit verify instead of masking the causal error.
      }
    }
    throw error;
  }
};

export const createCoreResearchSpecTemplate = (params: {
  researchId: string;
  strategy: string;
  symbols: string[];
  start: number;
  end: number;
  outputPath: string;
}) => {
  const rootDir = 'data/research/core';
  const projectRoot = process.cwd();
  const lineage = (() => {
    try {
      const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const dirtyDiff = execFileSync(
        'git',
        ['diff', '--binary', '--no-ext-diff', 'HEAD'],
        {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      return {
        gitSha,
        ...(dirtyDiff
          ? {
              dirtyDiffSha256: createHash('sha256')
                .update(dirtyDiff)
                .digest('hex'),
            }
          : {}),
      };
    } catch {
      return {};
    }
  })();
  return {
    schema: 'tradejs-core-research/v1',
    researchId: params.researchId,
    stage: 'screen',
    strategy: params.strategy,
    createdAt: new Date().toISOString(),
    hypothesis: {
      family: `${params.strategy}-hypothesis-family`,
      claim: 'Candidate improves the preregistered metric versus control.',
      mechanism: 'Describe the causal mechanism before running the experiment.',
      target: 'ALL',
    },
    universe: { symbols: params.symbols, sha256: sha256Json(params.symbols) },
    window: {
      start: params.start,
      end: params.end,
      terminalDays: [365, 180, 90, 30],
      folds: 6,
    },
    execution: {
      connector: 'ByBit',
      interval: '15',
      maxLossValue: 10,
      feeRate: 0.001,
      slippageBps: 10,
      entryDelayBars: 1,
    },
    variants: [
      {
        id: 'control',
        label: 'Control',
        role: 'control',
        configName: `${params.strategy}:control`,
        resolvedConfig: {},
        configSha256: sha256Json({}),
        files: ['data/ai/export/control.jsonl'],
      },
      {
        id: 'candidate',
        label: 'Candidate',
        role: 'candidate',
        configName: `${params.strategy}:candidate`,
        resolvedConfig: {},
        configSha256: sha256Json({}),
        files: ['data/ai/export/candidate.jsonl'],
      },
    ],
    selection: {
      minimumTrades: 36,
      minimumCadencePerDay: 0.2,
      targetRules: [
        { metric: 'pnl', comparison: 'gt', relativeToControl: true },
        { metric: 'pnlPerTrade', comparison: 'gt', relativeToControl: true },
        { metric: 'profitFactor', comparison: 'gte', relativeToControl: true },
        { metric: 'winRatePct', comparison: 'gte', relativeToControl: true },
      ],
      aggregateRules: [
        { metric: 'pnl', comparison: 'gt', relativeToControl: true },
        {
          metric: 'realizedMaxDrawdown',
          comparison: 'lte',
          relativeToControl: true,
        },
      ],
      nonTargetRules: [],
      costStressRules: [
        { metric: 'pnl', comparison: 'gt', relativeToControl: true },
        {
          metric: 'realizedMaxDrawdown',
          comparison: 'lte',
          relativeToControl: true,
        },
      ],
      maximumPortfolioDrawdownRegressionPct: 0,
    },
    robustness: {
      bootstrapIterations: 2_000,
      confidenceLevel: 0.95,
      clusterDays: 7,
      minimumFoldTrades: 20,
      costStressBps: [5, 10, 20],
    },
    artifacts: {
      rootDir,
      ledgerPath: `${rootDir}/trials.jsonl`,
    },
    lineage,
    outputPath: params.outputPath,
  } satisfies CoreResearchSpec & { outputPath: string };
};

export const serializeCoreResearchSpec = (spec: CoreResearchSpec) =>
  `${canonicalJson(spec)}\n`;

const runCommand = async (params: {
  command: string[];
  cwd: string;
  logPath: string;
  onLine?: (line: string) => void;
}) => {
  if (!params.command.length) throw new Error('Cannot run an empty command');
  await fs.mkdir(path.dirname(params.logPath), { recursive: true });
  const chunks: string[] = [];
  const child = spawn(params.command[0], params.command.slice(1), {
    cwd: params.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    chunks.push(text);
    process.stdout.write(text);
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => params.onLine?.(line));
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  const output = chunks.join('');
  await fs.writeFile(params.logPath, output, 'utf8');
  if (exitCode !== 0) {
    throw new Error(
      `Command failed with exit ${exitCode}: ${params.command.join(' ')}`,
    );
  }
  return output;
};

const commandValue = (command: string[], names: string[]) => {
  for (let index = 0; index < command.length; index += 1) {
    const token = command[index];
    if (names.includes(token)) return command[index + 1];
    for (const name of names) {
      if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
    }
  }
  return undefined;
};

const commandHas = (command: string[], names: string[]) =>
  command.some(
    (token) =>
      names.includes(token) ||
      names.some((name) => token.startsWith(`${name}=`)),
  );

export const validateCoreResearchRunCommand = (params: {
  spec: CoreResearchSpec;
  variant: CoreResearchSpec['variants'][number];
}) => {
  const { spec, variant } = params;
  const command = variant.command ?? [];
  const failures: string[] = [];
  if (!commandHas(command, ['--ai', '-A'])) failures.push('--ai');
  if (!commandHas(command, ['--fast'])) failures.push('--fast');
  if (!commandHas(command, ['--cacheOnly', '-C'])) failures.push('--cacheOnly');
  if (commandHas(command, ['--continue', '-K', '--runId', '-R'])) {
    failures.push('fresh-run-only');
  }
  if (commandValue(command, ['--config', '-c']) !== variant.configName) {
    failures.push(`config=${variant.configName}`);
  }
  if (Number(commandValue(command, ['--startTime'])) !== spec.window.start) {
    failures.push(`startTime=${spec.window.start}`);
  }
  if (Number(commandValue(command, ['--endTime'])) !== spec.window.end) {
    failures.push(`endTime=${spec.window.end}`);
  }
  const tickers = (commandValue(command, ['--tickers', '-t']) ?? '')
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  if (sha256Json(tickers) !== spec.universe.sha256) {
    failures.push('frozen ordered ticker universe');
  }
  if (failures.length) {
    throw new Error(
      `Variant ${variant.id} run command failed preflight: ${failures.join(', ')}`,
    );
  }
};

export const runCoreResearch = async (params: {
  spec: CoreResearchSpec;
  cwd?: string;
}) => {
  const { spec } = params;
  const cwd = path.resolve(params.cwd ?? process.cwd());
  const prepared = await prepareCoreResearch(spec);
  const resolvedVariants: CoreResearchSpec['variants'] = [];
  for (const variant of spec.variants) {
    if (!variant.command?.length) {
      resolvedVariants.push(variant);
      continue;
    }
    validateCoreResearchRunCommand({ spec, variant });
    await appendCoreResearchLedger({
      ledgerPath: prepared.paths.ledgerPath,
      researchId: spec.researchId,
      event: 'run_started',
      specSha256: prepared.specSha256,
      hypothesisFamily: spec.hypothesis.family,
      artifactHashes: { variant: sha256Json(variant) },
    });
    let runId = '';
    const backtestLogPath = path.join(
      prepared.paths.runLogDir,
      `${variant.id}-backtest.log`,
    );
    try {
      await runCommand({
        command: variant.command,
        cwd,
        logPath: backtestLogPath,
        onLine: (line) => {
          const match = line.match(
            /backtest run id:\s*([0-9]{12}-[a-f0-9]{8})/i,
          );
          if (match) runId = match[1];
        },
      });
      if (!runId) {
        throw new Error(`Backtest for ${variant.id} did not report a run id`);
      }
      const exportLogPath = path.join(
        prepared.paths.runLogDir,
        `${variant.id}-export.log`,
      );
      const exportParts: string[] = [];
      const cliPath = path.resolve(process.argv[1]);
      await runCommand({
        command: [
          process.execPath,
          cliPath,
          'ai-export',
          '--strategy',
          spec.strategy,
          '--runId',
          runId,
          '--partMonths',
          '0',
          '--keepChunks',
          'true',
        ],
        cwd,
        logPath: exportLogPath,
        onLine: (line) => {
          const match = line.match(/^part\d+:\s+(.+)$/);
          if (match) exportParts.push(path.resolve(cwd, match[1].trim()));
        },
      });
      if (!exportParts.length) {
        throw new Error(
          `AI export for ${variant.id} did not report output files`,
        );
      }
      const traceFiles = await listCoreResearchTraceFiles({
        strategyName: spec.strategy,
        runId,
        outDir: path.resolve(cwd, 'data/research/core/trace'),
      });
      resolvedVariants.push({
        ...variant,
        runId,
        files: exportParts,
        traceFiles: traceFiles.length ? traceFiles : variant.traceFiles,
      });
      await appendCoreResearchLedger({
        ledgerPath: prepared.paths.ledgerPath,
        researchId: spec.researchId,
        event: 'run_completed',
        specSha256: prepared.specSha256,
        hypothesisFamily: spec.hypothesis.family,
        artifactHashes: {
          [`runs/${variant.id}-backtest.log`]:
            await sha256File(backtestLogPath),
          [`runs/${variant.id}-export.log`]: await sha256File(exportLogPath),
          ...Object.fromEntries(
            await Promise.all(
              exportParts.map(async (filePath) => [
                path.basename(filePath),
                await sha256File(filePath),
              ]),
            ),
          ),
        },
      });
    } catch (error) {
      await appendCoreResearchLedger({
        ledgerPath: prepared.paths.ledgerPath,
        researchId: spec.researchId,
        event: 'run_failed',
        specSha256: prepared.specSha256,
        hypothesisFamily: spec.hypothesis.family,
      });
      throw error;
    }
  }
  await writeJsonAtomic(
    path.join(prepared.paths.researchDir, 'resolved-runs.json'),
    {
      schema: 'tradejs-core-research-resolved-runs/v1',
      researchId: spec.researchId,
      variants: resolvedVariants,
    },
  );
  return analyzeCoreResearch(spec, {
    prepared,
    variants: resolvedVariants,
  });
};
