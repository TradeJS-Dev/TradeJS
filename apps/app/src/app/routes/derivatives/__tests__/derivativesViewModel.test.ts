import {
  buildDerivativesDashboardViewModel,
  type DetailRow,
  type SummaryResponse,
} from '../derivativesViewModel';

const symbols = ['BTCUSDT', 'ETHUSDT'] as const;

const makeDetailRow = (overrides: Partial<DetailRow> = {}): DetailRow => ({
  symbol: 'BTCUSDT',
  interval: '1h',
  ts: '2026-08-11T10:00:00.000Z',
  open_interest: 100,
  funding_rate: 0.0001,
  liq_long: 10,
  liq_short: 20,
  liq_total: 30,
  ...overrides,
});

describe('buildDerivativesDashboardViewModel', () => {
  it('derives metrics, chart data and market pressure from detail rows', () => {
    const detailsBySymbol = {
      BTCUSDT: [
        makeDetailRow(),
        makeDetailRow({
          ts: '2026-08-11T11:00:00.000Z',
          open_interest: 110,
          funding_rate: 0.0002,
          liq_long: 5,
          liq_short: 50,
          liq_total: 55,
        }),
      ],
      ETHUSDT: [],
    };

    const viewModel = buildDerivativesDashboardViewModel({
      symbols,
      selectedInterval: '1h',
      summary: { hours: 24, items: [] },
      detailsBySymbol,
      pricesBySymbol: {
        BTCUSDT: [{ close: 60_000, timestamp: 1_754_907_600_000 }],
        ETHUSDT: [],
      },
      summaryLoading: false,
      detailLoading: false,
      summaryError: '',
      detailError: '',
    });

    expect(viewModel.metricsBySymbol.BTCUSDT).toMatchObject({
      currentOpenInterest: 110,
      oiChange: 10,
      oiChangePct: 10,
      currentFundingRate: 0.0002,
      fundingChange: 0.0001,
      sumLiqLong: 15,
      sumLiqShort: 70,
      sumLiqTotal: 85,
    });
    expect(viewModel.chartDataBySymbol.BTCUSDT.derivatives[1]).toMatchObject({
      openInterest: 110,
      funding: 2,
      longLiquidations: -5,
      shortLiquidations: 50,
    });
    expect(viewModel.chartDataBySymbol.BTCUSDT.prices).toEqual([
      { price: 60_000, timestamp: 1_754_907_600_000 },
    ]);
    expect(viewModel.overviewRows[0].bias).toEqual({
      label: 'Short squeeze',
      tone: 'green',
    });
    expect(viewModel.noDetailData).toBe(false);
  });

  it('uses the selected summary interval when detail rows are unavailable', () => {
    const summary: SummaryResponse = {
      hours: 24,
      items: [
        {
          symbol: 'ETHUSDT',
          interval: '15m',
          points: 10,
          first_ts: '2026-08-11T09:00:00.000Z',
          last_ts: '2026-08-11T11:00:00.000Z',
          latest_open_interest: 200,
          first_open_interest: 180,
          oi_change: 20,
          oi_change_pct: 11.11,
          latest_funding_rate: -0.0001,
          first_funding_rate: -0.0002,
          funding_change: 0.0001,
          sum_liq_long: 5,
          sum_liq_short: 5,
          sum_liq_total: 10,
        },
      ],
    };

    const viewModel = buildDerivativesDashboardViewModel({
      symbols,
      selectedInterval: '15m',
      summary,
      detailsBySymbol: {},
      pricesBySymbol: {},
      summaryLoading: false,
      detailLoading: false,
      summaryError: '',
      detailError: '',
    });

    expect(viewModel.metricsBySymbol.ETHUSDT).toMatchObject({
      currentOpenInterest: 200,
      oiChange: 20,
      oiChangePct: 11.11,
    });
    expect(viewModel.noSummaryData).toBe(false);
    expect(viewModel.noDetailData).toBe(true);
  });
});
