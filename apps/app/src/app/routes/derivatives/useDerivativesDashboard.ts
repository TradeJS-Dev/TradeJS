'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '@tradejs/core/api';
import { toaster } from '#ui';
import {
  buildDerivativesDashboardRequest,
  FIXED_SYMBOLS,
  type ChartWindow,
} from './derivativesDashboardConfig';
import {
  buildDerivativesDashboardViewModel,
  type DerivativesInterval,
  type DetailResponse,
  type DetailRow,
  type PriceResponse,
  type PriceRow,
  type SummaryResponse,
} from './derivativesViewModel';

export const useDerivativesDashboard = () => {
  const [hours, setHours] = useState('24');
  const [selectedInterval, setSelectedInterval] =
    useState<DerivativesInterval>('1h');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [detailsBySymbol, setDetailsBySymbol] = useState<
    Record<string, DetailRow[]>
  >({});
  const [pricesBySymbol, setPricesBySymbol] = useState<
    Record<string, PriceRow[]>
  >({});
  const [chartWindow, setChartWindow] = useState<ChartWindow>(() => {
    const endTimestamp = Date.now();
    return {
      startTimestamp: endTimestamp - 24 * 60 * 60 * 1000,
      endTimestamp,
    };
  });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [detailError, setDetailError] = useState('');

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    const request = buildDerivativesDashboardRequest({
      hours,
      selectedInterval,
    });
    try {
      setSummary(await API.get<SummaryResponse>(request.summaryPath));
    } catch (error) {
      const message = (error as Error)?.message || 'Failed to load derivatives';
      setSummaryError(message);
      toaster.error({
        title: 'Failed to load derivatives',
        description: message,
      });
    } finally {
      setSummaryLoading(false);
    }
  }, [hours, selectedInterval]);

  const loadDetails = useCallback(async () => {
    setDetailLoading(true);
    setDetailError('');
    const request = buildDerivativesDashboardRequest({
      hours,
      selectedInterval,
    });
    try {
      const responses = await Promise.all(
        request.details.map(async (detailRequest) => {
          const [derivativesResponse, priceResponse] = await Promise.all([
            API.get<DetailResponse>(detailRequest.derivativesPath),
            API.post<PriceResponse>(
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
      );
      setDetailsBySymbol(
        Object.fromEntries(
          responses.map(([symbol, payload]) => [symbol, payload.detailRows]),
        ),
      );
      setPricesBySymbol(
        Object.fromEntries(
          responses.map(([symbol, payload]) => [symbol, payload.priceRows]),
        ),
      );
      setChartWindow(request.chartWindow);
    } catch (error) {
      const message =
        (error as Error)?.message ||
        'Failed to load symbol derivatives and price data';
      setDetailError(message);
      toaster.error({
        title: 'Failed to load derivative details',
        description: message,
      });
    } finally {
      setDetailLoading(false);
    }
  }, [hours, selectedInterval]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const dashboard = useMemo(
    () =>
      buildDerivativesDashboardViewModel({
        symbols: FIXED_SYMBOLS,
        selectedInterval,
        summary,
        detailsBySymbol,
        pricesBySymbol,
        summaryLoading,
        detailLoading,
        summaryError,
        detailError,
      }),
    [
      detailError,
      detailLoading,
      detailsBySymbol,
      pricesBySymbol,
      selectedInterval,
      summary,
      summaryError,
      summaryLoading,
    ],
  );

  return {
    hours,
    setHours,
    selectedInterval,
    setSelectedInterval,
    chartWindow,
    dashboard,
  };
};
