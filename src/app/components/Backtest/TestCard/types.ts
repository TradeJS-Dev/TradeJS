import { Tokens } from '@chakra-ui/react';
import { SimpleOrderLogData } from '@types';

export type ChartColor = Tokens['colors'] | React.CSSProperties['color'];

type ItemDataKey<T> = keyof T;

interface SeriesItem<T> {
  name?: ItemDataKey<T>;
  color?: ChartColor;
  icon?: React.ReactNode;
  label?: React.ReactNode;
  stackId?: string;
  yAxisId?: string;
  strokeDasharray?: string;
  id?: string;
}

interface UseChartProps<T> {
  data: T[];
  series?: SeriesItem<T>[];
  sort?: {
    by: ItemDataKey<T>;
    direction: 'asc' | 'desc';
  };
}

interface TestCompare {
  testId: string;
  orderLog: SimpleOrderLogData;
  color: ChartColor;
}

export type TestCompareList = TestCompare[];

export type OnChangeCompare = (
  testId: string,
  orderLog: SimpleOrderLogData | null,
) => void;
