export type DerivativesInterval = '15m' | '1h';

export type SummaryItem = {
  symbol: string;
  interval: DerivativesInterval;
  points: number;
  last_ts: string;
  first_ts: string;
  latest_open_interest: number | null;
  first_open_interest: number | null;
  oi_change: number | null;
  oi_change_pct: number | null;
  latest_funding_rate: number | null;
  first_funding_rate: number | null;
  funding_change: number | null;
  sum_liq_long: number | null;
  sum_liq_short: number | null;
  sum_liq_total: number | null;
};

export type SummaryResponse = {
  hours: number;
  items: SummaryItem[];
};

export type DetailRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: string;
  open_interest: number | null;
  funding_rate: number | null;
  liq_long: number | null;
  liq_short: number | null;
  liq_total: number | null;
};

export type DetailResponse = {
  rows: DetailRow[];
  symbol: string;
  interval: DerivativesInterval;
};

export type PriceRow = {
  close: number;
  timestamp: number;
};

export type PriceResponse = {
  data?: PriceRow[];
};

export type SymbolMetrics = {
  symbol: string;
  lastTs: string | null;
  currentOpenInterest: number | null;
  oiChange: number | null;
  oiChangePct: number | null;
  currentFundingRate: number | null;
  fundingChange: number | null;
  sumLiqLong: number | null;
  sumLiqShort: number | null;
  sumLiqTotal: number | null;
};

export type DerivativesChartRow = {
  timestamp: number;
  openInterest: number;
  funding: number;
  longLiquidations: number;
  shortLiquidations: number;
};

export type PriceChartRow = {
  price: number;
  timestamp: number;
};

type BiasTone = 'teal' | 'green' | 'red' | 'orange' | 'gray';

export type MarketBias = {
  label: string;
  tone: BiasTone;
};

export const toFiniteNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const mapRowsToChartRows = (rows: DetailRow[]): DerivativesChartRow[] =>
  rows.map((row) => ({
    timestamp: new Date(row.ts).getTime(),
    openInterest: toFiniteNumber(row.open_interest) ?? 0,
    funding: (toFiniteNumber(row.funding_rate) ?? 0) * 10_000,
    longLiquidations: -(toFiniteNumber(row.liq_long) ?? 0),
    shortLiquidations: toFiniteNumber(row.liq_short) ?? 0,
  }));

export const mapPriceRowsToChartRows = (rows: PriceRow[]): PriceChartRow[] =>
  rows.map((row) => ({
    price: toFiniteNumber(row.close) ?? 0,
    timestamp: row.timestamp,
  }));

const getBias = (metrics: SymbolMetrics): MarketBias => {
  const funding = toFiniteNumber(metrics.currentFundingRate) ?? 0;
  const oiChangePct = toFiniteNumber(metrics.oiChangePct) ?? 0;
  const longLiq = toFiniteNumber(metrics.sumLiqLong) ?? 0;
  const shortLiq = toFiniteNumber(metrics.sumLiqShort) ?? 0;

  if (shortLiq > longLiq * 1.35) {
    return { label: 'Short squeeze', tone: 'green' };
  }

  if (longLiq > shortLiq * 1.35) {
    return { label: 'Long flush', tone: 'red' };
  }

  if (oiChangePct > 1 && funding > 0) {
    return { label: 'Crowded longs', tone: 'orange' };
  }

  if (oiChangePct > 1 && funding < 0) {
    return { label: 'Crowded shorts', tone: 'teal' };
  }

  return { label: 'Balanced', tone: 'gray' };
};

