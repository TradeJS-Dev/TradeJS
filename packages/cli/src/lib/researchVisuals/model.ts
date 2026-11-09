export interface VisualCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [key: string]: number | null;
}
export interface VisualPoint {
  timestamp: number;
  value: number;
}
export interface VisualFigures {
  lines: Array<{ points: VisualPoint[] }>;
  points: Array<{ points: VisualPoint[] }>;
  zones: Array<{ start: VisualPoint; end: VisualPoint }>;
}
export interface VisualTrade {
  id: string;
  strategy: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  signalTime: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  stop: number | null;
  target: number | null;
  pockets: Record<string, boolean>;
  features: Record<string, number>;
  groups: Record<string, string>;
  candles: VisualCandle[];
  figures: VisualFigures;
}
export interface VisualDataset {
  schema: 'tradejs-research-visuals/v1';
  population: 'complete' | 'selected';
  source: string;
  intervalMs: number;
  trades: VisualTrade[];
}
export const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const number = (v: unknown, label: string) => {
  if (!finite(v)) throw new Error(`Invalid ${label}`);
  return v;
};
const text = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing ${label}`);
  return v;
};
const time = (v: unknown, label: string) => {
  const n = number(v, label);
  if (!Number.isSafeInteger(n) || n < 0 || n > 8.64e15)
    throw new Error(`Invalid ${label}`);
  return n;
};
const nullable = (v: unknown) => (v == null ? null : number(v, 'price'));
const point = (v: unknown): VisualPoint => {
  const p = object(v);
  return {
    timestamp: time(p.timestamp, 'point timestamp'),
    value: number(p.value, 'point value'),
  };
};
export function normalizeFigures(v: unknown): VisualFigures {
  const f = object(v);
  const groups = (key: string) =>
    (Array.isArray(f[key]) ? f[key] : []).map((g) => {
      const a = object(g);
      return { points: (Array.isArray(a.points) ? a.points : []).map(point) };
    });
  return {
    lines: groups('lines'),
    points: groups('points'),
    zones: (Array.isArray(f.zones) ? f.zones : []).map((z) => ({
      start: point(object(z).start),
      end: point(object(z).end),
    })),
  };
}
export function normalizeCandles(v: unknown): VisualCandle[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('Candles must be an array');
  const out = v
    .map((raw) => {
      const b = object(raw);
      const c: VisualCandle = {
        timestamp: time(b.timestamp, 'candle timestamp'),
        open: number(b.open, 'open'),
        high: number(b.high, 'high'),
        low: number(b.low, 'low'),
        close: number(b.close, 'close'),
        volume: number(b.volume, 'volume'),
      };
      if (
        c.low > Math.min(c.open, c.close) ||
        c.high < Math.max(c.open, c.close) ||
        c.low > c.high ||
        c.low <= 0 ||
        c.volume < 0
      )
        throw new Error('Invalid OHLCV');
      for (const key of ['smaFast', 'smaSlow', 'bbUpper', 'bbLower'])
        if (b[key] != null) c[key] = number(b[key], key);
      return c;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  if (out.some((b, i) => i > 0 && b.timestamp === out[i - 1].timestamp))
    throw new Error('Duplicate candle timestamp');
  return out;
}
export function normalizeTrade(
  raw: unknown,
  fallbackStrategy: string,
  candlesBySymbol: Record<string, VisualCandle[]> = {},
): VisualTrade {
  const r = object(raw),
    payload = object(r.payload),
    s = object(payload.signal),
    t = object(r.trade ?? r.tradeResult),
    prices = object(r.prices ?? s.prices),
    features: Record<string, number> = {},
    pockets: Record<string, boolean> = {},
    groups: Record<string, string> = {};
  for (const [key, value] of Object.entries(object(r.features)))
    if (finite(value)) features[key] = value;
    else throw new Error(`Invalid feature ${key}`);
  const snapshot = object(payload.featureSnapshot),
    values = object(snapshot.values);
  for (const def of Array.isArray(snapshot.definitions)
    ? snapshot.definitions
    : []) {
    const d = object(def);
    const value = typeof d.id === 'string' ? values[d.id] : undefined;
    if (d.role === 'input' && typeof d.id === 'string' && finite(value))
      features[d.id] = value;
  }
  for (const [key, value] of Object.entries(object(r.pockets))) {
    if (typeof value !== 'boolean') throw new Error(`Invalid pocket ${key}`);
    pockets[key] = value;
  }
  if (typeof r.approved === 'boolean') pockets.nativeGate = r.approved;
  for (const [key, value] of Object.entries(object(r.groups))) {
    if (typeof value !== 'string') throw new Error(`Invalid group ${key}`);
    groups[key] = value;
  }
  const additional = object(payload.additionalIndicators),
    profile = object(
      additional.tickerProfile ?? object(additional.baseContext).tickerProfile,
    );
  for (const key of [
    'moneyGroup',
    'volatilityGroup',
    'btcCorrelationGroup',
    'ethCorrelationGroup',
  ])
    if (typeof profile[key] === 'string') groups[key] = profile[key];
  const direction = r.direction ?? s.direction;
  if (direction !== 'LONG' && direction !== 'SHORT')
    throw new Error('Invalid trade direction');
  const symbol = text(r.symbol ?? s.symbol, 'symbol');
  if (!symbol.endsWith('USDT'))
    throw new Error(`Only USDT contracts: ${symbol}`);
  const strategy = text(
    r.strategy ?? r.strategyName ?? s.strategy ?? fallbackStrategy,
    'strategy',
  );
  const entryTime = time(r.entryTime ?? t.entryTimestamp, 'entryTime'),
    exitTime = time(r.exitTime ?? t.exitTimestamp, 'exitTime'),
    signalTime = time(r.signalTime ?? r.timestamp ?? s.timestamp, 'signalTime');
  if (exitTime < entryTime || entryTime < signalTime)
    throw new Error('Invalid trade chronology');
  const entryPrice = number(r.entryPrice ?? t.entryPrice, 'entryPrice'),
    exitPrice = number(r.exitPrice ?? t.exitPrice, 'exitPrice');
  if (entryPrice <= 0 || exitPrice <= 0)
    throw new Error('Invalid execution price');
  return {
    id: text(
      r.id ??
        r.key ??
        `${strategy}:${symbol}:${direction}:${text(r.signalId ?? s.signalId, 'signalId')}:${entryTime}:${exitTime}`,
      'trade id',
    ),
    strategy,
    symbol,
    direction,
    entryTime,
    exitTime,
    signalTime,
    entryPrice,
    exitPrice,
    pnl: number(r.pnl ?? t.netProfit, 'net PnL'),
    stop: nullable(r.stop ?? prices.stopLossPrice),
    target: nullable(r.target ?? prices.takeProfitPrice),
    pockets,
    features,
    groups,
    candles:
      r.candles === undefined
        ? candlesBySymbol[symbol] ?? []
        : normalizeCandles(r.candles),
    figures: normalizeFigures(r.figures ?? payload.figures),
  };
}
export function normalizeDataset(
  input: unknown,
  options: {
    population?: 'complete' | 'selected';
    intervalMs?: number;
    strategy?: string;
    source?: string;
    candlesBySymbol?: Record<string, unknown>;
  } = {},
): VisualDataset {
  const root = object(input);
  const archived = root.schema === 'trade-atlas-chart-points/v1';
  if (
    !Array.isArray(input) &&
    !archived &&
    root.schema !== 'tradejs-research-visuals/v1'
  )
    throw new Error('Unsupported research visual schema');
  const population =
    archived || root.population === 'selected'
      ? 'selected'
      : options.population ?? root.population;
  if (population !== 'complete' && population !== 'selected')
    throw new Error('Declare population: complete or selected');
  const intervalMs =
    options.intervalMs ??
    (archived ? Number(root.timeframe) * 60000 : root.intervalMs);
  if (
    !finite(intervalMs) ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0
  )
    throw new Error('Positive intervalMs is required');
  const rows = Array.isArray(input)
    ? input
    : archived
      ? root.cards
      : root.trades;
  if (!Array.isArray(rows)) throw new Error('Trades must be an array');
  const runs = new Set(
    rows.map((r) => object(r).backtestRunId).filter(Boolean),
  );
  if (runs.size > 1)
    throw new Error('Mixed backtest runs; provide one immutable lineage');
  const candlesBySymbol = Object.fromEntries(
    Object.entries(options.candlesBySymbol ?? object(root.candlesBySymbol)).map(
      ([symbol, candles]) => [symbol, normalizeCandles(candles)],
    ),
  );
  const trades = rows.map((r) =>
    normalizeTrade(
      r,
      options.strategy ?? String(root.strategy ?? ''),
      candlesBySymbol,
    ),
  );
  const ids = new Set<string>();
  for (const t of trades) {
    const key = `${t.strategy}:${t.id}`;
    if (ids.has(key)) throw new Error(`Duplicate trade: ${key}`);
    ids.add(key);
  }
  return {
    schema: 'tradejs-research-visuals/v1',
    population,
    source:
      options.source ??
      String(root.source ?? root.runId ?? [...runs][0] ?? 'caller-supplied'),
    intervalMs,
    trades,
  };
}

/** Bound per-chart work without rescanning or copying shared market history. */
export function tradeCandleWindow(
  trade: VisualTrade,
  intervalMs: number,
): VisualCandle[] {
  const lowerBound = (timestamp: number) => {
    let lo = 0,
      hi = trade.candles.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (trade.candles[mid].timestamp < timestamp) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return trade.candles.slice(
    lowerBound(trade.signalTime - 140 * intervalMs),
    lowerBound(trade.exitTime + 20 * intervalMs + 1),
  );
}
