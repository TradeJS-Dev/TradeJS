import {
  buildDerivativesDashboardRequest,
  type ChartWindow,
} from './derivativesDashboardConfig';
import type {
  DerivativesInterval,
  DetailResponse,
  DetailRow,
  PriceResponse,
  PriceRow,
  SummaryResponse,
} from './derivativesViewModel';

export interface DerivativesDashboardClient {
  get<T>(url: string): Promise<T>;
  post<T>(url: string, body: object): Promise<T>;
}

export interface DerivativesDashboardData {
  summary: SummaryResponse;
  detailsBySymbol: Record<string, DetailRow[]>;
  pricesBySymbol: Record<string, PriceRow[]>;
  chartWindow: ChartWindow;
}

export const loadDerivativesDashboardData = async ({
  hours,
  selectedInterval,
  client,
  now,
}: {
  hours: string;
  selectedInterval: DerivativesInterval;
  client: DerivativesDashboardClient;
  now?: number;
}): Promise<DerivativesDashboardData> => {
  const request = buildDerivativesDashboardRequest({
    hours,
    selectedInterval,
    now,
  });
  const [summary, details] = await Promise.all([
    client.get<SummaryResponse>(request.summaryPath),
    Promise.all(
      request.details.map(async (detailRequest) => {
        const [derivativesResponse, priceResponse] = await Promise.all([
          client.get<DetailResponse>(detailRequest.derivativesPath),
          client.post<PriceResponse>(
            detailRequest.pricePath,
            detailRequest.priceBody,
          ),
        ]);
        return [
          detailRequest.symbol,
          {
            detailRows: derivativesResponse.rows,
            priceRows: priceResponse.data ?? [],
          },
        ] as const;
      }),
    ),
  ]);

  return {
    summary,
    detailsBySymbol: Object.fromEntries(
      details.map(([symbol, payload]) => [symbol, payload.detailRows]),
    ),
    pricesBySymbol: Object.fromEntries(
      details.map(([symbol, payload]) => [symbol, payload.priceRows]),
    ),
    chartWindow: request.chartWindow,
  };
};
