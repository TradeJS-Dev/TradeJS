import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import {
  fetchArkhamOnchainWindow,
  parseArkhamSymbolTokenIds,
  resolveArkhamTokenId,
} from '@tradejs/connectors';
import { normalizeOnchainIntervals } from '@tradejs/core/indicators';
import {
  upsertOnchainFlowRows,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import { getUserSettings } from '@tradejs/infra/userSettings';
import type { MarketFeatureInterval } from '@tradejs/types';

const intervalMs: Record<MarketFeatureInterval, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

args.example(
  'yarn ts-node ./src/scripts/onchainIngest --symbols BTCUSDT,ETHUSDT --intervals 15m,1h --hours 24',
  'Ingest Arkham on-chain flow context into Timescale',
);

args.option(['s', 'symbols'], 'Comma-separated symbols', 'BTCUSDT,ETHUSDT');
args.option(
  ['t', 'intervals'],
  'Comma-separated intervals: 1m,5m,15m,1h',
  '15m,1h',
);
args.option(['H', 'hours'], 'Lookback in hours', 24);
args.option(['U', 'user'], 'User settings profile name from Redis', 'root');
args.option(['c', 'chains'], 'Comma-separated Arkham chains', '');
args.option(
  ['m', 'tokenIds'],
  'Comma-separated SYMBOL=arkhamPricingId overrides',
  '',
);
args.option(
  ['e', 'cexEntities'],
  'Comma-separated CEX filters; default uses Arkham type:cex',
  '',
);
args.option(
  ['S', 'smartEntities'],
  'Comma-separated Arkham entities/addresses for smart-trader flow',
  '',
);
args.option(
  ['w', 'whaleEntities'],
  'Comma-separated Arkham entities/addresses for whale flow',
  '',
);
args.option(
  ['d', 'dexBases'],
  'Comma-separated entities/addresses used as /swaps base filters',
  '',
);
args.option(
  ['u', 'usdGte'],
  'Minimum historical USD value per Arkham query',
  0,
);
args.option(
  ['T', 'includeRecentTopFlow'],
  'Include /token/top_flow as recent-only whale fallback',
  false,
);
args.option(['l', 'topFlowLimit'], 'Top flow address limit', 10);
args.option(['M', 'maxWindows'], 'Safety cap per symbol/interval', 500);

const flags = args.parse(process.argv);

const normalizeList = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asNumberOrNull = (value: unknown) => {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const asBoolean = (value: unknown) =>
  ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );

export const main = async () => {
  const symbols = normalizeList(flags.symbols).map((symbol) =>
    symbol.toUpperCase(),
  );
  const intervals = normalizeOnchainIntervals(flags.intervals);
  const hours = asInt(flags.hours, 24);
  const maxWindows = asInt(flags.maxWindows, 500);
  const userName = String(flags.user || 'root').trim() || 'root';
  const settings = await getUserSettings(userName);
  const arkhamApiKey =
    settings.ARKHAM_API_KEY.trim() ||
    String(process.env.ARKHAM_API_KEY ?? '').trim();
  const tokenIds = {
    ...parseArkhamSymbolTokenIds(process.env.ARKHAM_TOKEN_IDS),
    ...parseArkhamSymbolTokenIds(flags.tokenIds),
  };
  const chains = normalizeList(flags.chains || process.env.ARKHAM_CHAINS);
  const cexEntities = normalizeList(
    flags.cexEntities || process.env.ARKHAM_CEX_ENTITIES,
  );
  const smartEntities = normalizeList(
    flags.smartEntities || process.env.ARKHAM_SMART_ENTITIES,
  );
  const whaleEntities = normalizeList(
    flags.whaleEntities || process.env.ARKHAM_WHALE_ENTITIES,
  );
  const dexBases = normalizeList(
    flags.dexBases || process.env.ARKHAM_DEX_BASES,
  );
  const usdGte = asNumberOrNull(flags.usdGte ?? process.env.ARKHAM_USD_GTE);
  const includeRecentTopFlow =
    asBoolean(flags.includeRecentTopFlow) ||
    asBoolean(process.env.ARKHAM_INCLUDE_RECENT_TOP_FLOW);
  const topFlowLimit = asInt(flags.topFlowLimit, 10);

  if (!symbols.length) throw new Error('No symbols provided');
  if (!intervals.length) throw new Error('No intervals provided');
  if (!arkhamApiKey) {
    throw new Error(
      `Missing ARKHAM_API_KEY in user settings/env for user ${userName}`,
    );
  }

  await waitForDbReady();

  const now = Date.now();
  const fromMs = now - hours * 60 * 60 * 1000;
  let totalRows = 0;

  for (const symbol of symbols) {
    for (const interval of intervals) {
      const stepMs = intervalMs[interval];
      let cursor = fromMs;
      let windows = 0;
      while (cursor < now && windows < maxWindows) {
        const toMs = Math.min(now, cursor + stepMs - 1);
        const tokenId = resolveArkhamTokenId(symbol, tokenIds);
        process.stdout.write(
          `\r${chalk.cyan('arkham')} ${chalk.yellow(symbol)} ${interval} ${new Date(cursor).toISOString()} .. ${new Date(toMs).toISOString()}   `,
        );

        const rows = await fetchArkhamOnchainWindow({
          symbol,
          tokenId,
          apiKey: arkhamApiKey,
          interval,
          fromMs: cursor,
          toMs,
          chains,
          cexEntities,
          smartEntities,
          whaleEntities,
          dexBases,
          usdGte,
          topFlowLimit,
          includeRecentTopFlow,
        });
        await upsertOnchainFlowRows(rows);
        totalRows += rows.length;
        cursor = toMs + 1;
        windows += 1;
      }
      process.stdout.write('\n');
      if (cursor < now) {
        console.warn(
          chalk.yellow(
            `Skipped remaining ${symbol} ${interval} windows after maxWindows=${maxWindows}`,
          ),
        );
      }
    }
  }

  console.log(chalk.green(`Done. provider=arkham onchain_rows=${totalRows}`));
};
