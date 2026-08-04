#!/usr/bin/env node

import 'dotenv/config';
import { closeRedisConnection } from '@tradejs/infra/redis';
import { closeTimescalePool } from '@tradejs/infra/timescale';

type ScriptModule = {
  main?: () => Promise<unknown> | unknown;
};

type ScriptLoader = () => Promise<unknown>;

const scriptLoaders: Record<string, ScriptLoader> = {
  'agent-run': () => import('./scripts/agentRun'),
  'ai-export': () => import('./scripts/aiExport'),
  'ai-pocket-search': () => import('./scripts/aiPocketSearch'),
  'ai-train': () => import('./scripts/aiTrain'),
  backtest: () => import('./scripts/backtest'),
  'binance:breadth-universes:update': () =>
    import('./scripts/binanceBreadthUniversesUpdate'),
  'binance:market-ingest': () => import('./scripts/binanceMarketIngest'),
  bot: () => import('./scripts/bot'),
  'candles:migrate-provider': () => import('./scripts/candlesMigrateProvider'),
  'clean-dir': () => import('./scripts/cleanDir'),
  'clean-redis': () => import('./scripts/cleanRedis'),
  'clean-tests': () => import('./scripts/cleanTests'),
  continuity: () => import('./scripts/continuity'),
  'derivatives:ingest': () => import('./scripts/derivativesIngest'),
  'derivatives:ingest:coinalyze:all': () =>
    import('./scripts/derivativesIngestCoinalyzeAll'),
  doctor: () => import('./scripts/doctor'),
  'execution-calibration': () => import('./scripts/executionCalibration'),
  'infra-down': () => import('./scripts/infraDown'),
  'infra-init': () => import('./scripts/infraInit'),
  'infra-up': () => import('./scripts/infraUp'),
  'maintenance:cleanup-market-context': () =>
    import('./scripts/cleanupMarketContext'),
  migration: () => import('./scripts/migration'),
  'market-ws': () => import('./scripts/marketWs'),
  'hyperliquid:whale-backfill': () =>
    import('./scripts/hyperliquidWhaleBackfill'),
  'hyperliquid:whale-ingest': () => import('./scripts/hyperliquidWhaleIngest'),
  'hyperliquid:whales:update': () =>
    import('./scripts/hyperliquidWhalesUpdate'),
  'ml-export': () => import('./scripts/mlExport'),
  'ml-inspect': () => import('./scripts/mlInspect'),
  'ml-train:latest': () => import('./scripts/mlTrainLatestSelect'),
  'research:auto': () => import('./scripts/researchAuto'),
  results: () => import('./scripts/results'),
  'replay-runtime-evidence': () => import('./scripts/replayRuntimeEvidence'),
  'runtime-evidence': () => import('./scripts/runtimeEvidence'),
  'server-health': () => import('./scripts/serverHealth'),
  'runtime-parity': () => import('./scripts/runtimeParity'),
  signals: () => import('./scripts/signals'),
  'signals-daemon': () => import('./scripts/signalsDaemon'),
  replay: () => import('./scripts/replay'),
  'signals-summary': () => import('./scripts/signalsSummary'),
  'spread:ingest': () => import('./scripts/derivativesIngest'),
  'test-ml': () => import('./scripts/test-ml'),
  'test-script': () => import('./scripts/test'),
  'user-add': () => import('./scripts/user-add'),
};

const printUsage = () => {
  const commands = Object.keys(scriptLoaders).sort();
  console.log(
    `Usage: tradejs <command> [args]\\n\\nCommands:\\n${commands.join('\\n')}`,
  );
};

const runLoadedModule = async (loaded: unknown) => {
  const record = loaded as ScriptModule | null | undefined;
  if (typeof record?.main === 'function') {
    await record.main();
  }
};

const cleanupCliResources = async () => {
  await Promise.allSettled([closeRedisConnection(), closeTimescalePool()]);
};

const main = async () => {
  const [, scriptPath, command = '', ...args] = process.argv;
  const loader = scriptLoaders[command];
  if (!loader) {
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const nextArgs = [...args];
  if (command === 'spread:ingest') {
    nextArgs.push('--provider', 'binance_coinbase_spread');
  }

  process.argv = [process.argv[0], scriptPath, ...nextArgs];
  try {
    const loaded = await loader();
    await runLoadedModule(loaded);
  } finally {
    await cleanupCliResources();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { cleanupCliResources, main, printUsage, runLoadedModule };
