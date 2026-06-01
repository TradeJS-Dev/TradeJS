const ListIt = require('list-it');
import { format } from 'date-fns';

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

export const createTable = (headers: string[], rows: string[][]) =>
  createListIt().setHeaderRow(headers).d(rows).toString();

export const createTimestamp = (date: Date) => format(date, 'yyyyMMddHHmm');

export const formatDuration = (startedAt: number) => {
  const seconds = Math.max(0, (Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

export const timeOperation = async <T>(
  label: string,
  operation: () => Promise<T>,
  log: (message: string) => void = console.log,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    log(`${label}: done in ${formatDuration(startedAt)}`);
  }
};
