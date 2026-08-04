import args from 'args';
import { backfillHyperliquidWhaleContext } from '../lib/hyperliquidWhaleBackfill';

args.option(['d', 'days'], 'Historical lookback in days', 1);
args.option(['f', 'from'], 'Inclusive ISO timestamp');
args.option(['t', 'to'], 'Exclusive ISO timestamp');
args.option(
  ['c', 'cacheOnly'],
  'Do not call Hyperliquid when coverage is missing',
);

const flags = args.parse(process.argv);

const parseTime = (value: unknown, fallback: number) => {
  if (value == null || value === '') return fallback;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
};

export const main = async () => {
  const toMs = parseTime(flags.to, Date.now());
  const days = Number(flags.days);
  const lookbackMs =
    (Number.isFinite(days) && days > 0 ? days : 1) * 86_400_000;
  const startMs = parseTime(flags.from, toMs - lookbackMs);
  if (startMs >= toMs) throw new Error('--from must be before --to');
  const result = await backfillHyperliquidWhaleContext({
    startMs,
    endMs: toMs,
    cacheOnly: Boolean(flags.cacheOnly),
    log: console.log,
  });
  console.log(JSON.stringify(result, null, 2));
};
