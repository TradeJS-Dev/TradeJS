import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import {
  DerivativesInterval,
  upsertDerivatives,
  upsertSpreadRows,
  waitForDbReady,
} from '@utils/timescale';
import {
  normalizeCoinalyzeSymbols,
  normalizeDerivativesIntervals,
} from '@utils/derivativesCoinalyze';
import {
  marketDataProviders,
  MarketDataProviderName,
} from '@src/marketData/providers';

args.example(
  'yarn ts-node ./src/scripts/derivativesIngest --provider coinalyze --symbols BTCUSDT,ETHUSDT --intervals 15m,1h --days 120',
  'Ingest market features (derivatives/spread) into Timescale by provider',
);

args.option(['s', 'symbols'], 'Comma-separated symbols', 'BTCUSDT,ETHUSDT');
args.option(['t', 'intervals'], 'Comma-separated intervals: 15m,1h', '15m,1h');
args.option(['d', 'days'], 'Lookback in days', 120);
args.option(
  ['p', 'provider'],
  'Provider name: coinalyze | binance_coinbase_spread',
  'coinalyze',
);
args.option(['b', 'batchDays'], 'Request chunk size in days', 7);

const flags = args.parse(process.argv);

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const run = async () => {
  const providerName = String(flags.provider || 'coinalyze')
    .trim()
    .toLowerCase() as MarketDataProviderName;
  const provider = marketDataProviders[providerName];
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerName}`);
  }

  const symbols = normalizeCoinalyzeSymbols(flags.symbols);
  const intervals: DerivativesInterval[] = normalizeDerivativesIntervals(
    flags.intervals,
  );
  const days = asInt(flags.days, 120);
  const batchDays = asInt(flags.batchDays, 7);

  if (!symbols.length) throw new Error('No symbols provided');
  if (!intervals.length) throw new Error('No intervals provided');

  await waitForDbReady();

  const now = Date.now();
  const fromMs = now - days * 24 * 60 * 60 * 1000;

  let totalDerivativesRows = 0;
  let totalSpreadRows = 0;

  for (const symbol of symbols) {
    for (const interval of intervals) {
      let cursor = fromMs;
      while (cursor < now) {
        const toMs = Math.min(now, cursor + batchDays * 24 * 60 * 60 * 1000);
        process.stdout.write(
          `\r${chalk.cyan(providerName)} ${chalk.yellow(symbol)} ${interval} ${new Date(cursor).toISOString()} .. ${new Date(toMs).toISOString()}   `,
        );

        const window = await provider.fetchWindow({
          symbol,
          interval,
          fromMs: cursor,
          toMs,
        });

        const derivativesRows = window.derivativesRows ?? [];
        if (derivativesRows.length) {
          await upsertDerivatives(derivativesRows);
          totalDerivativesRows += derivativesRows.length;
        }

        const spreadRows = window.spreadRows ?? [];
        if (spreadRows.length) {
          await upsertSpreadRows(spreadRows);
          totalSpreadRows += spreadRows.length;
        }

        cursor = toMs + 1;
      }
      process.stdout.write('\n');
    }
  }

  console.log(
    chalk.green(
      `Done. provider=${providerName} derivatives_rows=${totalDerivativesRows} spread_rows=${totalSpreadRows}`,
    ),
  );
};

run().catch((error) => {
  console.error(chalk.red(`derivativesIngest failed: ${error}`));
  process.exit(1);
});
