import type { AiDatasetRow, Signal } from '@tradejs/types';

export const extractSignalFromAiDatasetRow = (row: AiDatasetRow): Signal => {
  const { payload } = row;

  return {
    ...payload.signal,
    strategy: payload.signal.strategy,
    figures: payload.figures ?? {},
    indicators: payload.indicators ?? {},
    additionalIndicators: payload.additionalIndicators ?? {},
    prices: payload.signal.prices,
  } as Signal;
};
