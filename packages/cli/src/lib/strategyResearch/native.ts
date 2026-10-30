import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type {
  AiDatasetRow,
  Connector,
  ConnectorCreator,
  Interval,
} from '@tradejs/types';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import {
  runAiPromptLocal,
  getDeterministicAiGateContext,
  buildAiPayload,
} from '@tradejs/node/ai';
import { buildResearchEntryPayload } from '@tradejs/node/backtest';
import { ensureStrategyPluginsLoaded } from '@tradejs/node/registry';
import { getConnectorCreatorByName } from '@tradejs/node/connectors';
import { readCoreResearchVariant } from '../coreResearch/dataset';
import { reconcileCoreResearchVariant } from '../coreResearch/reconciliation';
import { summarizeCoreResearchTrades, DAY_MS } from '../coreResearch/metrics';
import { sha256File, sha256Json, writeJsonAtomic } from '../coreResearch/io';
import { collectAiPocketFeatures } from '../aiPocketSearch';
import { extractSignalFromAiDatasetRow } from '../aiTrainDataset';
import type { CoreResearchVariant } from '../coreResearch/types';
import type {
  ResearchDataset,
  StrategyResearchBackend,
  StrategyResearchSpec,
} from './types';
import { boundResearchPath, readJson } from './io';
import { fingerprintResearchContextEnvironment } from '../aiTrainResearch';
import {
  measureResearchEvents,
  summarizeResearchEvents,
  type ResearchEventInput,
  type ResearchEventOutcome,
} from './events';
import { intervalToMs } from '@tradejs/core/data';
import { listCoreResearchTraceFiles } from '@tradejs/infra/coreResearch';
import { summarizeCoreResearchTrace } from '../coreResearch/trace';
import { parseJevConfig } from '@tradejs/core/jev';
import { resolveBacktestJev } from '../backtest/jevOptions';
import {
  loadBacktestRunManifest,
  loadBacktestCheckpointResults,
} from '../backtest/checkpoint';

const nativeConfig = (
  spec: StrategyResearchSpec,
  variant: CoreResearchVariant,
): Record<string, unknown> => ({
  ...variant.resolvedConfig,
  ENV: 'BACKTEST',
  INTERVAL: spec.core.execution.interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'open',
  BACKTEST_ENTRY_DELAY_BARS: spec.core.execution.entryDelayBars ?? 1,
});

