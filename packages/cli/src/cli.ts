#!/usr/bin/env node

type ScriptLoader = () => Promise<unknown>;

const scriptLoaders: Record<string, ScriptLoader> = {
  backtest: () => import('./scripts/backtest'),
  bot: () => import('./scripts/bot'),
  'clean-dir': () => import('./scripts/cleanDir'),
  'clean-redis': () => import('./scripts/cleanRedis'),
  'clean-tests': () => import('./scripts/cleanTests'),
  continuity: () => import('./scripts/continuity'),
  'derivatives:ingest': () => import('./scripts/derivativesIngest'),
  'derivatives:ingest:coinalyze:all': () =>
    import('./scripts/derivativesIngestCoinalyzeAll'),
  doctor: () => import('./scripts/doctor'),
  'infra-down': () => import('./scripts/infraDown'),
  'infra-init': () => import('./scripts/infraInit'),
  'infra-up': () => import('./scripts/infraUp'),
  migration: () => import('./scripts/migration'),
  'ml-export': () => import('./scripts/mlExportSelect'),
  'ml-inspect': () => import('./scripts/mlInspect'),
  'ml-train:latest': () => import('./scripts/mlTrainLatestSelect'),
  results: () => import('./scripts/results'),
  signals: () => import('./scripts/signals'),
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
  await loader();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
