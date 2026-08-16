'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { API } from '@tradejs/core/api';
import { toaster } from '#ui';
import { FIXED_SYMBOLS, type ChartWindow } from './derivativesDashboardConfig';
import { loadDerivativesDashboardData } from './derivativesDashboardLoader';
import {
  buildDerivativesDashboardViewModel,
  type DerivativesInterval,
  type DetailRow,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRevision = useRef(0);

  useEffect(() => {
    const revision = ++requestRevision.current;
    setLoading(true);
    setError('');

    void loadDerivativesDashboardData({
      hours,
      selectedInterval,
      client: API,
    })
      .then((data) => {
        if (requestRevision.current !== revision) return;
        setSummary(data.summary);
        setDetailsBySymbol(data.detailsBySymbol);
        setPricesBySymbol(data.pricesBySymbol);
        setChartWindow(data.chartWindow);
      })
      .catch((loadError) => {
        if (requestRevision.current !== revision) return;
        const message =
          (loadError as Error)?.message || 'Failed to load derivatives';
        setError(message);
        toaster.error({
          title: 'Failed to load derivatives',
          description: message,
        });
      })
      .finally(() => {
        if (requestRevision.current === revision) setLoading(false);
      });

    return () => {
      if (requestRevision.current === revision) requestRevision.current += 1;
    };
  }, [hours, selectedInterval]);

  const dashboard = useMemo(
    () =>
      buildDerivativesDashboardViewModel({
        symbols: FIXED_SYMBOLS,
        selectedInterval,
        summary,
        detailsBySymbol,
        pricesBySymbol,
        summaryLoading: loading,
        detailLoading: loading,
        summaryError: error,
        detailError: error,
      }),
    [
      detailsBySymbol,
      error,
      loading,
      pricesBySymbol,
      selectedInterval,
      summary,
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
