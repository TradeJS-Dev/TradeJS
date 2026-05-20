import { ML_BASE_CANDLES_WINDOW } from '../constants';

export type NumericHistoryBuffer = {
  values: number[];
  start: number;
  size: number;
};

export const createNumericHistoryBuffer = (): NumericHistoryBuffer => ({
  values: new Array<number>(ML_BASE_CANDLES_WINDOW),
  start: 0,
  size: 0,
});

export const cloneNumericHistoryBuffer = (
  buffer: NumericHistoryBuffer,
): NumericHistoryBuffer => ({
  values: [...buffer.values],
  start: buffer.start,
  size: buffer.size,
});

export const appendNumericHistory = (
  buffer: NumericHistoryBuffer,
  value: number,
) => {
  if (buffer.size < ML_BASE_CANDLES_WINDOW) {
    buffer.values[(buffer.start + buffer.size) % ML_BASE_CANDLES_WINDOW] =
      value;
    buffer.size += 1;
    return;
  }

  buffer.values[buffer.start] = value;
  buffer.start = (buffer.start + 1) % ML_BASE_CANDLES_WINDOW;
};

export const materializeNumericHistory = (
  buffer: NumericHistoryBuffer,
): number[] => {
  const materialized = new Array<number>(buffer.size);

  for (let index = 0; index < buffer.size; index += 1) {
    materialized[index] =
      buffer.values[(buffer.start + index) % ML_BASE_CANDLES_WINDOW]!;
  }

  return materialized;
};

export const getLatestHistoryNumber = (
  latestIndicatorValues: Record<string, number>,
  key: string,
): number | null => {
  const value = latestIndicatorValues[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
