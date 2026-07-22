'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSignal } from '#actions/signal';
import type { Signal } from '@tradejs/types';

export type DashboardSignalStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'missing'
  | 'error';

type DashboardSignalState = {
  queryKey: string | null;
  signal: Signal | null;
  status: DashboardSignalStatus;
};

const INITIAL_STATE: DashboardSignalState = {
  queryKey: null,
  signal: null,
  status: 'idle',
};

export const useDashboardSignal = ({
  symbol,
  signalId,
}: {
  symbol: string;
  signalId: string | null;
}) => {
  const queryKey = useMemo(
    () => (symbol && signalId ? `${symbol}:${signalId}` : null),
    [signalId, symbol],
  );
  const [state, setState] = useState<DashboardSignalState>(INITIAL_STATE);

  useEffect(() => {
    let active = true;

    if (!queryKey || !signalId) {
      setState(INITIAL_STATE);
      return () => {
        active = false;
      };
    }

    setState({ queryKey, signal: null, status: 'loading' });

    void getSignal(symbol, signalId)
      .then((signal) => {
        if (!active) return;
        setState({
          queryKey,
          signal,
          status: signal ? 'loaded' : 'missing',
        });
      })
      .catch(() => {
        if (!active) return;
        setState({ queryKey, signal: null, status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [queryKey, signalId, symbol]);

  if (!queryKey) {
    return INITIAL_STATE;
  }

  if (state.queryKey !== queryKey) {
    return {
      queryKey,
      signal: null,
      status: 'loading' as const,
    };
  }

  return state;
};
