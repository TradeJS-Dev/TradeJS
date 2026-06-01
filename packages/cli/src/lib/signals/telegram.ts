import type { Signal } from '@tradejs/types';

export const getTelegramDeliverableSignals = (signals: Signal[]) =>
  signals.filter(
    (signal) =>
      signal.orderStatus !== 'skipped' && signal.orderStatus !== 'canceled',
  );