/** Streaming log, argument-array spawn, process-group timeout, no shell. */
export const runResearchCommand = async (parameters: {
  executable: string;
  args: string[];
  cwd: string;
  log: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => Promise<void> | void;
  processReceipt?: string;
}) => {
  if (parameters.processReceipt) {
    try {
      const prior = await readJson<{ pid: number; status: string }>(
        parameters.processReceipt,
      );
      if (prior.status === 'running') {
        let alive = true;
        try {
          process.kill(prior.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
        }
        if (alive)
          throw new Error(
            `Previous native process is still running (pid=${prior.pid}); no duplicate launch`,
          );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const output = createWriteStream(parameters.log, { flags: 'a', mode: 0o600 });
  const child = spawn(parameters.executable, parameters.args, {
    cwd: parameters.cwd,
    env: { ...process.env, ...parameters.env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  void completion.catch(() => undefined);
  let callbacks = Promise.resolve();
  const capture = (stream: NodeJS.ReadableStream) => {
    const lines = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
    lines.on('line', (line) => {
      output.write(`${line}\n`);
      callbacks = callbacks.then(() => parameters.onLine?.(line));
      // Attach a rejection handler immediately; await the original chain below.
      void callbacks.catch(() => undefined);
    });
  };
  capture(child.stdout);
  capture(child.stderr);
  let interrupted = false;
  let killTimeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    interrupted = true;
    if (!child.pid) return;
    try {
      process.kill(
        process.platform === 'win32' ? child.pid : -child.pid,
        'SIGTERM',
      );
      killTimeout = setTimeout(() => {
        try {
          process.kill(
            process.platform === 'win32' ? child.pid! : -child.pid!,
            'SIGKILL',
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }, 5000);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const timeout = setTimeout(stop, parameters.timeoutMs);
  let ioError: Error | undefined;
  output.on('error', (error) => {
    ioError = error;
    stop();
  });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (parameters.processReceipt && child.pid)
      await writeJsonAtomic(parameters.processReceipt, {
        pid: child.pid,
        status: 'running',
        command: [parameters.executable, ...parameters.args],
        cwd: parameters.cwd,
        startedAt: new Date().toISOString(),
      });
    const code = await completion;
    await callbacks;
    if (ioError) throw ioError;
    if (code !== 0 || interrupted)
      throw new Error(
        `Native research command failed (${code ?? 'interrupted'}); see ${parameters.log}`,
      );
  } catch (error) {
    stop();
    await completion.catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimeout);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (!output.destroyed)
      await new Promise<void>((resolve, reject) => {
        output.once('error', reject);
        output.end(resolve);
      });
    if (parameters.processReceipt)
      await writeJsonAtomic(parameters.processReceipt, {
        pid: child.pid,
        status: 'finished',
        command: [parameters.executable, ...parameters.args],
        cwd: parameters.cwd,
        finishedAt: new Date().toISOString(),
      });
  }
};

export const createNativeStrategyResearchBackend = (parameters: {
  projectRoot: string;
  sourceRepositoryRoot: string;
  cliPath?: string;
}): StrategyResearchBackend => {
  const { projectRoot, sourceRepositoryRoot } = parameters;
  const cliPath = path.resolve(parameters.cliPath ?? process.argv[1]);
  let connector: Connector | undefined;
  const getConnector = async (spec: StrategyResearchSpec) => {
    if (connector) return connector;
    const creator = await getConnectorCreatorByName(
      spec.core.execution.connector,
      projectRoot,
    );
    if (!creator) throw new Error('Research connector is not registered');
    connector = await (creator as ConnectorCreator)({ userName: 'root' });
    return connector;
  };
  const assertResources = (spec: StrategyResearchSpec) => {
    const processes = execFileSync('ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    if (
      processes
        .split('\n')
        .some((line) => /(?:^|\/)testerWorker\.(?:js|ts)(?:\s|$)/.test(line))
    )
      throw new Error(
        'Tester workers are already active; research will resume when the host is free',
      );
    if (os.freemem() < spec.budget.minimumFreeMemoryMb * 1024 * 1024)
      throw new Error(
        'Insufficient free host memory for the frozen research budget',
      );
  };
  return {
    async selectPartition(spec, variant) {
      const timestamps = new Set<number>();
      let rows = 0;
      for (const file of variant.files) {
        const input = createReadStream(file);
        const lines = readline.createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            if (!line.trim()) continue;
            if (line.length > 2_000_000 || ++rows > spec.budget.maxRows)
              throw new Error(
                'Partition metadata exceeds the frozen dataset budget',
              );
            const row: unknown = JSON.parse(line);
            if (!row || typeof row !== 'object')
              throw new Error('Invalid timestamp metadata row');
            const timestamp = Reflect.get(row, 'timestamp');
            if (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
              throw new Error(
                'Partition metadata needs finite decision timestamps',
              );
            if (
              timestamp >= spec.core.window.start &&
              timestamp < spec.core.window.end
            )
              timestamps.add(timestamp);
          }
        } finally {
          lines.close();
          input.destroy();
        }
      }
      const ordered = [...timestamps].sort((a, b) => a - b);
      return {
        testSince:
          ordered.length >= 2
            ? ordered[
                Math.min(
                  ordered.length - 1,
                  Math.max(1, Math.floor(ordered.length * 0.6)),
                )
              ]
            : Math.floor(
                spec.core.window.start +
                  (spec.core.window.end - spec.core.window.start) * 0.6,
              ),
        events: ordered.length,
        method:
          ordered.length >= 2
            ? 'outer-60-40-timestamp-groups'
            : 'calendar-fallback-insufficient-events',
      };
    },
    async lineage() {
      const git = (args: string[]) =>
        execFileSync('git', args, {
          cwd: sourceRepositoryRoot,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        });
      const untracked = git(['ls-files', '--others', '--exclude-standard'])
        .trim()
        .split('\n')
        .filter(Boolean);
      const untrackedHashes = await Promise.all(
        untracked.map(async (file) => [
          file,
          await sha256File(path.join(sourceRepositoryRoot, file)),
        ]),
      );
      const requireFromRuntime = createRequire(cliPath);
      const hashes: Record<string, string> = {};
      const hashRuntimeDirectory = async (
        directory: string,
        label: string,
        root = directory,
      ): Promise<void> => {
        for (const entry of await fs.readdir(directory, {
          withFileTypes: true,
        })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory())
            await hashRuntimeDirectory(file, label, root);
          else if (/\.(?:m?js|cjs|json)$/.test(entry.name))
            hashes[`${label}:${path.relative(root, file)}`] =
              await sha256File(file);
        }
      };
      await hashRuntimeDirectory(path.dirname(cliPath), 'cli-runtime');
      for (const entry of [
        '@tradejs/node/backtest',
        '@tradejs/node/ai',
        '@tradejs/core/strategies',
      ]) {
        const resolved = requireFromRuntime.resolve(entry);
        const directory = path.dirname(resolved);
        await hashRuntimeDirectory(directory, entry);
      }
      const projectPackages = path.join(projectRoot, 'node_modules/@tradejs');
      for (const name of (await fs.readdir(projectPackages)).sort()) {
        const packageRoot = path.join(projectPackages, name);
        const visit = async (directory: string) => {
          for (const entry of await fs.readdir(directory, {
            withFileTypes: true,
          })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(file);
            else if (/\.(?:m?js|cjs|json)$/.test(entry.name))
              hashes[`installed:${name}:${path.relative(packageRoot, file)}`] =
                await sha256File(file);
          }
        };
        try {
          await visit(path.join(packageRoot, 'dist'));
          hashes[`installed:${name}:package.json`] = await sha256File(
            path.join(packageRoot, 'package.json'),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return {
        sourceRoot: await fs.realpath(sourceRepositoryRoot),
        projectRoot: await fs.realpath(projectRoot),
        sourceGitSha: git(['rev-parse', 'HEAD']).trim(),
        sourceDiffSha256: sha256Json(git(['diff', '--binary', 'HEAD'])),
        sourceUntrackedSha256: sha256Json(untrackedHashes),
        executableSha256: await sha256File(cliPath),
        executablePath: cliPath,
        runtimeSha256: sha256Json(hashes),
        contextEnvironmentSha256: fingerprintResearchContextEnvironment(),
        nodeVersion: process.versions.node,
      };
    },
    async preflight(spec) {
      assertResources(spec);
      const installed = createRequire(cliPath)(
        '@tradejs/node/backtest',
      ) as Record<string, unknown>;
      if (
        typeof installed.parseResearchEntryPolicy !== 'function' ||
        typeof installed.buildResearchEntryPayload !== 'function'
      )
        throw new Error(
          'The CLI runtime @tradejs/node does not support research entry policies; build/use a matching framework cohort before running',
        );
      await ensureStrategyPluginsLoaded();
      const directory = await boundResearchPath(
        projectRoot,
        `data/research/strategy/${spec.core.researchId}`,
      );
      await fs.writeFile(
        path.join(directory, 'source.patch'),
        execFileSync('git', ['diff', '--binary', 'HEAD'], {
          cwd: sourceRepositoryRoot,
          maxBuffer: 32 * 1024 * 1024,
        }),
      );
      execFileSync(
        'git',
        [
          'archive',
          '--format=tar',
          'HEAD',
          '--output',
          path.join(directory, 'source-baseline.tar'),
        ],
        { cwd: sourceRepositoryRoot },
      );
      const untracked = execFileSync(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        {
          cwd: sourceRepositoryRoot,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        },
      )
        .trim()
        .split('\n')
        .filter(Boolean);
      const sourceFiles: Array<{
        path: string;
        sha256: string;
        base64: string;
      }> = [];
      let sourceBytes = 0;
      for (const relative of untracked) {
        if (/(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key))$/i.test(relative))
          throw new Error(
            'Untracked credentials cannot be archived as research source',
          );
        const file = await boundResearchPath(sourceRepositoryRoot, relative);
        const content = await fs.readFile(file);
        sourceBytes += content.length;
        if (sourceBytes > 32 * 1024 * 1024)
          throw new Error('Untracked source archive exceeds 32 MiB');
        sourceFiles.push({
          path: relative,
          sha256: await sha256File(file),
          base64: content.toString('base64'),
        });
      }
      await writeJsonAtomic(
        path.join(directory, 'source-untracked.json'),
        sourceFiles,
      );
      const coverage: Array<{
        symbol: string;
        bars: number;
        first: number | null;
        last: number | null;
      }> = [];
      const provider = await getConnector(spec);
      for (const symbol of spec.core.universe.symbols) {
        const candles = await provider.kline({
          symbol,
          interval: spec.core.execution.interval as Interval,
          start: spec.core.window.start,
          end: spec.core.window.end,
          cacheOnly: true,
          silent: true,
        });
        coverage.push({
          symbol,
          bars: candles.length,
          first: candles[0]?.timestamp ?? null,
          last: candles.at(-1)?.timestamp ?? null,
        });
        if (!candles.length)
          throw new Error(
            `No cached history for ${symbol}; history refresh is a separate operation`,
          );
      }
      if (
        !coverage.some(
          (item) =>
            (item.last ?? 0) >=
            spec.core.window.end -
              2 * intervalToMs(spec.core.execution.interval as Interval),
        )
      )
        throw new Error(
          'Cached market history ends before the requested window; choose a covered end or explicitly refresh history',
        );
      return {
        coverage,
        universeBasis:
          'frozen-current-snapshot; historical listing membership is not inferred from candles',
        riskUnit: spec.core.execution.maxLossValue,
        sourcePatch: 'source.patch',
      };
    },
    async runVariant(
      spec,
      variant,
      directory,
      onRunId,
      previousRunId,
      confirmation,
    ) {
      if (variant.files.length) {
        return {
          ...variant,
          files: await Promise.all(
            variant.files.map((file) => boundResearchPath(projectRoot, file)),
          ),
        };
      }
      assertResources(spec);
      await fs.mkdir(directory, { recursive: true });
      const config = nativeConfig(spec, variant);
      const jev = parseJevConfig(config.JEV);
      if (jev?.source === 'provider')
        throw new Error(
          'Automatic research accepts recorded/local Jev only; provider inference needs a separate bounded experiment',
        );
      const jevArgs = jev
        ? [
            '--jev',
            ...(jev.source === 'recorded'
              ? ['--jevRecorded']
              : ['--jevModelFile', jev.modelFile!]),
            '--jevRecordsDir',
            jev.recordsDir ?? 'data/ai/jev',
          ]
        : [];
      if (jev) {
        const resolved = await resolveBacktestJev(
          {
            jev: true,
            jevRecorded: jev.source === 'recorded',
            jevModelFile: jev.source === 'local' ? jev.modelFile : undefined,
            jevRecordsDir: jev.recordsDir,
          },
          'root',
          projectRoot,
        );
        if (sha256Json(resolved) !== sha256Json(jev))
          throw new Error(
            'Jev model/provider/recording configuration differs from the frozen config',
          );
      }
      const configName = `${spec.core.strategy}:auto-${spec.core.researchId}-${variant.id}`;
      const grid = Object.fromEntries(
        Object.entries(config).map(([key, value]) => [key, [value]]),
      );
      const key = redisKeys.backtestConfig('root', configName);
      const existing: unknown = await getData(key, null);
      if (existing != null && sha256Json(existing) !== sha256Json(grid))
        throw new Error(`Frozen research config changed: ${configName}`);
      if (existing == null) await setData(key, grid, { expire: 0 });
      let runId = previousRunId ?? '';
      const common = {
        executable: process.execPath,
        cwd: projectRoot,
        timeoutMs: spec.budget.maxMinutes * 60_000,
        processReceipt: path.join(directory, 'native-process.json'),
        env: {
          PROJECT_CWD: projectRoot,
          TRADEJS_SOURCE_REPOSITORY_ROOT: sourceRepositoryRoot,
          BACKTEST_MAX_PARALLEL: String(spec.budget.parallel),
        },
      };
      const previousManifest = previousRunId
        ? await loadBacktestRunManifest({
            runId: previousRunId,
            userName: 'root',
          })
        : null;
      if (previousRunId && !previousManifest)
        throw new Error(
          'Recorded native run manifest is unavailable; do not start a replacement run implicitly',
        );
      if (previousManifest?.status !== 'completed')
        await runResearchCommand({
          ...common,
          log: path.join(directory, 'backtest.log'),
          args: [
            cliPath,
            'backtest',
            '--user',
            'root',
            '--config',
            configName,
            '--connector',
            spec.core.execution.connector,
            '--timeframe',
            spec.core.execution.interval,
            '--tickers',
            spec.core.universe.symbols.join(','),
            '--startTime',
            String(spec.core.window.start),
            '--endTime',
            String(spec.core.window.end),
            '--cacheOnly',
            ...(confirmation ? [] : ['--fast']),
            '--ai',
            '--researchTrace',
            '--parallel',
            String(spec.budget.parallel),
            '--backtestPriceMode',
            'open',
            '--backtestEntryDelayBars',
            String(spec.core.execution.entryDelayBars ?? 1),
            '--executionCosts',
            JSON.stringify(spec.core.execution.costs),
            ...jevArgs,
            ...(previousRunId ? ['--continue', '--runId', previousRunId] : []),
          ],
          onLine: async (line) => {
            const match = line.match(
              /backtest run id:\s*([0-9]{12}-[a-f0-9]{8})/i,
            );
            if (match) {
              runId = match[1];
              await onRunId(runId);
            }
          },
        });
      if (!runId)
        throw new Error('Native backtest did not return an immutable run id');
      const manifest = await loadBacktestRunManifest({
        runId,
        userName: 'root',
      });
      if (manifest?.status !== 'completed')
        throw new Error('Export requires a completed native manifest');
      const files: string[] = [];
      const completed = await loadBacktestCheckpointResults({
        runId,
        userName: 'root',
      });
      if (
        completed.length === manifest.testSuite.length &&
        completed.every((entry) => Number(entry.result.stat.orders) === 0)
      ) {
        const empty = path.join(directory, 'verified-empty.jsonl');
        await fs.writeFile(empty, '');
        files.push(empty);
      } else
        await runResearchCommand({
          ...common,
          log: path.join(directory, 'export.log'),
          args: [
            cliPath,
            'ai-export',
            '--strategy',
            spec.core.strategy,
            '--runId',
            runId,
            '--partMonths',
            '0',
            '--keepChunks',
            'true',
          ],
          onLine: (line) => {
            const match = line.match(/^part\d+:\s+(.+)$/);
            if (match) files.push(path.resolve(projectRoot, match[1].trim()));
          },
        });
      if (!files.length)
        throw new Error(
          'Native export did not return run-bound files (including zero-trade exports)',
        );
      const resolved = {
        ...variant,
        configName,
        runId,
        files,
        resolvedConfig: config,
        configSha256: sha256Json(config),
      };
      await writeJsonAtomic(
        path.join(directory, 'sources.json'),
        Object.fromEntries(
          await Promise.all(
            files.map(async (file) => [file, await sha256File(file)]),
          ),
        ),
      );
      return resolved;
    },
    async loadDataset(spec, variant, directory, discoveryOnly) {
      // Validate row/line budgets before the existing normalized reader materializes trades.
      let count = 0;
      for (const file of variant.files) {
        const input = createReadStream(file);
        const lines = readline.createInterface({
          input,
          crlfDelay: Infinity,
        });
        try {
          for await (const line of lines) {
            if (
              line.length > 2_000_000 ||
              (line.trim() && ++count > spec.budget.maxRows)
            )
              throw new Error(
                'Research dataset exceeds the frozen row/record budget',
              );
          }
        } finally {
          lines.close();
          input.destroy();
        }
      }
      const loaded = await readCoreResearchVariant(variant);
      if (
        loaded.files.some((file) => file.rowsForDifferentRun > 0) ||
        loaded.trades.some(
          (trade) =>
            trade.strategy !== spec.core.strategy ||
            !spec.core.universe.symbols.includes(trade.symbol),
        )
      )
        throw new Error(
          'Dataset contains foreign strategy, run or symbol identities',
        );
      const reconciliation = await reconcileCoreResearchVariant({
        variant,
        spec: spec.core,
        exportMetrics: summarizeCoreResearchTrades(
          loaded.trades,
          (spec.core.window.end - spec.core.window.start) / DAY_MS,
        ),
      });
      await writeJsonAtomic(
        path.join(directory, 'reconciliation.json'),
        reconciliation,
      );
      if (reconciliation.status !== 'match')
        throw new Error(
          `Native/export reconciliation is ${reconciliation.status}: ${reconciliation.reasons.join('; ')}`,
        );
      const trades = loaded.trades.filter(
        (trade) =>
          trade.signalTimestamp >= spec.core.window.start &&
          trade.signalTimestamp < spec.core.window.end &&
          trade.exitTimestamp < spec.core.window.end,
      );
      const tradeBySignal = new Map(
        trades.map((trade) => [trade.signalId, trade]),
      );
      const rows: ResearchDataset['rows'] = [];
      const sampleInputs = new Map<string, AiDatasetRow>();
      const eventInputs: ResearchEventInput[] = [];
      const pathCoverage = Object.fromEntries(
        spec.diagnostics.requiredPaths.map((key) => [key, 0]),
      );
      let purgedLabels = 0;
      let featureValues = 0;
      const sampleBuckets = new Map<string, string[]>();
      const seen = new Set<string>();
      for (const file of variant.files) {
        const input = createReadStream(file);
        const lines = readline.createInterface({
          input,
          crlfDelay: Infinity,
        });
        try {
          for await (const line of lines) {
            if (!line.trim()) continue;
            const row: AiDatasetRow = JSON.parse(line);
            const trade = tradeBySignal.get(row.signalId);
            if (!trade || seen.has(row.signalId)) continue;
            seen.add(row.signalId);
            if (
              discoveryOnly &&
              (row.timestamp >= spec.testSince ||
                trade.exitTimestamp >= spec.testSince)
            ) {
              if (row.timestamp < spec.testSince) purgedLabels++;
              continue;
            }
            const signal = extractSignalFromAiDatasetRow(row);
            const snapshot = row.research?.decisionContext;
            if (snapshot) {
              if (
                snapshot.schema !== 'tradejs-research-decision-context/v1' ||
                !Number.isFinite(snapshot.knownAt) ||
                snapshot.knownAt > row.timestamp
              )
                throw new Error('Invalid research decision-context provenance');
              signal.additionalIndicators = {
                ...signal.additionalIndicators,
                baseContext: snapshot.baseContext,
              };
            }
            const originalPayload = buildAiPayload(signal);
            const payload = buildResearchEntryPayload(signal, originalPayload);
            const analysis = await runAiPromptLocal(signal, {
              payload: originalPayload,
            });
            const gateContext = getDeterministicAiGateContext(originalPayload);
            const features = collectAiPocketFeatures({
              payload,
              featurePolicy: 'causal-stationary',
              featureProfile: 'all',
            });
            // Only direct, signal-time payload paths can be executed by a frozen policy.
            for (const key of Object.keys(features))
              if (
                !key.startsWith('additionalIndicators.') ||
                features[key] == null
              )
                delete features[key];
            featureValues += Object.keys(features).length;
            if (featureValues > 5_000_000)
              throw new Error('Research feature memory budget exceeded');
            const additional = payload.additionalIndicators as
              | Record<string, unknown>
              | undefined;
            const base = additional?.baseContext as
              | { candle?: { timestamp?: number } }
              | undefined;
            const timestamp = base?.candle?.timestamp;
            if (typeof timestamp !== 'number' || timestamp > row.timestamp)
              throw new Error('Missing or future BaseContext timestamp');
            for (const key of spec.diagnostics.requiredPaths) {
              const field = key
                .split('.')
                .reduce<unknown>(
                  (current, part) =>
                    current && typeof current === 'object'
                      ? Reflect.get(current, part)
                      : undefined,
                  base,
                );
              if (
                field != null &&
                field !== 'unknown' &&
                (typeof field !== 'number' || Number.isFinite(field))
              )
                pathCoverage[key]++;
            }
            rows.push({
              signalId: row.signalId,
              symbol: row.symbol,
              strategy: row.strategyName,
              timestamp: row.timestamp,
              exitTimestamp: trade.exitTimestamp,
              direction: row.direction,
              profit: trade.netProfit,
              profitableTrade: trade.netProfit > 0,
              modelCandidate:
                !Array.isArray(gateContext?.structuralHardBlockReasons) ||
                !gateContext.structuralHardBlockReasons.length,
              aiApproved:
                analysis.direction === row.direction &&
                Number(analysis.quality) >= spec.minQuality,
              quality:
                typeof analysis.quality === 'number' ? analysis.quality : null,
              features,
            });
            if (discoveryOnly) {
              eventInputs.push({
                signalId: row.signalId,
                timestamp: row.timestamp,
                symbol: row.symbol,
                direction: row.direction,
                price: row.payload.signal.prices.currentPrice,
                risk: Math.abs(
                  row.payload.signal.prices.currentPrice -
                    row.payload.signal.prices.stopLossPrice,
                ),
              });
              const key = `${row.direction}:${trade.netProfit > 0}`;
              const bucket = sampleBuckets.get(key) ?? [];
              bucket.push(row.signalId);
              sampleInputs.set(row.signalId, row);
              bucket.sort((a, b) => sha256Json(a).localeCompare(sha256Json(b)));
              while (bucket.length > spec.diagnostics.samplePerSideAndOutcome)
                sampleInputs.delete(bucket.pop()!);
              sampleBuckets.set(key, bucket);
            }
          }
        } finally {
          lines.close();
          input.destroy();
        }
      }
      const contextCoverage = Object.fromEntries(
        Object.entries(pathCoverage).map(([key, value]) => [
          key,
          rows.length ? value / rows.length : 0,
        ]),
      );
      if (
        rows.length &&
        Object.values(contextCoverage).some(
          (fraction) => fraction < spec.diagnostics.minimumContextCoverage,
        )
      )
        throw new Error(
          'BaseContext coverage is below the frozen minimum; inspect reconciliation and input context',
        );
      const samples: ResearchDataset['samples'] = [];
      const eventOutcomes: ResearchEventOutcome[] = [];
      if (discoveryOnly && eventInputs.length) {
        const provider = await getConnector(spec);
        const grouped = new Map<string, ResearchEventInput[]>();
        for (const input of eventInputs) {
          const group = grouped.get(input.symbol) ?? [];
          group.push(input);
          grouped.set(input.symbol, group);
        }
        for (const [symbol, events] of grouped) {
          const intervalMs = intervalToMs(
            spec.core.execution.interval as Interval,
          );
          const candles = await provider.kline({
            symbol,
            interval: spec.core.execution.interval as Interval,
            start: spec.core.window.start - 120 * intervalMs,
            end: spec.testSince - 1,
            cacheOnly: true,
            silent: true,
          });
          if (eventInputs.length * spec.diagnostics.horizons.length > 1_000_000)
            throw new Error('Event-study memory budget exceeded');
          for (const outcome of measureResearchEvents(
            events,
            candles,
            spec.diagnostics.horizons,
            intervalMs,
            spec.testSince,
          ))
            eventOutcomes.push(outcome);
        }
        for (const side of ['LONG', 'SHORT'])
          for (const wins of [false, true]) {
            const selected = rows
              .filter(
                (row) => row.direction === side && row.profitableTrade === wins,
              )
              .sort((a, b) =>
                sha256Json(a.signalId).localeCompare(sha256Json(b.signalId)),
              )
              .slice(0, spec.diagnostics.samplePerSideAndOutcome);
            for (const row of selected) {
              const trade = tradeBySignal.get(row.signalId!);
              const original = sampleInputs.get(row.signalId!);
              if (!trade || !original) continue;
              const intervalMs = intervalToMs(
                spec.core.execution.interval as Interval,
              );
              const candles = await provider.kline({
                symbol: trade.symbol,
                interval: spec.core.execution.interval as Interval,
                start: trade.signalTimestamp - 40 * intervalMs,
                end: Math.min(
                  spec.testSince - 1,
                  trade.signalTimestamp +
                    Math.max(...spec.diagnostics.horizons) * intervalMs,
                ),
                cacheOnly: true,
                silent: true,
              });
              samples.push({
                trade,
                candles,
                stop: original.payload.signal.prices.stopLossPrice ?? null,
                target: original.payload.signal.prices.takeProfitPrice ?? null,
              });
            }
          }
      }
      const traceFiles = variant.runId
        ? await listCoreResearchTraceFiles({
            strategyName: spec.core.strategy,
            runId: variant.runId,
            outDir: path.join(projectRoot, 'data/research/core/trace'),
          })
        : [];
      const funnel = traceFiles.length
        ? await summarizeCoreResearchTrace(traceFiles)
        : null;
      if (
        variant.configName ===
        `${spec.core.strategy}:auto-${spec.core.researchId}-${variant.id}`
      )
        await writeJsonAtomic(
          path.join(directory, 'payloads.json'),
          Object.fromEntries(
            await Promise.all(
              traceFiles.map(async (file) => [file, await sha256File(file)]),
            ),
          ),
        );
      return {
        variant,
        trades: discoveryOnly
          ? trades.filter(
              (trade) =>
                trade.signalTimestamp < spec.testSince &&
                trade.exitTimestamp < spec.testSince,
            )
          : trades,
        rows,
        samples,
        contextCoverage,
        purgedLabels,
        funnel,
        ...(discoveryOnly
          ? {
              eventStudy: summarizeResearchEvents(
                eventOutcomes,
                spec.diagnostics.horizons,
                spec.core.window.start,
                spec.testSince,
              ),
            }
          : {}),
      };
    },
  };
};