const buildMetricsFromRows = (
  symbol: string,
  rows: DetailRow[],
  summaryRow?: SummaryItem,
): SymbolMetrics => {
  if (!rows.length) {
    return {
      symbol,
      lastTs: summaryRow?.last_ts ?? null,
      currentOpenInterest: summaryRow?.latest_open_interest ?? null,
      oiChange: summaryRow?.oi_change ?? null,
      oiChangePct: summaryRow?.oi_change_pct ?? null,
      currentFundingRate: summaryRow?.latest_funding_rate ?? null,
      fundingChange: summaryRow?.funding_change ?? null,
      sumLiqLong: summaryRow?.sum_liq_long ?? null,
      sumLiqShort: summaryRow?.sum_liq_short ?? null,
      sumLiqTotal: summaryRow?.sum_liq_total ?? null,
    };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstOi = toFiniteNumber(first.open_interest);
  const lastOi = toFiniteNumber(last.open_interest);
  const oiChange = firstOi != null && lastOi != null ? lastOi - firstOi : null;
  const oiChangePct =
    oiChange != null && firstOi != null && Math.abs(firstOi) > 0
      ? (oiChange / Math.abs(firstOi)) * 100
      : null;
  const firstFunding = toFiniteNumber(first.funding_rate);
  const lastFunding = toFiniteNumber(last.funding_rate);
  const fundingChange =
    firstFunding != null && lastFunding != null
      ? lastFunding - firstFunding
      : null;

  return rows.reduce<SymbolMetrics>(
    (metrics, row) => ({
      ...metrics,
      sumLiqLong: (metrics.sumLiqLong ?? 0) + Number(row.liq_long || 0),
      sumLiqShort: (metrics.sumLiqShort ?? 0) + Number(row.liq_short || 0),
      sumLiqTotal: (metrics.sumLiqTotal ?? 0) + Number(row.liq_total || 0),
    }),
    {
      symbol,
      lastTs: last.ts,
      currentOpenInterest: lastOi,
      oiChange,
      oiChangePct,
      currentFundingRate: lastFunding,
      fundingChange,
      sumLiqLong: 0,
      sumLiqShort: 0,
      sumLiqTotal: 0,
    },
  );
};

export const buildDerivativesDashboardViewModel = ({
  symbols,
  selectedInterval,
  summary,
  detailsBySymbol,
  pricesBySymbol,
  summaryLoading,
  detailLoading,
  summaryError,
  detailError,
}: {
  symbols: readonly string[];
  selectedInterval: DerivativesInterval;
  summary: SummaryResponse | null;
  detailsBySymbol: Record<string, DetailRow[]>;
  pricesBySymbol: Record<string, PriceRow[]>;
  summaryLoading: boolean;
  detailLoading: boolean;
  summaryError: string;
  detailError: string;
}) => {
  const filteredSummary = (summary?.items ?? []).filter(
    (item) =>
      item.interval === selectedInterval && symbols.includes(item.symbol),
  );
  const summaryBySymbol = Object.fromEntries(
    filteredSummary.map((item) => [item.symbol, item]),
  ) as Record<string, SummaryItem | undefined>;
  const metricsBySymbol = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      buildMetricsFromRows(
        symbol,
        detailsBySymbol[symbol] ?? [],
        summaryBySymbol[symbol],
      ),
    ]),
  ) as Record<string, SymbolMetrics>;
  const chartDataBySymbol = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      {
        derivatives: mapRowsToChartRows(detailsBySymbol[symbol] ?? []),
        prices: mapPriceRowsToChartRows(pricesBySymbol[symbol] ?? []),
      },
    ]),
  ) as Record<
    string,
    { derivatives: DerivativesChartRow[]; prices: PriceChartRow[] }
  >;

  return {
    metricsBySymbol,
    chartDataBySymbol,
    overviewRows: symbols.map((symbol) => ({
      symbol,
      metrics: metricsBySymbol[symbol],
      bias: getBias(metricsBySymbol[symbol]),
    })),
    noSummaryData:
      !summaryLoading && !summaryError && filteredSummary.length === 0,
    noDetailData:
      !detailLoading &&
      !detailError &&
      symbols.every((symbol) => (detailsBySymbol[symbol] ?? []).length === 0),
    showSkeleton: (summaryLoading || detailLoading) && !summary,
  };
};
