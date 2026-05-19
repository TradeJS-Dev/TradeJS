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
